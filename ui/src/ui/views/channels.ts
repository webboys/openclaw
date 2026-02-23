import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type {
  ChannelAccountSnapshot,
  ChannelUiMetaEntry,
  ChannelsStatusSnapshot,
  DiscordStatus,
  GoogleChatStatus,
  IMessageStatus,
  NostrProfile,
  NostrStatus,
  SignalStatus,
  SlackStatus,
  TelegramStatus,
  WhatsAppStatus,
} from "../types.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import { renderDiscordCard } from "./channels.discord.ts";
import { renderGoogleChatCard } from "./channels.googlechat.ts";
import { renderIMessageCard } from "./channels.imessage.ts";
import { renderNostrCard } from "./channels.nostr.ts";
import {
  boolLabel,
  channelEnabled,
  localizeChannelValue,
  renderChannelAccountCount,
  renderChannelStatusList,
} from "./channels.shared.ts";
import { renderSignalCard } from "./channels.signal.ts";
import { renderSlackCard } from "./channels.slack.ts";
import { renderTelegramCard } from "./channels.telegram.ts";
import type { ChannelKey, ChannelsChannelData, ChannelsProps } from "./channels.types.ts";
import { renderWhatsAppCard } from "./channels.whatsapp.ts";
import {
  calloutClass,
  CARD_CLASS,
  CARD_SUB_CLASS,
  CARD_TITLE_CLASS,
  CODE_BLOCK_CLASS,
  LIST_CLASS,
  LIST_ITEM_CLASS,
  LIST_MAIN_CLASS,
  LIST_SUB_CLASS,
  LIST_TITLE_CLASS,
  MUTED_TEXT_CLASS,
  STATUS_LABEL_CLASS,
  STATUS_ROW_CLASS,
  STATUS_VALUE_CLASS,
} from "./tw.ts";

export function renderChannels(props: ChannelsProps) {
  const channels = props.snapshot?.channels as Record<string, unknown> | null;
  const whatsapp = (channels?.whatsapp ?? undefined) as WhatsAppStatus | undefined;
  const telegram = (channels?.telegram ?? undefined) as TelegramStatus | undefined;
  const discord = (channels?.discord ?? null) as DiscordStatus | null;
  const googlechat = (channels?.googlechat ?? null) as GoogleChatStatus | null;
  const slack = (channels?.slack ?? null) as SlackStatus | null;
  const signal = (channels?.signal ?? null) as SignalStatus | null;
  const imessage = (channels?.imessage ?? null) as IMessageStatus | null;
  const nostr = (channels?.nostr ?? null) as NostrStatus | null;
  const channelOrder = resolveChannelOrder(props.snapshot, props.configForm);
  const orderedChannels = channelOrder
    .map((key, index) => ({
      key,
      enabled: channelEnabled(key, props),
      order: index,
    }))
    .toSorted((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      return a.order - b.order;
    });

  return html`
    <section class="grid gap-4 xl:grid-cols-2">
      ${orderedChannels.map((channel) =>
        renderChannel(channel.key, props, {
          whatsapp,
          telegram,
          discord,
          googlechat,
          slack,
          signal,
          imessage,
          nostr,
          channelAccounts: props.snapshot?.channelAccounts ?? null,
        }),
      )}
    </section>

    <section class="${CARD_CLASS} mt-4">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div class=${CARD_TITLE_CLASS}>机器人健康状态</div>
          <div class=${CARD_SUB_CLASS}>来自网关的各机器人状态快照。</div>
        </div>
        <div class=${MUTED_TEXT_CLASS}>
          最近成功刷新: ${props.lastSuccessAt ? formatRelativeTimestamp(props.lastSuccessAt) : "暂无"}
        </div>
      </div>
      ${
        props.lastError
          ? html`<div class="${calloutClass("danger")} mt-3">
            ${localizeChannelValue(props.lastError)}
          </div>`
          : nothing
      }
      <pre class="${CODE_BLOCK_CLASS} mt-3">
${props.snapshot ? JSON.stringify(props.snapshot, null, 2) : "暂无快照。"}
      </pre>
    </section>
  `;
}

const DEFAULT_FALLBACK_CHANNEL_ORDER: ChannelKey[] = [
  "whatsapp",
  "telegram",
  "discord",
  "googlechat",
  "slack",
  "signal",
  "imessage",
  "nostr",
  "qq",
];

const CHANNEL_LABEL_FALLBACKS: Record<string, string> = {
  qq: "QQ",
};

function appendUniqueChannelId(order: string[], seen: Set<string>, id: string | null | undefined) {
  const value = typeof id === "string" ? id.trim() : "";
  if (!value || seen.has(value)) {
    return;
  }
  seen.add(value);
  order.push(value);
}

function resolveChannelOrder(
  snapshot: ChannelsStatusSnapshot | null,
  configForm: Record<string, unknown> | null,
): ChannelKey[] {
  const order: string[] = [];
  const seen = new Set<string>();

  for (const entry of snapshot?.channelMeta ?? []) {
    appendUniqueChannelId(order, seen, entry.id);
  }
  for (const id of snapshot?.channelOrder ?? []) {
    appendUniqueChannelId(order, seen, id);
  }
  for (const id of Object.keys(snapshot?.channels ?? {})) {
    appendUniqueChannelId(order, seen, id);
  }
  for (const id of Object.keys(snapshot?.channelLabels ?? {})) {
    appendUniqueChannelId(order, seen, id);
  }

  const channelsNode = configForm?.channels;
  if (channelsNode && typeof channelsNode === "object" && !Array.isArray(channelsNode)) {
    for (const id of Object.keys(channelsNode as Record<string, unknown>)) {
      appendUniqueChannelId(order, seen, id);
    }
  }

  for (const id of DEFAULT_FALLBACK_CHANNEL_ORDER) {
    appendUniqueChannelId(order, seen, id);
  }

  return order;
}

function renderChannel(key: ChannelKey, props: ChannelsProps, data: ChannelsChannelData) {
  const accountCountLabel = renderChannelAccountCount(key, data.channelAccounts);
  switch (key) {
    case "whatsapp":
      return renderWhatsAppCard({
        props,
        whatsapp: data.whatsapp,
        accountCountLabel,
      });
    case "telegram":
      return renderTelegramCard({
        props,
        telegram: data.telegram,
        telegramAccounts: data.channelAccounts?.telegram ?? [],
        accountCountLabel,
      });
    case "discord":
      return renderDiscordCard({
        props,
        discord: data.discord,
        accountCountLabel,
      });
    case "googlechat":
      return renderGoogleChatCard({
        props,
        googleChat: data.googlechat,
        accountCountLabel,
      });
    case "slack":
      return renderSlackCard({
        props,
        slack: data.slack,
        accountCountLabel,
      });
    case "signal":
      return renderSignalCard({
        props,
        signal: data.signal,
        accountCountLabel,
      });
    case "imessage":
      return renderIMessageCard({
        props,
        imessage: data.imessage,
        accountCountLabel,
      });
    case "nostr": {
      const nostrAccounts = data.channelAccounts?.nostr ?? [];
      const primaryAccount = nostrAccounts[0];
      const accountId = primaryAccount?.accountId ?? "default";
      const profile =
        (primaryAccount as { profile?: NostrProfile | null } | undefined)?.profile ?? null;
      const showForm =
        props.nostrProfileAccountId === accountId ? props.nostrProfileFormState : null;
      const profileFormCallbacks = showForm
        ? {
            onFieldChange: props.onNostrProfileFieldChange,
            onSave: props.onNostrProfileSave,
            onImport: props.onNostrProfileImport,
            onCancel: props.onNostrProfileCancel,
            onToggleAdvanced: props.onNostrProfileToggleAdvanced,
          }
        : null;
      return renderNostrCard({
        props,
        nostr: data.nostr,
        nostrAccounts,
        accountCountLabel,
        profileFormState: showForm,
        profileFormCallbacks,
        onEditProfile: () => props.onNostrProfileEdit(accountId, profile),
      });
    }
    default:
      return renderGenericChannelCard(key, props, data.channelAccounts ?? {});
  }
}

function renderGenericChannelCard(
  key: ChannelKey,
  props: ChannelsProps,
  channelAccounts: Record<string, ChannelAccountSnapshot[]>,
) {
  const label = resolveChannelLabel(props.snapshot, key);
  const status = props.snapshot?.channels?.[key] as Record<string, unknown> | undefined;
  const configured = typeof status?.configured === "boolean" ? status.configured : undefined;
  const running = typeof status?.running === "boolean" ? status.running : undefined;
  const connected = typeof status?.connected === "boolean" ? status.connected : undefined;
  const lastError = typeof status?.lastError === "string" ? status.lastError : undefined;
  const accounts = channelAccounts[key] ?? [];
  const accountCountLabel = renderChannelAccountCount(key, channelAccounts);

  return html`
    <div class=${CARD_CLASS}>
      <div class=${CARD_TITLE_CLASS}>${label}</div>
      <div class=${CARD_SUB_CLASS}>机器人状态与设置。</div>
      ${accountCountLabel}

      ${
        accounts.length > 0
          ? html`
            <div class=${LIST_CLASS}>
              ${accounts.map((account) => renderGenericAccount(account))}
            </div>
          `
          : renderChannelStatusList([
              { label: "已配置", value: boolLabel(configured) },
              { label: "运行中", value: boolLabel(running) },
              { label: "已连接", value: boolLabel(connected) },
            ])
      }

      ${
        lastError
          ? html`<div class="${calloutClass("danger")} mt-3">
            ${localizeChannelValue(lastError)}
          </div>`
          : nothing
      }

      ${renderChannelConfigSection({ channelId: key, props })}
    </div>
  `;
}

function resolveChannelMetaMap(
  snapshot: ChannelsStatusSnapshot | null,
): Record<string, ChannelUiMetaEntry> {
  if (!snapshot?.channelMeta?.length) {
    return {};
  }
  return Object.fromEntries(snapshot.channelMeta.map((entry) => [entry.id, entry]));
}

function resolveChannelLabel(snapshot: ChannelsStatusSnapshot | null, key: string): string {
  const meta = resolveChannelMetaMap(snapshot)[key];
  return meta?.label ?? snapshot?.channelLabels?.[key] ?? CHANNEL_LABEL_FALLBACKS[key] ?? key;
}

const RECENT_ACTIVITY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function hasRecentActivity(account: ChannelAccountSnapshot): boolean {
  if (!account.lastInboundAt) {
    return false;
  }
  return Date.now() - account.lastInboundAt < RECENT_ACTIVITY_THRESHOLD_MS;
}

function deriveRunningStatus(account: ChannelAccountSnapshot): "是" | "否" | "活跃" {
  if (account.running) {
    return "是";
  }
  // If we have recent inbound activity, the channel is effectively running
  if (hasRecentActivity(account)) {
    return "活跃";
  }
  return "否";
}

function deriveConnectedStatus(account: ChannelAccountSnapshot): "是" | "否" | "活跃" | "不适用" {
  if (account.connected === true) {
    return "是";
  }
  if (account.connected === false) {
    return "否";
  }
  // If connected is null/undefined but we have recent activity, show as active
  if (hasRecentActivity(account)) {
    return "活跃";
  }
  return "不适用";
}

function renderGenericAccount(account: ChannelAccountSnapshot) {
  const runningStatus = deriveRunningStatus(account);
  const connectedStatus = deriveConnectedStatus(account);

  return html`
    <div class=${LIST_ITEM_CLASS}>
      <div class=${LIST_MAIN_CLASS}>
        <div class=${LIST_TITLE_CLASS}>${account.name || account.accountId}</div>
        <div class=${LIST_SUB_CLASS}>${account.accountId}</div>
      </div>
      <div class="w-full">
        <div class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]">
          <div class=${STATUS_ROW_CLASS}>
            <span class=${STATUS_LABEL_CLASS}>运行中</span>
            <span class=${STATUS_VALUE_CLASS}>${runningStatus}</span>
          </div>
          <div class=${STATUS_ROW_CLASS}>
            <span class=${STATUS_LABEL_CLASS}>已配置</span>
            <span class=${STATUS_VALUE_CLASS}>${account.configured ? "是" : "否"}</span>
          </div>
          <div class=${STATUS_ROW_CLASS}>
            <span class=${STATUS_LABEL_CLASS}>已连接</span>
            <span class=${STATUS_VALUE_CLASS}>${connectedStatus}</span>
          </div>
          <div class=${STATUS_ROW_CLASS}>
            <span class=${STATUS_LABEL_CLASS}>最后入站</span>
            <span class=${STATUS_VALUE_CLASS}>
              ${account.lastInboundAt ? formatRelativeTimestamp(account.lastInboundAt) : "暂无"}
            </span>
          </div>
        </div>
        ${
          account.lastError
            ? html`<div class="pt-2 text-[12px] text-[var(--danger)]">
                ${localizeChannelValue(account.lastError)}
              </div>`
            : nothing
        }
      </div>
    </div>
  `;
}
