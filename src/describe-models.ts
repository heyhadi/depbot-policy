// The models `describePolicy` can use, and which provider each runs on. Kept apart from
// describe.ts, which loads the provider SDKs, so the CLI's help text and the playground's
// picker can list them without loading anything.

/** A model provider that can write a policy from a description. */
export type DescribeProvider = "anthropic" | "google";

export interface DescribeModel {
  id: string;
  label: string;
  provider: DescribeProvider;
  /** One line for pickers: what it's good for and roughly what one policy costs. */
  summary: string;
  /**
   * Whether the Anthropic API may retry a refusal on another model (`fallbacks: "default"`).
   * Claude Haiku 5.5 has no server-side fallback, so it must not send the parameter. Google
   * models don't use it.
   */
  serverSideFallback: boolean;
}

// Costs assume ~2.5k input and 1–2k output tokens per policy, at each model's list price.
export const describeModels = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "anthropic",
    summary: "Recommended: best balance of quality and cost, about 3–5¢ per policy",
    serverSideFallback: true,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    provider: "anthropic",
    summary: "Faster and cheaper, about 2¢ per policy",
    serverSideFallback: true,
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    provider: "anthropic",
    summary: "Fastest and cheapest, well under 1¢ per policy",
    serverSideFallback: false,
  },
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    provider: "anthropic",
    summary: "Most capable and most expensive, about 8–13¢ per policy",
    serverSideFallback: true,
  },
  {
    id: "gemini-3-pro-preview",
    label: "Gemini 3 Pro",
    provider: "google",
    summary: "Google's strongest model for complex policies, about 2–4¢ per policy",
    serverSideFallback: false,
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    provider: "google",
    summary: "Fast and inexpensive, well under 1¢ per policy",
    serverSideFallback: false,
  },
] as const satisfies readonly DescribeModel[];

export type DescribeModelId = (typeof describeModels)[number]["id"];

export const defaultDescribeModel: DescribeModelId = "claude-opus-5-5";

export function isDescribeModelId(value: string): value is DescribeModelId {
  return describeModels.some((model) => model.id === value);
}

/** The model with the given id. Callers must pass an id from `describeModels`. */
export function describeModel(model: DescribeModelId): DescribeModel {
  return describeModels.find((candidate) => candidate.id === model)!;
}

/** A short, friendly name for a provider, used in the CLI and playground copy. */
export function providerLabel(provider: DescribeProvider): string {
  return provider === "anthropic" ? "Claude" : "Gemini";
}

/** The API-key environment variable a provider reads when no client is passed. */
export function providerEnvVar(provider: DescribeProvider): string {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
}
