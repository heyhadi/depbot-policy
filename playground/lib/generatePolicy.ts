import type { DescribeModelId, DescribeResult } from "depbot-policy/describe";

// The provider SDKs are loaded only when someone generates a policy, not on page load.
const loadDescribe = () => import("depbot-policy/describe");

/**
 * Asks the chosen model, with the visitor's own API key, to write a policy from a description.
 * The provider (Anthropic or Google) is derived from the model, so one key field and one call
 * cover both.
 */
export async function generatePolicy(
  description: string,
  apiKey: string,
  model: DescribeModelId,
): Promise<DescribeResult> {
  const { browserClient, describePolicy, describeModel } = await loadDescribe();
  return describePolicy(description, browserClient(apiKey, describeModel(model).provider), {
    model,
  });
}

export async function explainFailure(error: unknown): Promise<string> {
  const { describeFailureMessage } = await loadDescribe();
  return describeFailureMessage(error);
}
