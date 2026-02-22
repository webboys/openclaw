import { ONBOARD_PROVIDER_AUTH_FLAGS } from "./onboard-provider-auth-flags.js";
import type { AuthChoice } from "./onboard-types.js";

export type QuickstartProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "moonshot"
  | "zai"
  | "xai"
  | "together";

export type QuickstartProviderPreset = {
  id: QuickstartProviderId;
  label: string;
  authChoice: AuthChoice;
  tokenProvider: string;
};

export type QuickstartApiKeyOptionKey = (typeof ONBOARD_PROVIDER_AUTH_FLAGS)[number]["optionKey"];

const QUICKSTART_PROVIDER_PRESETS: readonly QuickstartProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    authChoice: "openai-api-key",
    tokenProvider: "openai",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    authChoice: "apiKey",
    tokenProvider: "anthropic",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    authChoice: "gemini-api-key",
    tokenProvider: "google",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    authChoice: "openrouter-api-key",
    tokenProvider: "openrouter",
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    authChoice: "moonshot-api-key",
    tokenProvider: "moonshot",
  },
  {
    id: "zai",
    label: "Z.AI",
    authChoice: "zai-api-key",
    tokenProvider: "zai",
  },
  {
    id: "xai",
    label: "xAI",
    authChoice: "xai-api-key",
    tokenProvider: "xai",
  },
  {
    id: "together",
    label: "Together AI",
    authChoice: "together-api-key",
    tokenProvider: "together",
  },
];

const QUICKSTART_PROVIDER_ALIASES: Record<string, QuickstartProviderId> = {
  anthropic: "anthropic",
  claude: "anthropic",
  gemini: "gemini",
  google: "gemini",
  moonshot: "moonshot",
  openai: "openai",
  openrouter: "openrouter",
  together: "together",
  xai: "xai",
  zai: "zai",
};

export function listQuickstartProviderPresets(): readonly QuickstartProviderPreset[] {
  return QUICKSTART_PROVIDER_PRESETS;
}

export function resolveQuickstartProviderPreset(
  input: string | undefined,
): QuickstartProviderPreset | undefined {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const resolvedId = QUICKSTART_PROVIDER_ALIASES[normalized];
  if (!resolvedId) {
    return undefined;
  }
  return QUICKSTART_PROVIDER_PRESETS.find((preset) => preset.id === resolvedId);
}

export function formatQuickstartProviderIds(): string {
  return listQuickstartProviderPresets()
    .map((preset) => preset.id)
    .join("|");
}

export function resolveApiKeyOptionKeyForAuthChoice(
  authChoice: AuthChoice,
): QuickstartApiKeyOptionKey | undefined {
  if (authChoice === "moonshot-api-key-cn") {
    return "moonshotApiKey";
  }
  if (authChoice === "minimax-api-key-cn" || authChoice === "minimax-api-lightning") {
    return "minimaxApiKey";
  }
  if (
    authChoice === "zai-coding-global" ||
    authChoice === "zai-coding-cn" ||
    authChoice === "zai-global" ||
    authChoice === "zai-cn"
  ) {
    return "zaiApiKey";
  }
  const matched = ONBOARD_PROVIDER_AUTH_FLAGS.find((flag) => flag.authChoice === authChoice);
  return matched?.optionKey;
}
