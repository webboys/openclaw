import { describe, expect, it } from "vitest";
import "../styles.css";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

function mountApp(pathname: string) {
  return mountTestApp(pathname);
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

describe("control UI routing", () => {
  it("hydrates runtime tab from the location", async () => {
    const app = mountApp("/runtime");
    await app.updateComplete;

    expect(app.tab).toBe("runtime");
    expect(window.location.pathname).toBe("/runtime");
  });

  it("hydrates runtime panel from query params", async () => {
    const app = mountApp("/runtime?panel=sessions");
    await app.updateComplete;

    expect(app.tab).toBe("runtime");
    expect(app.runtimePanel).toBe("sessions");
    expect(window.location.pathname).toBe("/runtime");
    expect(window.location.search).toBe("?panel=sessions");
  });

  it("updates runtime panel query params when switching panels", async () => {
    const app = mountApp("/runtime?panel=instances");
    await app.updateComplete;

    const sessionButton = Array.from(app.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Sessions",
    );
    expect(sessionButton).not.toBeNull();
    sessionButton?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );

    await app.updateComplete;
    expect(app.runtimePanel).toBe("sessions");
    expect(window.location.pathname).toBe("/runtime");
    expect(window.location.search).toBe("?panel=sessions");
  });

  it("normalizes invalid runtime panel query params", async () => {
    const app = mountApp("/runtime?panel=unknown");
    await app.updateComplete;

    expect(app.tab).toBe("runtime");
    expect(app.runtimePanel).toBe("instances");
    expect(window.location.pathname).toBe("/runtime");
    expect(window.location.search).toBe("?panel=instances");
  });

  it("rewrites legacy routes during popstate navigation", async () => {
    const app = mountApp("/runtime?panel=instances");
    await app.updateComplete;

    window.history.pushState({}, "", "/sessions");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await app.updateComplete;

    expect(app.tab).toBe("runtime");
    expect(app.runtimePanel).toBe("sessions");
    expect(window.location.pathname).toBe("/runtime");
    expect(window.location.search).toBe("?panel=sessions");
  });

  it("opens Channels from runtime instances empty state", async () => {
    const app = mountApp("/runtime?panel=instances");
    await app.updateComplete;

    const openChannelsButton = Array.from(app.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Open Channels",
    );
    expect(openChannelsButton).not.toBeNull();
    openChannelsButton?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );

    await app.updateComplete;
    expect(app.tab).toBe("channels");
    expect(window.location.pathname).toBe("/channels");
  });

  it("opens Chat from runtime sessions empty state", async () => {
    const app = mountApp("/runtime?panel=sessions");
    await app.updateComplete;

    app.sessionsResult = {
      ts: Date.now(),
      path: "/tmp/sessions.json",
      count: 0,
      defaults: { model: null, contextTokens: null },
      sessions: [],
    };
    await app.updateComplete;

    const openChatButton = Array.from(app.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Open Chat",
    );
    expect(openChatButton).not.toBeNull();
    openChatButton?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );

    await app.updateComplete;
    expect(app.tab).toBe("chat");
    expect(window.location.pathname).toBe("/chat");
    expect(window.location.search).toBe("?session=main");
  });

  it("soft-redirects legacy /sessions routes to runtime panel", async () => {
    const app = mountApp("/sessions");
    await app.updateComplete;

    expect(app.tab).toBe("runtime");
    expect(app.runtimePanel).toBe("sessions");
    expect(window.location.pathname).toBe("/runtime");
    expect(window.location.search).toBe("?panel=sessions");
  });

  it("soft-redirects legacy /instances routes to runtime panel", async () => {
    const app = mountApp("/instances");
    await app.updateComplete;

    expect(app.tab).toBe("runtime");
    expect(app.runtimePanel).toBe("instances");
    expect(window.location.pathname).toBe("/runtime");
    expect(window.location.search).toBe("?panel=instances");
  });

  it("respects /ui base paths", async () => {
    const app = mountApp("/ui/cron");
    await app.updateComplete;

    expect(app.basePath).toBe("/ui");
    expect(app.tab).toBe("cron");
    expect(window.location.pathname).toBe("/ui/cron");
  });

  it("infers nested base paths", async () => {
    const app = mountApp("/apps/openclaw/cron");
    await app.updateComplete;

    expect(app.basePath).toBe("/apps/openclaw");
    expect(app.tab).toBe("cron");
    expect(window.location.pathname).toBe("/apps/openclaw/cron");
  });

  it("honors explicit base path overrides", async () => {
    window.__OPENCLAW_CONTROL_UI_BASE_PATH__ = "/openclaw";
    const app = mountApp("/openclaw/sessions");
    await app.updateComplete;

    expect(app.basePath).toBe("/openclaw");
    expect(app.tab).toBe("runtime");
    expect(app.runtimePanel).toBe("sessions");
    expect(window.location.pathname).toBe("/openclaw/runtime");
    expect(window.location.search).toBe("?panel=sessions");
  });

  it("updates the URL when clicking nav items", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/channels"]');
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("channels");
    expect(window.location.pathname).toBe("/channels");
  });

  it("starts in beginner navigation mode and can reveal advanced tabs", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(app.querySelector('a.nav-item[href="/debug"]')).toBeNull();

    const showAllButton = Array.from(app.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Show all tabs",
    );
    expect(showAllButton).not.toBeNull();
    showAllButton?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await app.updateComplete;

    expect(app.querySelector('a.nav-item[href="/debug"]')).not.toBeNull();
  });

  it("resets to the main session when opening chat from sidebar navigation", async () => {
    const app = mountApp("/sessions?session=agent:main:subagent:task-123");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/chat"]');
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("chat");
    expect(app.sessionKey).toBe("main");
    expect(window.location.pathname).toBe("/chat");
    expect(window.location.search).toBe("?session=main");
  });

  it("keeps chat and nav usable on narrow viewports", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const split = app.querySelector(".chat-split-container");
    expect(split).not.toBeNull();
    if (split) {
      expect(getComputedStyle(split).position).not.toBe("fixed");
    }

    const chatMain = app.querySelector(".chat-main");
    expect(chatMain).not.toBeNull();
    if (chatMain) {
      expect(getComputedStyle(chatMain).display).not.toBe("none");
    }

    if (split) {
      split.classList.add("chat-split-container--open");
      await app.updateComplete;
      expect(getComputedStyle(split).position).toBe("fixed");
    }
    if (chatMain) {
      expect(getComputedStyle(chatMain).display).toBe("none");
    }
  });

  it("auto-scrolls chat history to the latest message", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    const initialContainer: HTMLElement | null = app.querySelector(".chat-thread");
    expect(initialContainer).not.toBeNull();
    if (!initialContainer) {
      return;
    }
    initialContainer.style.maxHeight = "180px";
    initialContainer.style.overflow = "auto";

    app.chatMessages = Array.from({ length: 60 }, (_, index) => ({
      role: "assistant",
      content: `Line ${index} - ${"x".repeat(200)}`,
      timestamp: Date.now() + index,
    }));

    await app.updateComplete;
    for (let i = 0; i < 6; i++) {
      await nextFrame();
    }

    const container = app.querySelector(".chat-thread");
    expect(container).not.toBeNull();
    if (!container) {
      return;
    }
    const maxScroll = container.scrollHeight - container.clientHeight;
    expect(maxScroll).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) {
      if (container.scrollTop === maxScroll) {
        break;
      }
      await nextFrame();
    }
    expect(container.scrollTop).toBe(maxScroll);
  });

  it("hydrates token from URL params and strips it", async () => {
    const app = mountApp("/ui/overview?token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(window.location.pathname).toBe("/ui/overview");
    expect(window.location.search).toBe("");
  });

  it("strips password URL params without importing them", async () => {
    const app = mountApp("/ui/overview?password=sekret");
    await app.updateComplete;

    expect(app.password).toBe("");
    expect(window.location.pathname).toBe("/ui/overview");
    expect(window.location.search).toBe("");
  });

  it("hydrates token from URL params even when settings already set", async () => {
    localStorage.setItem(
      "openclaw.control.settings.v1",
      JSON.stringify({ token: "existing-token" }),
    );
    const app = mountApp("/ui/overview?token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(window.location.pathname).toBe("/ui/overview");
    expect(window.location.search).toBe("");
  });

  it("hydrates token from URL hash and strips it", async () => {
    const app = mountApp("/ui/overview#token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(window.location.pathname).toBe("/ui/overview");
    expect(window.location.hash).toBe("");
  });
});
