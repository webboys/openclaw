import type { RuntimeEnv } from "../../../runtime.js";
import type { OnboardOptions } from "../../onboard-types.js";

export function logNonInteractiveOnboardingJson(params: {
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  mode: "local" | "remote";
  workspaceDir?: string;
  authChoice?: string;
  gateway?: {
    port: number;
    bind: string;
    authMode: string;
    tailscaleMode: string;
  };
  installDaemon?: boolean;
  daemonRuntime?: string;
  skipSkills?: boolean;
  skipHealth?: boolean;
  controlUi?: {
    httpUrl: string;
    wsUrl: string;
  };
  auth?: {
    mode: string;
    hasGatewayToken: boolean;
    hasGatewayPassword: boolean;
  };
  verification?: {
    gatewayProbe: {
      ok: boolean;
      detail?: string;
    };
    healthCheck: {
      attempted: boolean;
      passed: boolean;
    };
  };
}) {
  if (!params.opts.json) {
    return;
  }
  params.runtime.log(
    JSON.stringify(
      {
        mode: params.mode,
        workspace: params.workspaceDir,
        authChoice: params.authChoice,
        gateway: params.gateway,
        installDaemon: Boolean(params.installDaemon),
        daemonRuntime: params.daemonRuntime,
        skipSkills: Boolean(params.skipSkills),
        skipHealth: Boolean(params.skipHealth),
        controlUi: params.controlUi,
        auth: params.auth,
        verification: params.verification,
      },
      null,
      2,
    ),
  );
}
