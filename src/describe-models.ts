// The models `describePolicy` can use. Kept apart from describe.ts, which loads the Anthropic SDK,
// so the CLI's help text and the playground's picker can list them without loading it.

export interface DescribeModel {
  id: string;
  label: string;
  /** One line for pickers: what it's good for and roughly what one policy costs. */
  summary: string;
  /**
   * Whether the API may retry a refusal on another model (`fallbacks: "default"`).
   * Claude Haiku 5.5 has no server-side fallback, so it must not send the parameter.
   */
  serverSideFallback: boolean;
}

// Costs assume ~2.5k input and 1–2k output tokens per policy, at each model's list price.
export const describeModels = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    summary: "Recommended: best balance of quality and cost, about 3–5¢ per policy",
    serverSideFallback: true,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    summary: "Faster and cheaper, about 2¢ per policy",
    serverSideFallback: true,
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    summary: "Fastest and cheapest, well under 1¢ per policy",
    serverSideFallback: false,
  },
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    summary: "Most capable and most expensive, about 8–13¢ per policy",
    serverSideFallback: true,
  },
] as const satisfies readonly DescribeModel[];

export type DescribeModelId = (typeof describeModels)[number]["id"];

export const defaultDescribeModel: DescribeModelId = "claude-opus-5-5";

export function isDescribeModelId(value: string): value is DescribeModelId {
  return describeModels.some((model) => model.id === value);
}
