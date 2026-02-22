import { html } from "lit";
import { t, i18n, type Locale } from "../../i18n/index.ts";
import type { PendingDevice } from "../controllers/devices.ts";
import { formatRelativeTimestamp, formatDurationHuman } from "../format.ts";
import type { GatewayHelloOk } from "../gateway.ts";
import type { Tab } from "../navigation.ts";
import { formatNextRun } from "../presenter.ts";
import type { UiSettings } from "../storage.ts";

export type OverviewProps = {
  connected: boolean;
  hello: GatewayHelloOk | null;
  settings: UiSettings;
  password: string;
  lastError: string | null;
  presenceCount: number;
  sessionsCount: number | null;
  cronEnabled: boolean | null;
  cronNext: number | null;
  lastChannelsRefresh: number | null;
  devicesLoading: boolean;
  devicesError: string | null;
  pendingDevices: PendingDevice[];
  onSettingsChange: (next: UiSettings) => void;
  onPasswordChange: (next: string) => void;
  onSessionKeyChange: (next: string) => void;
  onOpenRuntimePanel: (panel: "instances" | "sessions") => void;
  onConnect: () => void;
  onRefresh: () => void;
  onDevicesRefresh: () => void;
  onDeviceApprove: (requestId: string) => void;
  onOpenTab: (tab: Tab) => void;
};

type ConnectionFix = {
  title: string;
  message: string;
  commands: string[];
  docs?: Array<{ label: string; href: string }>;
  needsPairingApproval?: boolean;
};

function resolveConnectionFix(lastError: string | null): ConnectionFix | null {
  if (!lastError) {
    return null;
  }
  const lower = lastError.toLowerCase();
  if (lower.includes("pairing required")) {
    return {
      title: "Pairing approval required",
      message: "Approve this browser/device before reconnecting.",
      commands: ["openclaw devices list", "openclaw devices approve <requestId>"],
      docs: [{ label: "Devices CLI", href: "https://docs.openclaw.ai/cli/devices" }],
      needsPairingApproval: true,
    };
  }
  if (lower.includes("unauthorized") || lower.includes("connect failed")) {
    return {
      title: "Gateway auth failed",
      message: "Use a fresh dashboard link or paste the current gateway token.",
      commands: ["openclaw dashboard --no-open", "openclaw config get gateway.auth.token"],
      docs: [{ label: "Dashboard auth", href: "https://docs.openclaw.ai/web/dashboard" }],
    };
  }
  if (lower.includes("secure context") || lower.includes("device identity required")) {
    return {
      title: "Secure context required",
      message: "Open the dashboard on localhost or HTTPS (for example Tailscale Serve).",
      commands: ["openclaw dashboard --no-open"],
      docs: [
        { label: "Control UI insecure HTTP", href: "https://docs.openclaw.ai/web/control-ui#insecure-http" },
      ],
    };
  }
  if (lower.includes("origin not allowed")) {
    return {
      title: "Origin blocked",
      message: "Open the UI from the gateway host, or add your dev origin allowlist.",
      commands: ['openclaw config set gateway.controlUi.allowedOrigins "[\\"http://localhost:5173\\"]"'],
      docs: [{ label: "Control UI", href: "https://docs.openclaw.ai/web/control-ui" }],
    };
  }
  return {
    title: "Connection troubleshooting",
    message: "Verify gateway health and reconnect.",
    commands: ["openclaw status"],
    docs: [{ label: "Gateway troubleshooting", href: "https://docs.openclaw.ai/gateway/troubleshooting" }],
  };
}

function renderPendingApprovals(props: OverviewProps) {
  const pending = Array.isArray(props.pendingDevices) ? props.pendingDevices : [];
  if (pending.length === 0) {
    return null;
  }
  const rows = pending.slice(0, 3);
  return html`
    <div class="callout" style="margin-top: 12px;">
      <div class="row" style="justify-content: space-between; align-items: center; gap: 8px;">
        <strong>Pending device approvals (${pending.length})</strong>
        <button class="btn btn--sm" ?disabled=${props.devicesLoading} @click=${props.onDevicesRefresh}>
          ${props.devicesLoading ? "Loading…" : "Refresh"}
        </button>
      </div>
      ${
        props.devicesError
          ? html`<div class="muted" style="margin-top: 8px;">${props.devicesError}</div>`
          : null
      }
      <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
        ${rows.map((req) => {
          const name = req.displayName?.trim() || req.deviceId;
          const meta = [req.role ? `role: ${req.role}` : "", req.remoteIp ? req.remoteIp : ""]
            .filter(Boolean)
            .join(" · ");
          return html`
            <div class="row" style="justify-content: space-between; align-items: center; gap: 8px;">
              <div>
                <div class="mono">${name}</div>
                <div class="muted">${meta || req.deviceId}</div>
              </div>
              <button
                class="btn btn--sm primary"
                ?disabled=${props.devicesLoading}
                @click=${() => props.onDeviceApprove(req.requestId)}
              >
                Approve
              </button>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function renderConnectionFixCard(fix: ConnectionFix | null) {
  if (!fix) {
    return null;
  }
  return html`
    <div class="callout" style="margin-top: 12px;">
      <div><strong>${fix.title}</strong></div>
      <div class="muted" style="margin-top: 4px;">${fix.message}</div>
      <div style="margin-top: 8px;">Run:</div>
      <pre class="code-block" style="margin-top: 6px;">${fix.commands.join("\n")}</pre>
      ${
        fix.docs?.length
          ? html`
              <div style="margin-top: 8px;">
                ${fix.docs.map(
                  (entry, index) => html`
                    ${index > 0 ? html`<span class="muted"> · </span>` : null}
                    <a class="session-link" href=${entry.href} target="_blank" rel="noreferrer">${entry.label}</a>
                  `,
                )}
              </div>
            `
          : null
      }
    </div>
  `;
}

export function renderOverview(props: OverviewProps) {
  const snapshot = props.hello?.snapshot as
    | {
        uptimeMs?: number;
        policy?: { tickIntervalMs?: number };
        authMode?: "none" | "token" | "password" | "trusted-proxy";
      }
    | undefined;
  const uptime = snapshot?.uptimeMs ? formatDurationHuman(snapshot.uptimeMs) : t("common.na");
  const tick = snapshot?.policy?.tickIntervalMs
    ? `${snapshot.policy.tickIntervalMs}ms`
    : t("common.na");
  const authMode = snapshot?.authMode;
  const isTrustedProxy = authMode === "trusted-proxy";
  const connectionFix = resolveConnectionFix(props.lastError);

  const authHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const lower = props.lastError.toLowerCase();
    const authFailed = lower.includes("unauthorized") || lower.includes("connect failed");
    if (!authFailed) {
      return null;
    }
    const hasToken = Boolean(props.settings.token.trim());
    const hasPassword = Boolean(props.password.trim());
    if (!hasToken && !hasPassword) {
      return html`
        <div class="muted" style="margin-top: 8px">
          ${t("overview.auth.required")}
          <div style="margin-top: 6px">
            <span class="mono">openclaw dashboard --no-open</span> → tokenized URL<br />
            <span class="mono">openclaw doctor --generate-gateway-token</span> → set token
          </div>
          <div style="margin-top: 6px">
            <a
              class="session-link"
              href="https://docs.openclaw.ai/web/dashboard"
              target="_blank"
              rel="noreferrer"
              title="Control UI auth docs (opens in new tab)"
              >Docs: Control UI auth</a
            >
          </div>
        </div>
      `;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.auth.failed", { command: "openclaw dashboard --no-open" })}
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/dashboard"
            target="_blank"
            rel="noreferrer"
            title="Control UI auth docs (opens in new tab)"
            >Docs: Control UI auth</a
          >
        </div>
      </div>
    `;
  })();

  const insecureContextHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : true;
    if (isSecureContext) {
      return null;
    }
    const lower = props.lastError.toLowerCase();
    if (!lower.includes("secure context") && !lower.includes("device identity required")) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.insecure.hint", { url: "http://127.0.0.1:18789" })}
        <div style="margin-top: 6px">
          ${t("overview.insecure.stayHttp", { config: "gateway.controlUi.allowInsecureAuth: true" })}
        </div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/gateway/tailscale"
            target="_blank"
            rel="noreferrer"
            title="Tailscale Serve docs (opens in new tab)"
            >Docs: Tailscale Serve</a
          >
          <span class="muted"> · </span>
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/control-ui#insecure-http"
            target="_blank"
            rel="noreferrer"
            title="Insecure HTTP docs (opens in new tab)"
            >Docs: Insecure HTTP</a
          >
        </div>
      </div>
    `;
  })();

  const currentLocale = i18n.getLocale();

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">${t("overview.access.title")}</div>
        <div class="card-sub">${t("overview.access.subtitle")}</div>
        <div class="form-grid" style="margin-top: 16px;">
          <label class="field">
            <span>${t("overview.access.wsUrl")}</span>
            <input
              .value=${props.settings.gatewayUrl}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSettingsChange({ ...props.settings, gatewayUrl: v });
              }}
              placeholder="ws://100.x.y.z:18789"
            />
          </label>
          ${
            isTrustedProxy
              ? ""
              : html`
                <label class="field">
                  <span>${t("overview.access.token")}</span>
                  <input
                    .value=${props.settings.token}
                    @input=${(e: Event) => {
                      const v = (e.target as HTMLInputElement).value;
                      props.onSettingsChange({ ...props.settings, token: v });
                    }}
                    placeholder="OPENCLAW_GATEWAY_TOKEN"
                  />
                </label>
                <label class="field">
                  <span>${t("overview.access.password")}</span>
                  <input
                    type="password"
                    .value=${props.password}
                    @input=${(e: Event) => {
                      const v = (e.target as HTMLInputElement).value;
                      props.onPasswordChange(v);
                    }}
                    placeholder="system or shared password"
                  />
                </label>
              `
          }
          <label class="field">
            <span>${t("overview.access.sessionKey")}</span>
            <input
              .value=${props.settings.sessionKey}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSessionKeyChange(v);
              }}
            />
          </label>
          <label class="field">
            <span>${t("overview.access.language")}</span>
            <select
              .value=${currentLocale}
              @change=${(e: Event) => {
                const v = (e.target as HTMLSelectElement).value as Locale;
                void i18n.setLocale(v);
                props.onSettingsChange({ ...props.settings, locale: v });
              }}
            >
              <option value="en">${t("languages.en")}</option>
              <option value="zh-CN">${t("languages.zhCN")}</option>
              <option value="zh-TW">${t("languages.zhTW")}</option>
              <option value="pt-BR">${t("languages.ptBR")}</option>
            </select>
          </label>
        </div>
        <div class="row" style="margin-top: 14px;">
          <button class="btn" @click=${() => props.onConnect()}>${t("common.connect")}</button>
          <button class="btn" @click=${() => props.onRefresh()}>${t("common.refresh")}</button>
          <span class="muted">${
            isTrustedProxy ? t("overview.access.trustedProxy") : t("overview.access.connectHint")
          }</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${t("overview.snapshot.title")}</div>
        <div class="card-sub">${t("overview.snapshot.subtitle")}</div>
        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.status")}</div>
            <div class="stat-value ${props.connected ? "ok" : "warn"}">
              ${props.connected ? t("common.ok") : t("common.offline")}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.uptime")}</div>
            <div class="stat-value">${uptime}</div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.tickInterval")}</div>
            <div class="stat-value">${tick}</div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.lastChannelsRefresh")}</div>
            <div class="stat-value">
              ${props.lastChannelsRefresh ? formatRelativeTimestamp(props.lastChannelsRefresh) : t("common.na")}
            </div>
          </div>
        </div>
        ${
          props.lastError
            ? html`<div class="callout danger" style="margin-top: 14px;">
              <div>${props.lastError}</div>
              ${authHint ?? ""}
              ${insecureContextHint ?? ""}
            </div>`
            : html`
                <div class="callout" style="margin-top: 14px">
                  ${t("overview.snapshot.channelsHint")}
                </div>
              `
        }
        ${renderConnectionFixCard(connectionFix)}
        ${connectionFix?.needsPairingApproval || props.pendingDevices.length > 0
          ? renderPendingApprovals(props)
          : null}
      </div>
    </section>

    <section class="grid grid-cols-3" style="margin-top: 18px;">
      <button
        type="button"
        class="card stat-card stat-card-action"
        @click=${() => props.onOpenRuntimePanel("instances")}
      >
        <div class="stat-label">${t("overview.stats.instances")}</div>
        <div class="stat-value">${props.presenceCount}</div>
        <div class="muted">${t("overview.stats.instancesHint")}</div>
      </button>
      <button
        type="button"
        class="card stat-card stat-card-action"
        @click=${() => props.onOpenRuntimePanel("sessions")}
      >
        <div class="stat-label">${t("overview.stats.sessions")}</div>
        <div class="stat-value">${props.sessionsCount ?? t("common.na")}</div>
        <div class="muted">${t("overview.stats.sessionsHint")}</div>
      </button>
      <button
        type="button"
        class="card stat-card stat-card-action"
        @click=${() => props.onOpenTab("cron")}
      >
        <div class="stat-label">${t("overview.stats.cron")}</div>
        <div class="stat-value">
          ${props.cronEnabled == null ? t("common.na") : props.cronEnabled ? t("common.enabled") : t("common.disabled")}
        </div>
        <div class="muted">${t("overview.stats.cronNext", { time: formatNextRun(props.cronNext) })}</div>
      </button>
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">${t("overview.notes.title")}</div>
      <div class="card-sub">${t("overview.notes.subtitle")}</div>
      <div class="note-grid" style="margin-top: 14px;">
        <div>
          <div class="note-title">${t("overview.notes.tailscaleTitle")}</div>
          <div class="muted">
            ${t("overview.notes.tailscaleText")}
          </div>
        </div>
        <div>
          <div class="note-title">${t("overview.notes.sessionTitle")}</div>
          <div class="muted">${t("overview.notes.sessionText")}</div>
        </div>
        <div>
          <div class="note-title">${t("overview.notes.cronTitle")}</div>
          <div class="muted">${t("overview.notes.cronText")}</div>
        </div>
      </div>
    </section>
  `;
}
