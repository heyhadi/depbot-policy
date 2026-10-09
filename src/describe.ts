import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Document, isScalar, visit } from "yaml";
import { z } from "zod";
import { parsePolicy, type PolicyError } from "./parse.ts";
import { ecosystemTypes } from "./schema.ts";

export const describeModel = "claude-opus-5-5";

/**
 * What Claude fills in. It's a simplified, refinement-free version of the policy schema, because
 * structured outputs can't express cross-field rules or defaults. Our own code turns the draft into
 * YAML, and `parsePolicy` still applies every rule, so the model can never bypass validation.
 * A reply outside this schema (say, `major` as an update type) is rejected when the SDK parses it.
 */
export const policyDraftSchema = z.object({
  ecosystems: z
    .array(
      z.object({
        type: z.enum(ecosystemTypes),
        directory: z.string().describe('Path from the repository root, starting with "/"'),
        schedule: z.enum(["daily", "weekly", "monthly"]),
      }),
    )
    .describe("One entry per package manager and directory"),
  autoMerge: z.object({
    updateTypes: z.array(z.enum(["patch", "minor"])),
    dependencyTypes: z.array(z.enum(["development", "production"])),
    mergeMethod: z.enum(["squash", "merge", "rebase"]),
  }),
  block: z
    .array(
      z.object({
        name: z.string().describe('Package name or glob, e.g. "@types/*"'),
        reason: z.string().describe("Why it's blocked, in the user's words where possible"),
        ecosystems: z
          .array(z.enum(ecosystemTypes))
          .describe("Ecosystems the block applies to; empty means all of them"),
      }),
    )
    .describe("Packages Dependabot must never update; empty if none were mentioned"),
  reviewRotation: z
    .array(z.string())
    .describe("GitHub usernames without @, in the order given; empty if none were named"),
  notes: z
    .array(z.string())
    .describe("Short notes on assumptions made or requests that couldn't be honoured"),
});

export type PolicyDraft = z.infer<typeof policyDraftSchema>;

const systemPrompt = `You turn a team's plain-language description of how they want Dependabot to behave into a depbot-policy draft.

How to fill each field:
- ecosystems: one entry per package manager and directory. Yarn, pnpm and Bun projects use "npm"; Poetry and Pipenv use "pip"; Go modules use "gomod"; Rust uses "cargo"; Ruby uses "bundler"; Dockerfiles use "docker"; GitHub Actions workflows use "github-actions" with directory "/". Directories start with "/", and "/" is the repository root. In a monorepo, list each package directory the user mentions. Use the schedule they ask for, otherwise "weekly" ("monthly" for github-actions).
- autoMerge: unless the user says otherwise, use updateTypes ["patch"], both dependency types, and "squash". Include "minor" only if the user explicitly allows it. Major updates can never be auto-merged; if the user asks for that, leave majors out and say so in notes.
- block: only packages the user says to pin, freeze or never update. Keep their reason. Limit the block to an ecosystem when the package clearly belongs to one.
- reviewRotation: only GitHub usernames the user actually gives, without "@". Never invent people.
- notes: brief, one sentence each, for any assumption you made or anything you couldn't do. Leave it empty when there's nothing worth saying.`;

export interface DescribeResult {
  /** The policy as YAML, ready to save as depbot.policy.yml. */
  source: string;
  /** Validation errors still present after one repair attempt; empty when the policy is valid. */
  errors: PolicyError[];
  /** Claude's notes on assumptions it made. */
  notes: string[];
}

export class DescribeError extends Error {
  override name = "DescribeError";
}

/**
 * Asks Claude to write a policy from a plain-language description, validates it with
 * `parsePolicy`, and gives Claude one chance to fix any errors.
 */
export async function describePolicy(description: string, client: Anthropic): Promise<DescribeResult> {
  const first = await requestDraft(client, description);
  const firstSource = draftToYaml(first);
  const firstResult = parsePolicy(firstSource);
  if (firstResult.ok) return { source: firstSource, errors: [], notes: first.notes };

  const repair = await requestDraft(
    client,
    `${description}

A previous attempt produced this policy, which fails validation:

${firstSource}
Errors:
${firstResult.errors.map((error) => `- ${error.path || "(file)"}: ${error.message}`).join("\n")}

Return a corrected draft.`,
  );
  const source = draftToYaml(repair);
  const result = parsePolicy(source);
  return { source, errors: result.ok ? [] : result.errors, notes: repair.notes };
}

async function requestDraft(client: Anthropic, content: string): Promise<PolicyDraft> {
  let response;
  try {
    response = await sendDraftRequest(client, content);
  } catch (error) {
    // The SDK reports a reply that fails policyDraftSchema as a plain AnthropicError. API errors
    // (a subclass) and anything else, such as missing credentials, go to the caller unchanged.
    if (error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError)) {
      throw new DescribeError("Claude's reply didn't match the policy format. Try again.");
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    throw new DescribeError("Claude declined to write a policy for this description.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new DescribeError("Claude's answer was cut off. Try a shorter description.");
  }
  if (response.parsed_output == null) {
    throw new DescribeError("Claude didn't return a policy. Try rephrasing the description.");
  }
  return response.parsed_output;
}

function sendDraftRequest(client: Anthropic, content: string) {
  return client.beta.messages.parse({
    model: describeModel,
    max_tokens: 16000,
    // On a refusal, the API retries on a fallback model it picks for the refusal category.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt,
    messages: [{ role: "user", content }],
    output_config: {
      // A short, well-specified extraction; low effort keeps it fast.
      effort: "low",
      format: betaZodOutputFormat(policyDraftSchema),
    },
  });
}

/** Turns a draft into policy YAML, leaving out empty optional sections. */
export function draftToYaml(draft: PolicyDraft): string {
  const doc = new Document({
    version: 1,
    ecosystems: draft.ecosystems,
    autoMerge: draft.autoMerge,
    ...(draft.block.length > 0 && {
      block: draft.block.map(({ ecosystems, ...entry }) => ({
        ...entry,
        ...(ecosystems.length > 0 && { ecosystems }),
      })),
    }),
    ...(draft.reviewRotation.length > 0 && { review: { rotation: draft.reviewRotation } }),
  });
  doc.commentBefore = " Written by Claude from a description. Review it before committing.";

  // Short lists of plain values read better inline: updateTypes: [patch, minor]
  visit(doc, {
    Seq(_, node) {
      if (node.items.every(isScalar)) node.flow = true;
    },
  });
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/** A short, user-facing explanation for an error thrown while describing a policy. */
export function describeFailureMessage(error: unknown): string {
  if (error instanceof DescribeError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check it and try again.";
  if (error instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use the model.";
  if (error instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Wait a moment and try again.";
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API. Check your connection.";
  if (error instanceof Anthropic.APIError) return `The Anthropic API returned an error (${error.status ?? "unknown"}).`;
  return "Something went wrong while generating the policy.";
}

/** A client for use in a browser, with a key the user typed in. */
export function browserClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/** A client that reads credentials from the environment (ANTHROPIC_API_KEY or an `ant` login). */
export function environmentClient(): Anthropic {
  return new Anthropic();
}
