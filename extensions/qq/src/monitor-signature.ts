import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import type { IncomingMessage } from "node:http";

const QQ_SIGNATURE_HEADER = "x-signature-ed25519";
const QQ_TIMESTAMP_HEADER = "x-signature-timestamp";
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ed25519KeyCache = new Map<string, { privateKey: KeyObject; publicKey: KeyObject }>();

function resolveHeaderValue(headers: IncomingMessage["headers"], key: string): string {
  const raw = headers[key];
  if (Array.isArray(raw)) {
    return raw[0]?.trim() ?? "";
  }
  return typeof raw === "string" ? raw.trim() : "";
}

function deriveSeed(secret: string): Buffer {
  const raw = Buffer.from(secret, "utf8");
  let seed = Buffer.from(raw);
  while (seed.length < 32) {
    seed = Buffer.concat([seed, seed]);
  }
  return seed.subarray(0, 32);
}

function resolveEd25519KeyPair(secret: string): { privateKey: KeyObject; publicKey: KeyObject } {
  const cached = ed25519KeyCache.get(secret);
  if (cached) {
    return cached;
  }
  const seed = deriveSeed(secret);
  const privateKeyDer = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const privateKey = createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  const pair = { privateKey, publicKey };
  ed25519KeyCache.set(secret, pair);
  return pair;
}

export function verifyOfficialWebhookSignature(params: {
  secret: string;
  req: IncomingMessage;
  rawBody: Buffer;
}): boolean {
  const signatureHex = resolveHeaderValue(params.req.headers, QQ_SIGNATURE_HEADER);
  const timestamp = resolveHeaderValue(params.req.headers, QQ_TIMESTAMP_HEADER);
  if (!signatureHex || !timestamp || !params.secret.trim()) {
    return false;
  }

  let signatureBuffer: Buffer;
  try {
    signatureBuffer = Buffer.from(signatureHex, "hex");
  } catch {
    return false;
  }
  if (signatureBuffer.length !== 64) {
    return false;
  }

  const message = Buffer.concat([Buffer.from(timestamp, "utf8"), params.rawBody]);
  const keyPair = resolveEd25519KeyPair(params.secret.trim());
  return verify(null, message, keyPair.publicKey, signatureBuffer);
}

export function generateValidationSignature(params: {
  secret: string;
  eventTs: string;
  plainToken: string;
}): string {
  const keyPair = resolveEd25519KeyPair(params.secret.trim());
  const content = Buffer.concat([
    Buffer.from(params.eventTs, "utf8"),
    Buffer.from(params.plainToken, "utf8"),
  ]);
  return sign(null, content, keyPair.privateKey).toString("hex");
}
