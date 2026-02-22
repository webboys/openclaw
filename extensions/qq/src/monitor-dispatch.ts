import type { MarkdownTableMode, OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { createReplyPrefixOptions, resolveSenderCommandAuthorization } from "openclaw/plugin-sdk";
import type { ResolvedQqAccount } from "./accounts.js";
import { normalizeQqAllowEntry, resolveQqGroupConfig } from "./normalize.js";
import { getQqRuntime } from "./runtime.js";
import { sendMessageQq } from "./send.js";
import type { QqOfficialMessageData } from "./types.js";

const QQ_TEXT_LIMIT = 1800;

export const QQ_EVENT_GROUP_AT_MESSAGE_CREATE = "GROUP_AT_MESSAGE_CREATE";
export const QQ_EVENT_C2C_MESSAGE_CREATE = "C2C_MESSAGE_CREATE";

export type QqCoreRuntime = ReturnType<typeof getQqRuntime>;

function logVerbose(core: QqCoreRuntime, runtime: RuntimeEnv, message: string): void {
  if (core.logging.shouldLogVerbose()) {
    runtime.log(`[qq] ${message}`);
  }
}

function normalizeAllowList(entries: Array<string | number> | undefined): string[] {
  return Array.from(
    new Set(
      (entries ?? [])
        .map((entry) => normalizeQqAllowEntry(String(entry)))
        .filter((entry) => Boolean(entry)),
    ),
  );
}

function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (allowFrom.includes("*")) {
    return true;
  }
  const normalizedSenderId = normalizeQqAllowEntry(senderId);
  return allowFrom.some((entry) => normalizeQqAllowEntry(entry) === normalizedSenderId);
}

function resolveGroupAllowed(groupId: string, account: ResolvedQqAccount): boolean {
  const policy = account.config.groupPolicy ?? "allowlist";
  if (policy === "open") {
    return true;
  }
  if (policy === "disabled") {
    return false;
  }

  const matched = resolveQqGroupConfig({
    groups: account.config.groups,
    groupId,
  });
  if (!matched) {
    return false;
  }
  return matched.allow !== false && matched.enabled !== false;
}

function resolveTimestampMs(timestamp: string | undefined): number {
  if (!timestamp?.trim()) {
    return Date.now();
  }
  const parsed = Date.parse(timestamp);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return Date.now();
}

function stripQqMentions(content: string): string {
  return content.replace(/<@!?\w+>/g, "").trim();
}

function parseMessageData(eventType: string, payload: Record<string, unknown>) {
  const data = payload as QqOfficialMessageData;
  const contentRaw = typeof data.content === "string" ? data.content : "";
  const content = stripQqMentions(contentRaw) || contentRaw.trim();
  const author = data.author;
  const senderId =
    (typeof author?.id === "string" && author.id.trim()) ||
    (typeof author?.user_openid === "string" && author.user_openid.trim()) ||
    "";
  const senderName =
    (typeof author?.username === "string" && author.username.trim()) ||
    (typeof author?.nick === "string" && author.nick.trim()) ||
    senderId;
  const messageId =
    (typeof data.id === "string" && data.id.trim()) ||
    (typeof data.msg_id === "string" && data.msg_id.trim()) ||
    "";
  const groupIdCandidate =
    (typeof data.group_id === "string" && data.group_id.trim()) ||
    (typeof data.group_openid === "string" && data.group_openid.trim()) ||
    "";
  const isGroup = eventType === QQ_EVENT_GROUP_AT_MESSAGE_CREATE;

  return {
    content,
    senderId,
    senderName,
    messageId,
    groupId: isGroup ? groupIdCandidate : "",
    isGroup,
    timestampMs: resolveTimestampMs(data.timestamp),
  };
}

async function deliverQqReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string };
  account: ResolvedQqAccount;
  target: string;
  runtime: RuntimeEnv;
  core: QqCoreRuntime;
  config: OpenClawConfig;
  tableMode: MarkdownTableMode;
  replyToMessageId?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const {
    payload,
    account,
    target,
    runtime,
    core,
    config,
    tableMode,
    replyToMessageId,
    statusSink,
  } = params;
  const convertedText = core.channel.text
    .convertMarkdownTables(payload.text ?? "", tableMode)
    .trim();
  const mediaList = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];
  const mediaBlock = mediaList.length
    ? mediaList.map((url) => `Attachment: ${url}`).join("\n")
    : "";
  const finalText = convertedText
    ? mediaBlock
      ? `${convertedText}\n\n${mediaBlock}`
      : convertedText
    : mediaBlock;
  if (!finalText.trim()) {
    return;
  }

  const chunkMode = core.channel.text.resolveChunkMode(config, "qq", account.accountId);
  const limit = account.config.textChunkLimit ?? QQ_TEXT_LIMIT;
  const chunks = core.channel.text.chunkMarkdownTextWithMode(finalText, limit, chunkMode);

  let replyId = replyToMessageId;
  for (const chunk of chunks) {
    const result = await sendMessageQq(target, chunk, {
      cfg: config,
      accountId: account.accountId,
      replyToMessageId: replyId,
    });
    replyId = undefined;
    if (!result.ok) {
      runtime.error(`qq send failed: ${result.error ?? "unknown error"}`);
      continue;
    }
    statusSink?.({ lastOutboundAt: Date.now() });
  }
}

export async function processQqDispatch(params: {
  eventType: string;
  eventData: Record<string, unknown>;
  account: ResolvedQqAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: QqCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { eventType, eventData, account, config, runtime, core, statusSink } = params;
  const parsed = parseMessageData(eventType, eventData);
  const { senderId, senderName, content, isGroup, groupId, messageId, timestampMs } = parsed;
  if (!senderId || !content) {
    return;
  }

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const configuredAllowFrom = normalizeAllowList(account.config.allowFrom);
  const groupConfig = resolveQqGroupConfig({
    groups: account.config.groups,
    groupId,
  });

  const { senderAllowedForCommands, commandAuthorized } = await resolveSenderCommandAuthorization({
    cfg: config,
    rawBody: content,
    isGroup,
    dmPolicy,
    configuredAllowFrom,
    senderId,
    isSenderAllowed,
    readAllowFromStore: () => core.channel.pairing.readAllowFromStore("qq"),
    shouldComputeCommandAuthorized: (body, cfg) =>
      core.channel.commands.shouldComputeCommandAuthorized(body, cfg),
    resolveCommandAuthorizedFromAuthorizers: (resolverParams) =>
      core.channel.commands.resolveCommandAuthorizedFromAuthorizers(resolverParams),
  });

  if (!isGroup) {
    if (dmPolicy === "disabled") {
      logVerbose(core, runtime, `drop DM sender=${senderId} (dmPolicy=disabled)`);
      return;
    }
    if (dmPolicy !== "open" && !senderAllowedForCommands) {
      if (dmPolicy === "pairing") {
        const { code, created } = await core.channel.pairing.upsertPairingRequest({
          channel: "qq",
          id: senderId,
          meta: { name: senderName || undefined },
        });
        if (created) {
          const pairingText = core.channel.pairing.buildPairingReply({
            channel: "qq",
            idLine: `Your QQ user id: ${senderId}`,
            code,
          });
          const result = await sendMessageQq(`user:${senderId}`, pairingText, {
            cfg: config,
            accountId: account.accountId,
            replyToMessageId: messageId || undefined,
          });
          if (result.ok) {
            statusSink?.({ lastOutboundAt: Date.now() });
          }
        }
      }
      return;
    }
  } else {
    if (!groupId) {
      return;
    }
    if (!resolveGroupAllowed(groupId, account)) {
      logVerbose(core, runtime, `drop group=${groupId} (groupPolicy/allowlist)`);
      return;
    }

    const scopedGroupAllowFrom = normalizeAllowList(
      groupConfig?.allowFrom ?? account.config.groupAllowFrom,
    );
    if (scopedGroupAllowFrom.length > 0 && !isSenderAllowed(senderId, scopedGroupAllowFrom)) {
      logVerbose(core, runtime, `drop group sender=${senderId} in ${groupId} (groupAllowFrom)`);
      return;
    }
  }

  if (
    isGroup &&
    core.channel.commands.isControlCommandMessage(content, config) &&
    commandAuthorized !== true
  ) {
    logVerbose(core, runtime, `drop unauthorized control command sender=${senderId}`);
    return;
  }

  const requireMention = Boolean(groupConfig?.requireMention ?? true);
  const wasMentioned = isGroup ? eventType === QQ_EVENT_GROUP_AT_MESSAGE_CREATE : false;
  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config,
    surface: "qq",
  });
  const hasControlCommand = core.channel.text.hasControlCommand(content, config);
  if (isGroup && requireMention && !wasMentioned && !(allowTextCommands && hasControlCommand)) {
    logVerbose(core, runtime, `drop group message without mention sender=${senderId}`);
    return;
  }

  const conversationId = isGroup ? groupId : senderId;
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "qq",
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "direct",
      id: conversationId,
    },
  });

  const fromLabel = isGroup ? `group:${groupId}` : senderName || `user:${senderId}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "QQ",
    from: fromLabel,
    timestamp: timestampMs,
    previousTimestamp,
    envelope: core.channel.reply.resolveEnvelopeFormatOptions(config),
    body: content,
  });

  const target = isGroup ? `qq:group:${groupId}` : `qq:${senderId}`;
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: content,
    RawBody: content,
    CommandBody: content,
    From: target,
    To: target,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: senderName || undefined,
    SenderId: senderId,
    GroupSubject: isGroup ? `group:${groupId}` : undefined,
    GroupSystemPrompt: isGroup ? groupConfig?.systemPrompt?.trim() || undefined : undefined,
    WasMentioned: isGroup ? wasMentioned : undefined,
    Provider: "qq",
    Surface: "qq",
    MessageSid: messageId || undefined,
    Timestamp: timestampMs,
    CommandAuthorized: commandAuthorized,
    OriginatingChannel: "qq",
    OriginatingTo: target,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => runtime.error(`qq: failed updating session metadata: ${String(err)}`),
  });

  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "qq",
    accountId: account.accountId,
  });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: "qq",
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        const replyTarget = isGroup ? `group:${groupId}` : `user:${senderId}`;
        await deliverQqReply({
          payload,
          account,
          target: replyTarget,
          runtime,
          core,
          config,
          tableMode,
          replyToMessageId: messageId || undefined,
          statusSink,
        });
      },
      onError: (err, info) => {
        runtime.error(`qq ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      onModelSelected,
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
  });
}
