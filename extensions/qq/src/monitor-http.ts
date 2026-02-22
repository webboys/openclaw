import type { IncomingMessage, ServerResponse } from "node:http";

const QQ_OP_HEARTBEAT_ACK = 11;
const QQ_OP_DISPATCH_ACK = 12;

export function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export async function readJsonBodyWithRaw(params: {
  req: IncomingMessage;
  maxBytes: number;
  timeoutMs: number;
}): Promise<
  | { ok: true; rawBody: Buffer; json: unknown }
  | { ok: false; code: "PAYLOAD_TOO_LARGE" | "REQUEST_BODY_TIMEOUT" | "BAD_REQUEST" }
> {
  const { req, maxBytes, timeoutMs } = params;
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  return await new Promise((resolve) => {
    let settled = false;
    const done = (
      result:
        | { ok: true; rawBody: Buffer; json: unknown }
        | { ok: false; code: "PAYLOAD_TOO_LARGE" | "REQUEST_BODY_TIMEOUT" | "BAD_REQUEST" },
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      done({ ok: false, code: "REQUEST_BODY_TIMEOUT" });
      req.destroy();
    }, timeoutMs);

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        done({ ok: false, code: "PAYLOAD_TOO_LARGE" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const rawBody = Buffer.concat(chunks);
        const text = rawBody.toString("utf8");
        const json = JSON.parse(text) as unknown;
        done({ ok: true, rawBody, json });
      } catch {
        done({ ok: false, code: "BAD_REQUEST" });
      }
    });

    req.on("error", () => {
      done({ ok: false, code: "BAD_REQUEST" });
    });
  });
}

export function buildDispatchAck(success: boolean): { op: number; d: number } {
  return { op: QQ_OP_DISPATCH_ACK, d: success ? 0 : 1 };
}

export function buildHeartbeatAck(seq: number): { op: number; d: number } {
  return { op: QQ_OP_HEARTBEAT_ACK, d: seq };
}
