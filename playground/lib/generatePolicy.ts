import type { DescribeModelId, DescribeResult } from "depbot-policy/describe";

// The Anthropic SDK is loaded only when someone generates a policy, not on page load.
const loadDescribe = () => import("depbot-policy/describe");

/** Asks Claude, with the visitor's own API key, to write a policy from a description. */
export async function generatePolicy(
  description: string,
  apiKey: string,
  model: DescribeModelId,
): Promise<DescribeResult> {
  const { browserClient, describePolicy } = await loadDescribe();
  return describePolicy(description, browserClient(apiKey), { model });
}

export async function explainFailure(error: unknown): Promise<string> {
  const { describeFailureMessage } = await loadDescribe();
  return describeFailureMessage(error);
}
