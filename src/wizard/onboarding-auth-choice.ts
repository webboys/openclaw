import type { AuthChoice, OnboardOptions } from "../commands/onboard-types.js";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "./prompts.js";

export type OnboardingAuthApplyOptions = {
  tokenProvider?: string;
  token?: string;
  cloudflareAiGatewayAccountId?: string;
  cloudflareAiGatewayGatewayId?: string;
  cloudflareAiGatewayApiKey?: string;
  xaiApiKey?: string;
};

export async function resolveOnboardingAuthChoice(params: {
  opts: OnboardOptions;
  useFreshQuickstartProviderPrompt: boolean;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
  baseConfig: OpenClawConfig;
  nextConfig: OpenClawConfig;
  authApplyOpts: OnboardingAuthApplyOptions;
}): Promise<{
  authChoiceFromPrompt: boolean;
  authChoice: AuthChoice;
  authHandledByNonInteractivePath: boolean;
  nextConfig: OpenClawConfig;
} | null> {
  let authChoiceFromPrompt = params.opts.authChoice === undefined;
  let authChoice: AuthChoice = params.opts.authChoice ?? "skip";
  let authHandledByNonInteractivePath = false;
  let nextConfig = params.nextConfig;

  if (params.opts.authChoice === undefined) {
    if (params.useFreshQuickstartProviderPrompt) {
      const { normalizeApiKeyInput, validateApiKeyInput } =
        await import("../commands/auth-choice.api-key.js");
      const { listQuickstartProviderPresets, resolveApiKeyOptionKeyForAuthChoice } =
        await import("../commands/quickstart-provider.js");
      const quickstartProviders = listQuickstartProviderPresets();
      type QuickstartSelection = (typeof quickstartProviders)[number]["id"] | "skip" | "advanced";
      const presetById = new Map(quickstartProviders.map((preset) => [preset.id, preset] as const));

      const quickstartSelection = await params.prompter.select<QuickstartSelection>({
        message: "Quickstart provider",
        options: [
          ...quickstartProviders.map((preset) => ({
            value: preset.id,
            label: preset.label,
            hint: preset.authChoice,
          })),
          { value: "skip", label: "Skip for now", hint: "Configure provider later" },
          { value: "advanced", label: "More providers", hint: "Open full provider menu" },
        ],
        initialValue: "openai",
      });

      if (quickstartSelection === "skip") {
        authChoice = "skip";
        authChoiceFromPrompt = false;
      } else if (quickstartSelection === "advanced") {
        const { ensureAuthProfileStore } = await import("../agents/auth-profiles.js");
        const { promptAuthChoiceGrouped } = await import("../commands/auth-choice-prompt.js");
        const authStore = ensureAuthProfileStore(undefined, {
          allowKeychainPrompt: false,
        });
        authChoice = await promptAuthChoiceGrouped({
          prompter: params.prompter,
          store: authStore,
          includeSkip: true,
        });
        authChoiceFromPrompt = true;
      } else {
        const providerPreset = presetById.get(quickstartSelection);
        if (providerPreset) {
          const keyRaw = await params.prompter.text({
            message: `Enter ${providerPreset.label} API key`,
            validate: validateApiKeyInput,
          });
          const apiKey = normalizeApiKeyInput(String(keyRaw ?? ""));
          authChoice = providerPreset.authChoice;
          authChoiceFromPrompt = false;
          params.authApplyOpts.tokenProvider = providerPreset.tokenProvider;
          params.authApplyOpts.token = apiKey;

          const optionKey = resolveApiKeyOptionKeyForAuthChoice(authChoice);
          if (optionKey) {
            const optsWithApiKey = {
              ...params.opts,
              authChoice,
              tokenProvider: providerPreset.tokenProvider,
              token: apiKey,
              [optionKey]: apiKey,
            } as OnboardOptions;
            const { applyNonInteractiveAuthChoice } =
              await import("../commands/onboard-non-interactive/local/auth-choice.js");
            const authResult = await applyNonInteractiveAuthChoice({
              nextConfig,
              authChoice,
              opts: optsWithApiKey,
              runtime: params.runtime,
              baseConfig: params.baseConfig,
            });
            if (!authResult) {
              return null;
            }
            nextConfig = authResult;
            authHandledByNonInteractivePath = true;
          }
        }
      }
    } else {
      const { ensureAuthProfileStore } = await import("../agents/auth-profiles.js");
      const { promptAuthChoiceGrouped } = await import("../commands/auth-choice-prompt.js");
      const authStore = ensureAuthProfileStore(undefined, {
        allowKeychainPrompt: false,
      });
      authChoice = await promptAuthChoiceGrouped({
        prompter: params.prompter,
        store: authStore,
        includeSkip: true,
      });
      authChoiceFromPrompt = true;
    }
  }

  return {
    authChoiceFromPrompt,
    authChoice,
    authHandledByNonInteractivePath,
    nextConfig,
  };
}
