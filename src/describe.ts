import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError, GoogleGenAI } from "@google/genai";
import { Document, isScalar, visit } from "yaml";
import { z } from "zod";
import {
  defaultDescribeModel,
  describeModel,
  describeModels,
  providerLabel,
  type DescribeModelId,
  type DescribeProvider,
} from "./describe-models.ts";
import { parsePolicy, type PolicyError } from "./parse.ts";
import { ecosystemTypes } from "./schema.ts";

export {
  defaultDescribeModel,
  describeModel,
  describeModels,
  isDescribeModelId,
  providerFor,
  providerLabel,
  type DescribeModel,
  type DescribeModelId,
  type DescribeProvider,
} from "./describe-models.ts";

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

export interface DescribeOptions {
  /** Which model writes the policy. Defaults to `defaultDescribeModel`. */
  model?: DescribeModelId;
}

/**
 * A provider-agnostic way to ask a model for a policy draft. Each provider (Claude, Gemini) has an
 * adapter that knows how to call its SDK with structured output and how to turn its replies into
 * a `PolicyDraft`. `describePolicy` stays the same regardless of which one it's given.
 */
export interface DescribeBackend {
  draft(content: string): Promise<PolicyDraft>;
}

/** Either SDK's client. The adapters narrow this with `instanceof`. */
export type DescribeBackendClient = Anthropic | GoogleGenAI;

/**
 * Asks a model to write a policy from a plain-language description, validates it with
 * `parsePolicy`, and gives the model one chance to fix any errors.
 */
export async function describePolicy(
  description: string,
  client: DescribeBackendClient,
  { model = defaultDescribeModel }: DescribeOptions = {},
): Promise<DescribeResult> {
  const backend = backendFor(client, model);
  const provider = providerOf(model);
  const first = await backend.draft(description);
  const firstSource = draftToYaml(first, provider);
  const firstResult = parsePolicy(firstSource);
  if (firstResult.ok) return { source: firstSource, errors: [], notes: first.notes };

  const repair = await backend.draft(
    `${description}

A previous attempt produced this policy, which fails validation:

${firstSource}
Errors:
${firstResult.errors.map((error) => `- ${error.path || "(file)"}: ${error.message}`).join("\n")}

Return a corrected draft.`,
  );
  const source = draftToYaml(repair, provider);
  const result = parsePolicy(source);
  return { source, errors: result.ok ? [] : result.errors, notes: repair.notes };
}

/**
 * Picks the adapter for the client the caller passed. Claude and Gemini use different SDKs and
 * request shapes, so each gets its own adapter; everything above it is shared.
 */
function backendFor(client: DescribeBackendClient, model: DescribeModelId): DescribeBackend {
  const provider = providerOf(model);
  if (provider === "google" && client instanceof GoogleGenAI) return geminiBackend(client, model);
  if (provider === "anthropic" && client instanceof Anthropic) return anthropicBackend(client, model);
  throw new DescribeError(
    `${describeModel(model).label} needs a ${providerLabel(provider)} client, but a different one was passed.`,
  );
}

/** Claude adapter: structured outputs via the Anthropic SDK's `messages.parse`. */
function anthropicBackend(client: Anthropic, model: DescribeModelId): DescribeBackend {
  return {
    async draft(content: string): Promise<PolicyDraft> {
      let response;
      try {
        response = await sendAnthropicRequest(client, model, content);
      } catch (error) {
        // The SDK reports a reply that fails policyDraftSchema as a plain AnthropicError. API errors
        // (a subclass) and anything else, such as missing credentials, go to the caller unchanged.
        if (error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError)) {
          throw new DescribeError("The model's reply didn't match the policy format. Try again.");
        }
        throw error;
      }

      if (response.stop_reason === "refusal") {
        throw new DescribeError("The model declined to write a policy for this description.");
      }
      if (response.stop_reason === "max_tokens") {
        throw new DescribeError("The answer was cut off. Try a shorter description.");
      }
      if (response.parsed_output == null) {
        throw new DescribeError("The model didn't return a policy. Try rephrasing the description.");
      }
      return response.parsed_output;
    },
  };
}

function sendAnthropicRequest(client: Anthropic, model: DescribeModelId, content: string) {
  const { serverSideFallback } = describeModel(model);
  return client.beta.messages.parse({
    model,
    max_tokens: 16000,
    // On a refusal, the API retries on a fallback model it picks for the refusal category.
    ...(serverSideFallback && {
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    }),
    system: systemPrompt,
    messages: [{ role: "user", content }],
    output_config: {
      // A short, well-specified extraction; low effort keeps it fast.
      effort: "low",
      format: betaZodOutputFormat(policyDraftSchema),
    },
  });
}

/** Gemini adapter: JSON output via `generateContent` + `responseJsonSchema`. */
function geminiBackend(client: GoogleGenAI, model: DescribeModelId): DescribeBackend {
  return {
    async draft(content: string): Promise<PolicyDraft> {
      // API failures, including a 400 for a bad key, are explained by describeFailureMessage.
      // Only a reply we can't parse (below) means the model didn't follow the format.
      const response = await client.models.generateContent({
        model,
        contents: content,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          // The same draft schema the Claude path uses, so both providers are held to one
          // contract. Gemini returns plain JSON, which we validate with Zod below.
          responseJsonSchema: geminiResponseSchema,
        },
      });
      const text = response.text;

      if (!text) {
        throw new DescribeError("The model didn't return a policy. Try rephrasing the description.");
      }
      try {
        return policyDraftSchema.parse(JSON.parse(text));
      } catch {
        throw new DescribeError("The model's reply didn't match the policy format. Try again.");
      }
    },
  };
}

// Gemini's `responseJsonSchema` accepts only a subset of JSON Schema properties, and `$schema`
// isn't one of them.
const { $schema: _dialect, ...geminiResponseSchema } = z.toJSONSchema(policyDraftSchema);

/** Turns a draft into policy YAML, leaving out empty optional sections. */
export function draftToYaml(draft: PolicyDraft, provider: DescribeProvider = "anthropic"): string {
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
  doc.commentBefore = ` Written by ${providerLabel(provider)} from a description. Review it before committing.`;

  // Short lists of plain values read better inline: updateTypes: [patch, minor]
  visit(doc, {
    Seq(_, node) {
      if (node.items.every(isScalar)) node.flow = true;
    },
  });
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/** The provider a given model runs on. */
function providerOf(model: DescribeModelId): DescribeProvider {
  return describeModel(model).provider;
}

/** A short, user-facing explanation for an error thrown while describing a policy. */
export function describeFailureMessage(error: unknown): string {
  if (error instanceof DescribeError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check it and try again.";
  if (error instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use the model.";
  if (error instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Wait a moment and try again.";
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API. Check your connection.";
  if (error instanceof Anthropic.APIError) return `The Anthropic API returned an error (${error.status ?? "unknown"}).`;
  if (error instanceof ApiError) {
    // Google reports a bad key as HTTP 400 with the reason API_KEY_INVALID, not as 401.
    if (googleErrorReason(error) === "API_KEY_INVALID" || error.status === 401 || error.status === 403) {
      return "The API key was rejected. Check it and try again.";
    }
    if (error.status === 404) return "The Gemini API doesn't know that model, or this key can't use it.";
    if (error.status === 429) return "Rate limited by the Gemini API. Wait a moment and try again.";
    if (error.status === 400) return "The Gemini API rejected the request (400).";
    return `The Gemini API returned an error (${error.status}).`;
  }
  return "Something went wrong while generating the policy.";
}

/** The `reason` in a Gemini API error's details, such as `API_KEY_INVALID`, if there is one. */
function googleErrorReason(error: ApiError): string | undefined {
  try {
    const body = JSON.parse(error.message) as { error?: { details?: Array<{ reason?: string }> } };
    return body.error?.details?.find((detail) => detail.reason !== undefined)?.reason;
  } catch {
    // The message isn't JSON (for example a network failure), so there's no reason to read.
    return undefined;
  }
}

/** A client for use in a browser, with a key the user typed in. */
export function browserClient(provider: DescribeProvider, apiKey: string): DescribeBackendClient {
  if (provider === "google") return new GoogleGenAI({ apiKey });
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/** A backend that reads credentials from the environment for the given provider. */
export function environmentClient(provider: DescribeProvider): DescribeBackendClient {
  return providerClient(provider);
}

/** The provider's SDK client, reading its key from the environment. */
function providerClient(provider: DescribeProvider): DescribeBackendClient {
  if (provider === "anthropic") return new Anthropic();
  // Passing the key explicitly keeps the Gemini SDK from printing its own messages, or from
  // probing for Google Cloud credentials, when none is set.
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new DescribeError("No Gemini API key found. Set GEMINI_API_KEY.");
  return new GoogleGenAI({ apiKey });
}
