import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, test, vi } from "vitest";
import type { ResolvedGatewayAuth } from "./auth.js";
import { createGatewayHttpServer } from "./server-http.js";
import { withTempConfig } from "./test-temp-config.js";

function createRequest(params: {
  path: string;
  method?: string;
}): IncomingMessage {
  return {
    method: params.method ?? "GET",
    url: params.path,
    headers: {
      host: "127.0.0.1:18789",
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as IncomingMessage;
}

function createResponse(): {
  res: ServerResponse;
  setHeader: ReturnType<typeof vi.fn>;
  getBody: () => string;
} {
  const setHeader = vi.fn();
  let body = "";
  const end = vi.fn((chunk?: unknown) => {
    if (typeof chunk === "string") {
      body = chunk;
      return;
    }
    if (Buffer.isBuffer(chunk)) {
      body = chunk.toString("utf8");
      return;
    }
    if (chunk == null) {
      body = "";
      return;
    }
    body = JSON.stringify(chunk);
  });
  const res = {
    statusCode: 200,
    setHeader,
    end,
  } as unknown as ServerResponse;
  return {
    res,
    setHeader,
    getBody: () => body,
  };
}

async function dispatchRequest(
  server: ReturnType<typeof createGatewayHttpServer>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  server.emit("request", req, res);
  await new Promise((resolve) => setImmediate(resolve));
}

describe("gateway HTTP health endpoint", () => {
  const resolvedAuth: ResolvedGatewayAuth = {
    mode: "token",
    token: "test-token",
    password: undefined,
    allowTailscale: false,
  };

  test("serves /healthz and /health without gateway auth", async () => {
    await withTempConfig({
      cfg: { gateway: { trustedProxies: [] } },
      prefix: "openclaw-http-health-test-",
      run: async () => {
        const handleHooksRequest = vi.fn(async () => false);
        const server = createGatewayHttpServer({
          canvasHost: null,
          clients: new Set(),
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest,
          resolvedAuth,
        });

        const healthz = createResponse();
        await dispatchRequest(server, createRequest({ path: "/healthz" }), healthz.res);
        expect(healthz.res.statusCode).toBe(200);
        expect(healthz.getBody()).toBe(
          JSON.stringify({ ok: true, status: "ok", service: "openclaw-gateway" }),
        );

        const health = createResponse();
        await dispatchRequest(server, createRequest({ path: "/health" }), health.res);
        expect(health.res.statusCode).toBe(200);
        expect(health.getBody()).toBe(
          JSON.stringify({ ok: true, status: "ok", service: "openclaw-gateway" }),
        );

        expect(handleHooksRequest).not.toHaveBeenCalled();
      },
    });
  });

  test("returns 405 for non-GET health endpoint methods", async () => {
    await withTempConfig({
      cfg: { gateway: { trustedProxies: [] } },
      prefix: "openclaw-http-health-method-test-",
      run: async () => {
        const server = createGatewayHttpServer({
          canvasHost: null,
          clients: new Set(),
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          resolvedAuth,
        });

        const post = createResponse();
        await dispatchRequest(server, createRequest({ path: "/healthz", method: "POST" }), post.res);
        expect(post.res.statusCode).toBe(405);
        expect(post.setHeader).toHaveBeenCalledWith("Allow", "GET");
        expect(post.getBody()).toBe("Method Not Allowed");
      },
    });
  });
});
