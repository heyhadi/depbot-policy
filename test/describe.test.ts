import Anthropic from "@anthropic-ai/sdk";
import { ApiError, FinishReason } from "@google/genai";
import type { GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import {
  DescribeError,
  defaultDescribeModel,
  describeFailureMessage,
  describeModels,
  describePolicy,
  isDescribeModelId,
  draftToYaml,
  type DescribeModelId,
  type PolicyDraft,
} from "../src/describe.ts";
import { parsePolicy } from "../src/index.ts";

const draft: PolicyDraft = {
  ecosystems: [{ type: "npm", directory: "/", schedule: "weekly" }],
  autoMerge: { updateTypes: ["patch"], dependencyTypes: ["development", "production"], mergeMethod: "squash" },
  block: [],
  reviewRotation: [],
  notes: [],
};

/** A stand-in for the SDK client that returns the given replies in order. */
function fakeClient(...replies: Array<Partial<{ stop_reason: string; parsed_output: PolicyDraft | null }> | Error>) {
  const parse = vi.fn();
  for (const reply of replies) {
    if (reply instanceof Error) parse.mockRejectedValueOnce(reply);
    else parse.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: null, ...reply });
  }
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

/**
 * A stand-in for the Google client. `text` is the raw JSON string the model returns; `candidates`
 * mirrors the real shape, and `getter` builds a real accessor so `response.text` behaves like the SDK.
 */
function fakeGoogleClient(
  ...replies: Array<{ text?: string; candidate?: Partial<{ finishReason: FinishReason }> } | Error>
) {
  const generateContent = vi.fn();
  for (const reply of replies) {
    if (reply instanceof Error) {
      generateContent.mockRejectedValueOnce(reply);
      continue;
    }
    const finishReason = reply.candidate?.finishReason ?? FinishReason.STOP;
    generateContent.mockResolvedValueOnce({
      candidates: [{ finishReason }],
      get text() {
        return reply.text;
      },
    });
  }
  return { client: { models: { generateContent } } as unknown as GoogleGenAI, generateContent };
}

describe("draftToYaml", () => {
  it("produces a valid policy and leaves out empty sections", () => {
    const source = draftToYaml(draft);

    expect(parsePolicy(source).ok).toBe(true);
    expect(source).not.toContain("block:");
    expect(source).not.toContain("review:");
    expect(source.startsWith("# Written by Claude")).toBe(true);
  });

  it("keeps blocks and the rotation, and drops empty block ecosystems", () => {
    const source = draftToYaml({
      ...draft,
      block: [
        { name: "react", reason: "Pinned until React 19", ecosystems: ["npm"] },
        { name: "left-pad", reason: "Unmaintained", ecosystems: [] },
      ],
      reviewRotation: ["alice", "bob"],
    });

    const result = parsePolicy(source);
    expect(result.ok && result.policy.block).toEqual([
      { name: "react", reason: "Pinned until React 19", ecosystems: ["npm"] },
      { name: "left-pad", reason: "Unmaintained" },
    ]);
    expect(result.ok && result.policy.review?.rotation).toEqual(["alice", "bob"]);
    expect(source).toContain("rotation: [alice, bob]");
  });
});

describe("describePolicy", () => {
  it("returns a valid policy and Claude's notes", async () => {
    const { client } = fakeClient({ parsed_output: { ...draft, notes: ["Assumed a weekly schedule."] } });

    const result = await describePolicy("npm project, auto-merge patches", client);

    expect(result.errors).toEqual([]);
    expect(result.notes).toEqual(["Assumed a weekly schedule."]);
    expect(parsePolicy(result.source).ok).toBe(true);
  });

  it("asks for structured output from the default model, with refusal fallbacks", async () => {
    const { client, parse } = fakeClient({ parsed_output: draft });

    await describePolicy("npm project", client);

    const request = parse.mock.calls[0]![0];
    expect(request).toMatchObject({
      model: "claude-opus-5-5",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: "npm project" }],
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
  });

  it.each(
    describeModels
      .filter((model) => model.provider === "anthropic")
      .map((model) => [model.id, model.serverSideFallback] as const),
  )(
    "uses %s, with server-side fallback: %s",
    async (model, serverSideFallback) => {
      const { client, parse } = fakeClient({ parsed_output: draft });

      await describePolicy("npm project", client, { model });

      const request = parse.mock.calls[0]![0];
      expect(request.model).toBe(model);
      if (serverSideFallback) {
        expect(request).toMatchObject({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
      } else {
        expect(request).not.toHaveProperty("fallbacks");
        expect(request).not.toHaveProperty("betas");
      }
    },
  );

  it("never sends fallbacks for Claude Haiku 5.5, which has no server-side fallback", () => {
    expect(describeModels.find((model) => model.id === "claude-haiku-5-5")?.serverSideFallback).toBe(false);
  });

  it("uses the chosen model for the repair attempt too", async () => {
    const broken = { ...draft, ecosystems: [{ type: "npm" as const, directory: "web", schedule: "weekly" as const }] };
    const { client, parse } = fakeClient({ parsed_output: broken }, { parsed_output: draft });

    await describePolicy("web app", client, { model: "claude-sonnet-5-5" });

    expect(parse.mock.calls.map((call) => call[0].model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5"]);
  });

  it("sends validation errors back once and returns the repaired policy", async () => {
    const broken = { ...draft, ecosystems: [{ type: "npm" as const, directory: "web", schedule: "weekly" as const }] };
    const fixed = { ...draft, ecosystems: [{ type: "npm" as const, directory: "/web", schedule: "weekly" as const }] };
    const { client, parse } = fakeClient({ parsed_output: broken }, { parsed_output: fixed });

    const result = await describePolicy("web app in web/", client);

    expect(parse).toHaveBeenCalledTimes(2);
    const repairPrompt = parse.mock.calls[1]![0].messages[0].content as string;
    expect(repairPrompt).toContain("web app in web/");
    expect(repairPrompt).toContain("directory: web");
    expect(repairPrompt).toContain('ecosystems[0].directory: Must start with "/"');
    expect(result.errors).toEqual([]);
    expect(result.source).toContain("directory: /web");
  });

  it("returns the remaining errors if the repair still fails", async () => {
    const broken = { ...draft, ecosystems: [{ type: "npm" as const, directory: "web", schedule: "weekly" as const }] };
    const { client, parse } = fakeClient({ parsed_output: broken }, { parsed_output: broken });

    const result = await describePolicy("web app", client);

    expect(parse).toHaveBeenCalledTimes(2);
    expect(result.errors.map((error) => error.path)).toEqual(["ecosystems[0].directory"]);
  });

  it.each([
    [{ stop_reason: "refusal" }, /declined/],
    [{ stop_reason: "max_tokens" }, /cut off/],
    [{ parsed_output: null }, /didn't return a policy/],
    [new Anthropic.AnthropicError("Failed to parse structured output"), /didn't match the policy format/],
  ])("explains a reply it can't use: %o", async (reply, message) => {
    const { client } = fakeClient(reply as never);

    await expect(describePolicy("npm", client)).rejects.toThrow(DescribeError);
    const { client: again } = fakeClient(reply as never);
    await expect(describePolicy("npm", again)).rejects.toThrow(message);
  });

  it("lets other errors, such as missing credentials, through unchanged", async () => {
    const error = new Error("Could not resolve authentication method");
    const { client } = fakeClient(error);

    await expect(describePolicy("npm", client)).rejects.toBe(error);
  });

  it("lets API errors through for the caller to explain", async () => {
    const error = new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers());
    const { client } = fakeClient(error);

    await expect(describePolicy("npm", client)).rejects.toBe(error);
  });
});

describe("describePolicy with Gemini", () => {
  const geminiModel: DescribeModelId = "gemini-3-flash-preview";

  /** A stand-in for the Google client that returns the given replies in order. */
  function fakeGemini(
    ...replies: Array<{ text?: string | undefined; finishReason?: FinishReason } | Error>
  ) {
    const generateContent = vi.fn();
    for (const reply of replies) {
      if (reply instanceof Error) generateContent.mockRejectedValueOnce(reply);
      else {
        const { text, finishReason = FinishReason.STOP } = reply;
        generateContent.mockResolvedValueOnce({
          text,
          candidates: [{ finishReason }],
        });
      }
    }
    return { client: { models: { generateContent } } as unknown as GoogleGenAI, generateContent };
  }

  it("returns a valid policy and Gemini's notes, stamping Gemini in the header", async () => {
    const { client } = fakeGemini({
      text: JSON.stringify({ ...draft, notes: ["Assumed a weekly schedule."] }),
    });

    const result = await describePolicy("npm project", client, { model: geminiModel });

    expect(result.errors).toEqual([]);
    expect(result.notes).toEqual(["Assumed a weekly schedule."]);
    expect(result.source.startsWith("# Written by Gemini from a description")).toBe(true);
    expect(parsePolicy(result.source).ok).toBe(true);
  });

  it("asks for JSON from the Gemini model, with the schema and no temperature", async () => {
    const { client, generateContent } = fakeGemini({ text: JSON.stringify(draft) });

    await describePolicy("npm project", client, { model: geminiModel });

    const request = generateContent.mock.calls[0]![0];
    expect(request.model).toBe(geminiModel);
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toMatchObject({
      type: "object",
      properties: { ecosystems: expect.anything(), notes: expect.anything() },
      required: expect.arrayContaining(["ecosystems"]),
    });
    expect(request.config.responseSchema).toBeUndefined();
    expect(request.config.temperature).toBeUndefined();
  });

  it("does not retry when the first draft is already valid", async () => {
    const { client, generateContent } = fakeGemini({ text: JSON.stringify(draft) });

    await describePolicy("npm project", client, { model: geminiModel });

    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("explains a safety refusal", async () => {
    const { client } = fakeGemini({ finishReason: FinishReason.SAFETY });

    await expect(describePolicy("npm", client, { model: geminiModel })).rejects.toThrow(
      /declined to write a policy/,
    );
  });

  it("explains a response with no text", async () => {
    const { client } = fakeGemini({ text: undefined });

    await expect(describePolicy("npm", client, { model: geminiModel })).rejects.toThrow(
      /didn't return a policy/,
    );
  });

  it("explains text that isn't valid JSON", async () => {
    const { client } = fakeGemini({ text: "not json" });

    await expect(describePolicy("npm", client, { model: geminiModel })).rejects.toThrow(
      /didn't match the policy format/,
    );
  });

  it("repairs an invalid draft, quoting the failing policy", async () => {
    const broken = { ...draft, ecosystems: [{ type: "npm", directory: "web", schedule: "weekly" }] };
    const fixed = { ...draft, ecosystems: [{ type: "npm", directory: "/web", schedule: "weekly" }] };
    const { client, generateContent } = fakeGemini(
      { text: JSON.stringify(broken) },
      { text: JSON.stringify(fixed) },
    );

    const result = await describePolicy("web app in web/", client, { model: geminiModel });

    expect(generateContent).toHaveBeenCalledTimes(2);
    const repairRequest = generateContent.mock.calls[1]![0];
    expect(repairRequest.config.responseMimeType).toBe("application/json");
    expect(repairRequest.contents).toContain("web app in web/");
    expect(repairRequest.contents).toContain('directory: web');
    expect(result.errors).toEqual([]);
    expect(result.source).toContain("directory: /web");
  });

  it("returns the remaining errors if the repair still fails", async () => {
    const broken = { ...draft, ecosystems: [{ type: "npm", directory: "web", schedule: "weekly" }] };
    const { client } = fakeGemini({ text: JSON.stringify(broken) }, { text: JSON.stringify(broken) });

    const result = await describePolicy("web app", client, { model: geminiModel });

    expect(result.errors.map((error) => error.path)).toEqual(["ecosystems[0].directory"]);
  });

  it("lets other errors, such as missing credentials, through unchanged", async () => {
    const error = new Error("API key not valid");
    const { client } = fakeGemini(error);

    await expect(describePolicy("npm", client, { model: geminiModel })).rejects.toBe(error);
  });

  it("lets API errors through for the caller to explain", async () => {
    const error = new ApiError({ message: "API key not valid", status: 400 });
    const { client } = fakeGemini(error);

    await expect(describePolicy("npm", client, { model: geminiModel })).rejects.toBe(error);
  });
});

describe("describeFailureMessage", () => {
  it.each([
    [new DescribeError("Claude declined."), "Claude declined."],
    [new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers()), "The API key was rejected. Check it and try again."],
    [new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()), "Rate limited by the Anthropic API. Wait a moment and try again."],
    [new Anthropic.APIConnectionError({ message: "offline" }), "Couldn't reach the Anthropic API. Check your connection."],
    [new Anthropic.InternalServerError(500, undefined, "oops", new Headers()), "The Anthropic API returned an error (500)."],
    [new ApiError({ message: "API key not valid. Please pass a valid API key.", status: 400 }), "The API key was rejected. Check it and try again."],
    [new ApiError({ message: "You exceeded your current quota.", status: 429 }), "Rate limited by the Gemini API. Wait a moment and try again."],
    [new ApiError({ message: "boom", status: 500 }), "The Gemini API returned an error (500)."],
    [new Error("boom"), "Something went wrong while generating the policy."],
  ])("explains %s", (error, message) => {
    expect(describeFailureMessage(error)).toBe(message);
  });
});

describe("describeModels", () => {
  it("defaults to Claude Opus 5.5", () => {
    expect(defaultDescribeModel).toBe("claude-opus-5-5");
  });

  it("recognises supported model ids only", () => {
    expect(isDescribeModelId("claude-haiku-5-5")).toBe(true);
    expect(isDescribeModelId("gemini-3-flash-preview")).toBe(true);
    expect(isDescribeModelId("gpt-5")).toBe(false);
  });
});
