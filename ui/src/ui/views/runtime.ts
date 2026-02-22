import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { renderInstances, type InstancesProps } from "./instances.ts";
import { renderSessions, type SessionsProps } from "./sessions.ts";

export type RuntimePanel = "instances" | "sessions";

export type RuntimeProps = {
  panel: RuntimePanel;
  presenceCount: number;
  sessionsCount: number | null;
  onPanelChange: (panel: RuntimePanel) => void;
  onOpenChannels: () => void;
  onOpenChat: () => void;
  instances: InstancesProps;
  sessions: SessionsProps;
};

export function renderRuntime(props: RuntimeProps) {
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; align-items: flex-end; gap: 12px;">
        <div>
          <div class="card-title">${t("tabs.runtime")}</div>
          <div class="card-sub">
            ${t("tabs.instances")}: <span class="mono">${props.presenceCount}</span>
            <span class="muted"> / </span>
            ${t("tabs.sessions")}: <span class="mono">${props.sessionsCount ?? t("common.na")}</span>
          </div>
        </div>
        <div class="row" style="gap: 8px;">
          <button
            class="btn btn--sm ${props.panel === "instances" ? "active" : ""}"
            @click=${() => props.onPanelChange("instances")}
          >
            ${t("tabs.instances")}
          </button>
          <button
            class="btn btn--sm ${props.panel === "sessions" ? "active" : ""}"
            @click=${() => props.onPanelChange("sessions")}
          >
            ${t("tabs.sessions")}
          </button>
        </div>
      </div>
      ${
        props.panel === "instances" && props.presenceCount === 0
          ? html`
              <div class="callout" style="margin-top: 12px;">
                <div class="row" style="justify-content: space-between; gap: 8px; align-items: center;">
                  <span>No instances are reporting yet.</span>
                  <button class="btn btn--sm" @click=${props.onOpenChannels}>Open Channels</button>
                </div>
              </div>
            `
          : nothing
      }
      ${
        props.panel === "sessions" && props.sessionsCount === 0
          ? html`
              <div class="callout" style="margin-top: 12px;">
                <div class="row" style="justify-content: space-between; gap: 8px; align-items: center;">
                  <span>No sessions found yet.</span>
                  <button class="btn btn--sm" @click=${props.onOpenChat}>Open Chat</button>
                </div>
              </div>
            `
          : nothing
      }
    </section>
    ${props.panel === "instances" ? renderInstances(props.instances) : renderSessions(props.sessions)}
  `;
}
