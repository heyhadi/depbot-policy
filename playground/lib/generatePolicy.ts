import type { DescribeModelId, DescribeResult } from "depbot-policy/describe";

// The provider SDKs are loaded only when someone generates a policy, not on page load.
const loadDescribe = () => import("depbot-policy/describe");

/** Asks the chosen model (Claude or Gemini), with the visitor's own API key, to write a policy. */
export async function generatePolicy(
  description: string,
  apiKey: string,
  model: DescribeModelId,
): Promise<DescribeResult> {
  const { browserClient, describePolicy, providerFor } = await loadDescribe();
  return describePolicy(description, browserClient(providerFor(model), apiKey), { model });
}

export async function explainFailure(error: unknown): Promise<string> {
  const { describeFailureMessage } = await loadDescribe();
  return describeFailureMessage(error);
}
