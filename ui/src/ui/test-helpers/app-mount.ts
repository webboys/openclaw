import { afterEach, beforeEach } from "vitest";
import { OpenClawApp } from "../app.ts";

function ensureAppElementRegistered() {
  if (customElements.get("openclaw-app")) {
    return;
  }
  customElements.define("openclaw-app", OpenClawApp);
}

export function mountApp(pathname: string) {
  ensureAppElementRegistered();
  window.history.replaceState({}, "", pathname);
  const app = document.createElement("openclaw-app") as OpenClawApp;
  app.connect = () => {
    // no-op: avoid real gateway WS connections in browser tests
  };
  document.body.append(app);
  return app;
}

export function registerAppMountHooks() {
  beforeEach(() => {
    window.__OPENCLAW_CONTROL_UI_BASE_PATH__ = undefined;
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    window.__OPENCLAW_CONTROL_UI_BASE_PATH__ = undefined;
    localStorage.clear();
    document.body.innerHTML = "";
  });
}
