// The models `describePolicy` can use. Kept apart from describe.ts, which loads the provider SDKs,
// so the CLI's help text and the playground's picker can list them without loading any SDK.
// Each model names its provider; everything else (clients, schemas) follows from that.

/** Which API a model runs on. Drives the SDK client, the key it reads, and the failure copy. */
export type DescribeProvider = "anthropic" | "google";

export interface DescribeModel {
  id: string;
  label: string;
  /** One line for pickers: what it's good for and roughly what one policy costs. */
  summary: string;
  /** Which provider runs the model. */
  provider: DescribeProvider;
  /**
   * Whether the API may retry a refusal on another model (`fallbacks: "default"`).
   * Claude Haiku 5.5 has no server-side fallback, so it must not send the parameter.
   */
  serverSideFallback: boolean;
}

// Costs assume ~2.5k input and 1–2k output tokens per policy, at each model's list price.
// Gemini ids are exactly as listed on ai.google.dev/gemini-api/docs/models. Both are preview
// models, so Google may change or retire them.
export const describeModels = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    summary: "Recommended: best balance of quality and cost, about 3–5¢ per policy",
    provider: "anthropic",
    serverSideFallback: true,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    summary: "Faster and cheaper, about 2¢ per policy",
    provider: "anthropic",
    serverSideFallback: true,
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    summary: "Fastest and cheapest, well under 1¢ per policy",
    provider: "anthropic",
    serverSideFallback: false,
  },
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    summary: "Most capable and most expensive, about 8–13¢ per policy",
    provider: "anthropic",
    serverSideFallback: true,
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    summary: "Fast and cheap, under 1¢ per policy (free tier available)",
    provider: "google",
    serverSideFallback: false,
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    summary: "More capable, about 2–3¢ per policy",
    provider: "google",
    serverSideFallback: false,
  },
] as const satisfies readonly DescribeModel[];

export type DescribeModelId = (typeof describeModels)[number]["id"];

export const defaultDescribeModel: DescribeModelId = "claude-opus-5-5";

/** The model with the given id, or undefined if it isn't supported. */
export function describeModel(model: DescribeModelId): DescribeModel {
  return describeModels.find((candidate) => candidate.id === model)!;
}

/** A short, friendly name for a provider, used in CLI and playground copy. */
export function providerLabel(provider: DescribeProvider): string {
  return provider === "anthropic" ? "Claude" : "Gemini";
}

/** The provider a given model runs on. */
export function providerFor(model: DescribeModelId): DescribeProvider {
  return describeModel(model).provider;
}

export function isDescribeModelId(value: string): value is DescribeModelId {
  return describeModels.some((model) => model.id === value);
}
