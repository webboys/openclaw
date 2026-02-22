import type { Command } from "commander";
import { formatAuthChoiceChoicesForCli } from "../../commands/auth-choice-options.js";
import { ONBOARD_PROVIDER_AUTH_FLAGS } from "../../commands/onboard-provider-auth-flags.js";
import type { AuthChoice, OnboardOptions } from "../../commands/onboard-types.js";
import { onboardCommand } from "../../commands/onboard.js";
import {
  formatQuickstartProviderIds,
  resolveApiKeyOptionKeyForAuthChoice,
  resolveQuickstartProviderPreset,
} from "../../commands/quickstart-provider.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";

type ProviderAuthOptionKey = (typeof ONBOARD_PROVIDER_AUTH_FLAGS)[number]["optionKey"];

type QuickstartCliOptions = {
  workspace?: string;
  nonInteractive?: boolean;
  acceptRisk?: boolean;
  provider?: string;
  apiKey?: string;
  authChoice?: AuthChoice;
  tokenProvider?: string;
  token?: string;
  tokenProfileId?: string;
  tokenExpiresIn?: string;
  cloudflareAiGatewayAccountId?: string;
  cloudflareAiGatewayGatewayId?: string;
  withChannels?: boolean;
  withSkills?: boolean;
  installDaemon?: boolean;
  json?: boolean;
} & Partial<Record<ProviderAuthOptionKey, string>>;

const AUTH_CHOICE_HELP = formatAuthChoiceChoicesForCli({
  includeLegacyAliases: true,
  includeSkip: true,
});

function resolveProviderAuthFlags(opts: QuickstartCliOptions): Partial<OnboardOptions> {
  const providerFlags: Partial<OnboardOptions> = {};
  for (const flag of ONBOARD_PROVIDER_AUTH_FLAGS) {
    const value = opts[flag.optionKey];
    if (typeof value === "string" && value.trim()) {
      (providerFlags as Record<string, string>)[flag.optionKey] = value;
    }
  }
  return providerFlags;
}

export function registerQuickstartCommand(program: Command) {
  const command = program
    .command("quickstart")
    .description("Fastest first-run local setup (quickstart flow + daemon + minimal setup)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/start/getting-started", "docs.openclaw.ai/start/getting-started")}\n`,
    )
    .option("--workspace <dir>", "Agent workspace directory (default: ~/.openclaw/workspace)")
    .option("--non-interactive", "Run without prompts", false)
    .option(
      "--accept-risk",
      "Acknowledge that agents are powerful and full system access is risky (required for --non-interactive)",
      false,
    )
    .option("--provider <id>", `Provider shortcut: ${formatQuickstartProviderIds()}`)
    .option("--api-key <key>", "API key used with --provider (or API-key auth choices)")
    .option("--auth-choice <choice>", `Auth: ${AUTH_CHOICE_HELP}`)
    .option(
      "--token-provider <id>",
      "Token provider id (non-interactive; used with --auth-choice token)",
    )
    .option("--token <token>", "Token value (non-interactive; used with --auth-choice token)")
    .option(
      "--token-profile-id <id>",
      "Auth profile id (non-interactive; default: <provider>:manual)",
    )
    .option("--token-expires-in <duration>", "Optional token expiry duration (e.g. 365d, 12h)")
    .option("--cloudflare-ai-gateway-account-id <id>", "Cloudflare Account ID")
    .option("--cloudflare-ai-gateway-gateway-id <id>", "Cloudflare AI Gateway ID");

  for (const providerFlag of ONBOARD_PROVIDER_AUTH_FLAGS) {
    command.option(providerFlag.cliOption, providerFlag.description);
  }

  command
    .option("--with-channels", "Run channel setup during quickstart", false)
    .option("--with-skills", "Run skills setup during quickstart", false)
    .option("--no-install-daemon", "Skip gateway service install")
    .option("--json", "Output JSON summary", false)
    .action(async (opts: QuickstartCliOptions) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const providerPreset = resolveQuickstartProviderPreset(opts.provider);
        if (typeof opts.provider === "string" && opts.provider.trim() && !providerPreset) {
          defaultRuntime.error(
            `Unknown --provider "${opts.provider}". Use one of: ${formatQuickstartProviderIds()}.`,
          );
          defaultRuntime.exit(1);
          return;
        }

        const authChoiceFromProvider = providerPreset?.authChoice;
        if (
          authChoiceFromProvider &&
          opts.authChoice &&
          opts.authChoice.trim() &&
          opts.authChoice !== authChoiceFromProvider
        ) {
          defaultRuntime.error(
            `--provider ${providerPreset.id} implies --auth-choice ${authChoiceFromProvider}; remove one of them.`,
          );
          defaultRuntime.exit(1);
          return;
        }

        const resolvedAuthChoice = authChoiceFromProvider ?? opts.authChoice;
        const resolvedTokenProvider = providerPreset?.tokenProvider ?? opts.tokenProvider;
        const resolvedApiKey =
          typeof opts.apiKey === "string" && opts.apiKey.trim() ? opts.apiKey.trim() : undefined;

        const providerAuthFlags = resolveProviderAuthFlags(opts);
        if (resolvedApiKey) {
          if (!resolvedAuthChoice) {
            defaultRuntime.error("Using --api-key requires --provider or --auth-choice.");
            defaultRuntime.exit(1);
            return;
          }
          const optionKey = resolveApiKeyOptionKeyForAuthChoice(resolvedAuthChoice);
          if (!optionKey) {
            defaultRuntime.error(
              `--api-key is not supported for --auth-choice ${resolvedAuthChoice}. Use provider-specific auth options instead.`,
            );
            defaultRuntime.exit(1);
            return;
          }
          (providerAuthFlags as Record<string, string>)[optionKey] = resolvedApiKey;
        }

        const resolvedToken =
          typeof opts.token === "string" && opts.token.trim()
            ? opts.token
            : resolvedApiKey && resolvedTokenProvider
              ? resolvedApiKey
              : opts.token;

        await onboardCommand(
          {
            flow: "quickstart",
            workspace: opts.workspace,
            nonInteractive: Boolean(opts.nonInteractive),
            acceptRisk: Boolean(opts.acceptRisk),
            authChoice: resolvedAuthChoice,
            tokenProvider: resolvedTokenProvider,
            token: resolvedToken,
            tokenProfileId: opts.tokenProfileId,
            tokenExpiresIn: opts.tokenExpiresIn,
            cloudflareAiGatewayAccountId: opts.cloudflareAiGatewayAccountId,
            cloudflareAiGatewayGatewayId: opts.cloudflareAiGatewayGatewayId,
            installDaemon: opts.installDaemon !== false,
            skipChannels: !opts.withChannels,
            skipSkills: !opts.withSkills,
            json: Boolean(opts.json),
            ...providerAuthFlags,
          },
          defaultRuntime,
        );
      });
    });
}
