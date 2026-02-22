import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { TlsOptions } from "node:tls";
import type { WebSocketServer } from "ws";
import { resolveAgentAvatar } from "../agents/identity-avatar.js";
import {
  A2UI_PATH,
  CANVAS_HOST_PATH,
  CANVAS_WS_PATH,
  handleA2uiHttpRequest,
} from "../canvas-host/a2ui.js";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import { loadConfig } from "../config/config.js";
import { safeEqualSecret } from "../security/secret-equal.js";
import { handleSlackHttpRequest } from "../slack/http/index.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import {
  authorizeGatewayConnect,
  isLocalDirectRequest,
  type GatewayAuthResult,
  type ResolvedGatewayAuth,
} from "./auth.js";
import { CANVAS_CAPABILITY_TTL_MS, normalizeCanvasScopedUrl } from "./canvas-capability.js";
import {
  handleControlUiAvatarRequest,
  handleControlUiHttpRequest,
  type ControlUiRootState,
} from "./control-ui.js";
import { sendGatewayAuthFailure, setDefaultSecurityHeaders } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";
import { GATEWAY_CLIENT_MODES, normalizeGatewayClientMode } from "./protocol/client-info.js";
import type { HooksRequestHandler } from "./server-http-hooks.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { handleToolsInvokeHttpRequest } from "./tools-invoke-http.js";

export { createHooksRequestHandler, type HooksRequestHandler } from "./server-http-hooks.js";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

const gatewayHealthPayload = {
  ok: true,
  status: "ok",
  service: "openclaw-gateway",
} as const;

function isGatewayHealthPath(pathname: string): boolean {
  return pathname === "/healthz" || pathname === "/health";
}

function isCanvasPath(pathname: string): boolean {
  return (
    pathname === A2UI_PATH ||
    pathname.startsWith(`${A2UI_PATH}/`) ||
    pathname === CANVAS_HOST_PATH ||
    pathname.startsWith(`${CANVAS_HOST_PATH}/`) ||
    pathname === CANVAS_WS_PATH
  );
}

function isNodeWsClient(client: GatewayWsClient): boolean {
  if (client.connect.role === "node") {
    return true;
  }
  return normalizeGatewayClientMode(client.connect.client.mode) === GATEWAY_CLIENT_MODES.NODE;
}

function hasAuthorizedNodeWsClientForCanvasCapability(
  clients: Set<GatewayWsClient>,
  capability: string,
): boolean {
  const nowMs = Date.now();
  for (const client of clients) {
    if (!isNodeWsClient(client)) {
      continue;
    }
    if (!client.canvasCapability || !client.canvasCapabilityExpiresAtMs) {
      continue;
    }
    if (client.canvasCapabilityExpiresAtMs <= nowMs) {
      continue;
    }
    if (safeEqualSecret(client.canvasCapability, capability)) {
      // Sliding expiration while the connected node keeps using canvas.
      client.canvasCapabilityExpiresAtMs = nowMs + CANVAS_CAPABILITY_TTL_MS;
      return true;
    }
  }
  return false;
}

async function authorizeCanvasRequest(params: {
  req: IncomingMessage;
  auth: ResolvedGatewayAuth;
  trustedProxies: string[];
  clients: Set<GatewayWsClient>;
  canvasCapability?: string;
  malformedScopedPath?: boolean;
  rateLimiter?: AuthRateLimiter;
}): Promise<GatewayAuthResult> {
  const { req, auth, trustedProxies, clients, canvasCapability, malformedScopedPath, rateLimiter } =
    params;
  if (malformedScopedPath) {
    return { ok: false, reason: "unauthorized" };
  }
  if (isLocalDirectRequest(req, trustedProxies)) {
    return { ok: true };
  }

  let lastAuthFailure: GatewayAuthResult | null = null;
  const token = getBearerToken(req);
  if (token) {
    const authResult = await authorizeGatewayConnect({
      auth: { ...auth, allowTailscale: false },
      connectAuth: { token, password: token },
      req,
      trustedProxies,
      rateLimiter,
    });
    if (authResult.ok) {
      return authResult;
    }
    lastAuthFailure = authResult;
  }

  if (canvasCapability && hasAuthorizedNodeWsClientForCanvasCapability(clients, canvasCapability)) {
    return { ok: true };
  }
  return lastAuthFailure ?? { ok: false, reason: "unauthorized" };
}

function writeUpgradeAuthFailure(
  socket: { write: (chunk: string) => void },
  auth: GatewayAuthResult,
) {
  if (auth.rateLimited) {
    const retryAfterSeconds =
      auth.retryAfterMs && auth.retryAfterMs > 0 ? Math.ceil(auth.retryAfterMs / 1000) : undefined;
    socket.write(
      [
        "HTTP/1.1 429 Too Many Requests",
        retryAfterSeconds ? `Retry-After: ${retryAfterSeconds}` : undefined,
        "Content-Type: application/json; charset=utf-8",
        "Connection: close",
        "",
        JSON.stringify({
          error: {
            message: "Too many failed authentication attempts. Please try again later.",
            type: "rate_limited",
          },
        }),
      ]
        .filter(Boolean)
        .join("\r\n"),
    );
    return;
  }
  socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
}

export function createGatewayHttpServer(opts: {
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  controlUiEnabled: boolean;
  controlUiBasePath: string;
  controlUiRoot?: ControlUiRootState;
  openAiChatCompletionsEnabled: boolean;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  handleHooksRequest: HooksRequestHandler;
  handlePluginRequest?: HooksRequestHandler;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
  tlsOptions?: TlsOptions;
}): HttpServer {
  const {
    canvasHost,
    clients,
    controlUiEnabled,
    controlUiBasePath,
    controlUiRoot,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    handleHooksRequest,
    handlePluginRequest,
    resolvedAuth,
    rateLimiter,
  } = opts;
  const httpServer: HttpServer = opts.tlsOptions
    ? createHttpsServer(opts.tlsOptions, (req, res) => {
        void handleRequest(req, res);
      })
    : createHttpServer((req, res) => {
        void handleRequest(req, res);
      });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    setDefaultSecurityHeaders(res);

    // Don't interfere with WebSocket upgrades; ws handles the 'upgrade' event.
    if (String(req.headers.upgrade ?? "").toLowerCase() === "websocket") {
      return;
    }

    try {
      const configSnapshot = loadConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      const scopedCanvas = normalizeCanvasScopedUrl(req.url ?? "/");
      if (scopedCanvas.malformedScopedPath) {
        sendGatewayAuthFailure(res, { ok: false, reason: "unauthorized" });
        return;
      }
      if (scopedCanvas.rewrittenUrl) {
        req.url = scopedCanvas.rewrittenUrl;
      }
      const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
      if (isGatewayHealthPath(requestPath)) {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.setHeader("Allow", "GET");
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Method Not Allowed");
          return;
        }
        sendJson(res, 200, gatewayHealthPayload);
        return;
      }
      if (await handleHooksRequest(req, res)) {
        return;
      }
      if (
        await handleToolsInvokeHttpRequest(req, res, {
          auth: resolvedAuth,
          trustedProxies,
          rateLimiter,
        })
      ) {
        return;
      }
      if (await handleSlackHttpRequest(req, res)) {
        return;
      }
      if (handlePluginRequest) {
        // Channel HTTP endpoints are gateway-auth protected by default.
        // Non-channel plugin routes remain plugin-owned and must enforce
        // their own auth when exposing sensitive functionality.
        if (requestPath.startsWith("/api/channels/")) {
          const token = getBearerToken(req);
          const authResult = await authorizeGatewayConnect({
            auth: resolvedAuth,
            connectAuth: token ? { token, password: token } : null,
            req,
            trustedProxies,
            rateLimiter,
          });
          if (!authResult.ok) {
            sendGatewayAuthFailure(res, authResult);
            return;
          }
        }
        if (await handlePluginRequest(req, res)) {
          return;
        }
      }
      if (openResponsesEnabled) {
        if (
          await handleOpenResponsesHttpRequest(req, res, {
            auth: resolvedAuth,
            config: openResponsesConfig,
            trustedProxies,
            rateLimiter,
          })
        ) {
          return;
        }
      }
      if (openAiChatCompletionsEnabled) {
        if (
          await handleOpenAiHttpRequest(req, res, {
            auth: resolvedAuth,
            trustedProxies,
            rateLimiter,
          })
        ) {
          return;
        }
      }
      if (canvasHost) {
        if (isCanvasPath(requestPath)) {
          const ok = await authorizeCanvasRequest({
            req,
            auth: resolvedAuth,
            trustedProxies,
            clients,
            canvasCapability: scopedCanvas.capability,
            malformedScopedPath: scopedCanvas.malformedScopedPath,
            rateLimiter,
          });
          if (!ok.ok) {
            sendGatewayAuthFailure(res, ok);
            return;
          }
        }
        if (await handleA2uiHttpRequest(req, res)) {
          return;
        }
        if (await canvasHost.handleHttpRequest(req, res)) {
          return;
        }
      }
      if (controlUiEnabled) {
        if (
          handleControlUiAvatarRequest(req, res, {
            basePath: controlUiBasePath,
            resolveAvatar: (agentId) => resolveAgentAvatar(configSnapshot, agentId),
          })
        ) {
          return;
        }
        if (
          handleControlUiHttpRequest(req, res, {
            basePath: controlUiBasePath,
            config: configSnapshot,
            root: controlUiRoot,
          })
        ) {
          return;
        }
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }

  return httpServer;
}

export function attachGatewayUpgradeHandler(opts: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
}) {
  const { httpServer, wss, canvasHost, clients, resolvedAuth, rateLimiter } = opts;
  httpServer.on("upgrade", (req, socket, head) => {
    void (async () => {
      const scopedCanvas = normalizeCanvasScopedUrl(req.url ?? "/");
      if (scopedCanvas.malformedScopedPath) {
        writeUpgradeAuthFailure(socket, { ok: false, reason: "unauthorized" });
        socket.destroy();
        return;
      }
      if (scopedCanvas.rewrittenUrl) {
        req.url = scopedCanvas.rewrittenUrl;
      }
      if (canvasHost) {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === CANVAS_WS_PATH) {
          const configSnapshot = loadConfig();
          const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
          const ok = await authorizeCanvasRequest({
            req,
            auth: resolvedAuth,
            trustedProxies,
            clients,
            canvasCapability: scopedCanvas.capability,
            malformedScopedPath: scopedCanvas.malformedScopedPath,
            rateLimiter,
          });
          if (!ok.ok) {
            writeUpgradeAuthFailure(socket, ok);
            socket.destroy();
            return;
          }
        }
        if (canvasHost.handleUpgrade(req, socket, head)) {
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    })().catch(() => {
      socket.destroy();
    });
  });
}
