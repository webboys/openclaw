import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  normalizeWebhookPath,
  registerWebhookTarget,
  rejectNonPostWebhookRequest,
  resolveWebhookTargets,
} from "openclaw/plugin-sdk";
import type { ResolvedQqAccount } from "./accounts.js";
import {
  processQqDispatch,
  QQ_EVENT_C2C_MESSAGE_CREATE,
  QQ_EVENT_GROUP_AT_MESSAGE_CREATE,
  type QqCoreRuntime,
} from "./monitor-dispatch.js";
import {
  buildDispatchAck,
  buildHeartbeatAck,
  readJsonBodyWithRaw,
  sendJson,
} from "./monitor-http.js";
import {
  generateValidationSignature,
  verifyOfficialWebhookSignature,
} from "./monitor-signature.js";
import { getQqRuntime } from "./runtime.js";
import type { QqWebhookPayload } from "./types.js";

export type QqMonitorOptions = {
  account: ResolvedQqAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type QqMonitorResult = {
  stop: () => void;
};

type WebhookTarget = {
  account: ResolvedQqAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: QqCoreRuntime;
  path: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

const DEFAULT_WEBHOOK_PATH = "/qq-official-webhook";

const QQ_OP_DISPATCH = 0;
const QQ_OP_HEARTBEAT = 1;
const QQ_OP_CALLBACK_VALIDATION = 13;

const webhookTargets = new Map<string, WebhookTarget[]>();

function resolveWebhookValidationData(payload: QqWebhookPayload): {
  plainToken: string;
  eventTs: string;
} {
  const data =
    payload.d && typeof payload.d === "object" && !Array.isArray(payload.d)
      ? (payload.d as Record<string, unknown>)
      : {};
  const plainToken = typeof data.plain_token === "string" ? data.plain_token : "";
  const eventTs = typeof data.event_ts === "string" ? data.event_ts : "";
  return { plainToken, eventTs };
}

function parseWebhookPayload(body: unknown): QqWebhookPayload {
  return body as QqWebhookPayload;
}

function handleWebhookBodyError(
  res: ServerResponse,
  code: "PAYLOAD_TOO_LARGE" | "REQUEST_BODY_TIMEOUT" | "BAD_REQUEST",
): true {
  if (code === "PAYLOAD_TOO_LARGE") {
    res.statusCode = 413;
    res.end("Payload Too Large");
    return true;
  }
  if (code === "REQUEST_BODY_TIMEOUT") {
    res.statusCode = 408;
    res.end("Request Timeout");
    return true;
  }
  res.statusCode = 400;
  res.end("Bad Request");
  return true;
}

export function registerQqWebhookTarget(target: WebhookTarget): () => void {
  return registerWebhookTarget(webhookTargets, target).unregister;
}

export async function handleQqWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const resolved = resolveWebhookTargets(req, webhookTargets);
  if (!resolved) {
    return false;
  }
  const { targets } = resolved;

  if (rejectNonPostWebhookRequest(req, res)) {
    return true;
  }

  if (targets.length > 1) {
    res.statusCode = 409;
    res.end("ambiguous webhook target: use distinct webhookPath per account");
    return true;
  }

  const target = targets[0];
  const body = await readJsonBodyWithRaw({
    req,
    maxBytes: 1024 * 1024,
    timeoutMs: 20_000,
  });
  if (!body.ok) {
    return handleWebhookBodyError(res, body.code);
  }

  if (
    !verifyOfficialWebhookSignature({
      secret: target.account.appSecret,
      req,
      rawBody: body.rawBody,
    })
  ) {
    res.statusCode = 401;
    res.end("unauthorized");
    return true;
  }

  const payload = parseWebhookPayload(body.json);
  const op = typeof payload.op === "number" ? payload.op : -1;
  if (op === QQ_OP_CALLBACK_VALIDATION) {
    const { plainToken, eventTs } = resolveWebhookValidationData(payload);
    if (!plainToken || !eventTs) {
      res.statusCode = 400;
      res.end("invalid callback validation payload");
      return true;
    }
    sendJson(res, 200, {
      plain_token: plainToken,
      signature: generateValidationSignature({
        secret: target.account.appSecret,
        eventTs,
        plainToken,
      }),
    });
    return true;
  }

  if (op === QQ_OP_HEARTBEAT) {
    const seq =
      payload.d != null && typeof payload.d === "number" && Number.isFinite(payload.d)
        ? payload.d
        : 0;
    sendJson(res, 200, buildHeartbeatAck(seq));
    return true;
  }

  if (op !== QQ_OP_DISPATCH) {
    sendJson(res, 200, { ok: true });
    return true;
  }

  target.statusSink?.({ lastInboundAt: Date.now() });
  const eventType = typeof payload.t === "string" ? payload.t : "";
  const eventData = payload.d;
  if (
    (eventType === QQ_EVENT_GROUP_AT_MESSAGE_CREATE || eventType === QQ_EVENT_C2C_MESSAGE_CREATE) &&
    eventData &&
    typeof eventData === "object" &&
    !Array.isArray(eventData)
  ) {
    processQqDispatch({
      eventType,
      eventData: eventData as Record<string, unknown>,
      account: target.account,
      config: target.config,
      runtime: target.runtime,
      core: target.core,
      statusSink: target.statusSink,
    }).catch((err) => {
      target.runtime.error(`qq webhook processing failed: ${String(err)}`);
    });
  }

  sendJson(res, 200, buildDispatchAck(true));
  return true;
}

export async function monitorQqProvider(options: QqMonitorOptions): Promise<QqMonitorResult> {
  const { account, config, runtime, abortSignal, statusSink } = options;
  const core = getQqRuntime();
  const path = normalizeWebhookPath(account.config.webhookPath?.trim() || DEFAULT_WEBHOOK_PATH);
  const unregister = registerQqWebhookTarget({
    account,
    config,
    runtime,
    core,
    path,
    statusSink,
  });

  abortSignal.addEventListener("abort", unregister, { once: true });

  return {
    stop: unregister,
  };
}
