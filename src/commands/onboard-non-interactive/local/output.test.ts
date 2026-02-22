import { describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../../../runtime.js";
import type { OnboardOptions } from "../../onboard-types.js";
import { logNonInteractiveOnboardingJson } from "./output.js";

function createRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("logNonInteractiveOnboardingJson", () => {
  it("does nothing when --json is disabled", () => {
    const runtime = createRuntime();
    logNonInteractiveOnboardingJson({
      opts: { json: false } as OnboardOptions,
      runtime,
      mode: "local",
    });
    expect(runtime.log).not.toHaveBeenCalled();
  });

  it("prints machine-readable onboarding summary when --json is enabled", () => {
    const runtime = createRuntime();
    logNonInteractiveOnboardingJson({
      opts: { json: true } as OnboardOptions,
      runtime,
      mode: "local",
      workspaceDir: "/tmp/workspace",
      authChoice: "skip",
      gateway: {
        port: 18789,
        bind: "loopback",
        authMode: "token",
        tailscaleMode: "off",
      },
      installDaemon: false,
      skipSkills: true,
      skipHealth: true,
      controlUi: {
        httpUrl: "http://127.0.0.1:18789/",
        wsUrl: "ws://127.0.0.1:18789",
      },
      auth: {
        mode: "token",
        hasGatewayToken: true,
        hasGatewayPassword: false,
      },
      verification: {
        gatewayProbe: {
          ok: true,
        },
        healthCheck: {
          attempted: false,
          passed: false,
        },
      },
    });

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const raw = (runtime.log as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0];
    expect(typeof raw).toBe("string");
    const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      mode: "local",
      workspace: "/tmp/workspace",
      authChoice: "skip",
      gateway: {
        port: 18789,
        bind: "loopback",
        authMode: "token",
        tailscaleMode: "off",
      },
      controlUi: {
        httpUrl: "http://127.0.0.1:18789/",
        wsUrl: "ws://127.0.0.1:18789",
      },
      auth: {
        mode: "token",
        hasGatewayToken: true,
        hasGatewayPassword: false,
      },
      verification: {
        gatewayProbe: { ok: true },
        healthCheck: { attempted: false, passed: false },
      },
    });
  });
});
