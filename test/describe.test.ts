import Anthropic from "@anthropic-ai/sdk";
import { ApiError, GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  DescribeError,
  defaultDescribeModel,
  describeFailureMessage,
  describeModels,
  describePolicy,
  isDescribeModelId,
  draftToYaml,
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

/**
 * A real Anthropic client whose `parse` method returns the given replies in order. It's a real
 * instance, so describePolicy's choice of adapter is exercised too.
 */
function fakeClient(...replies: Array<Partial<{ stop_reason: string; parsed_output: PolicyDraft | null }> | Error>) {
  const client = new Anthropic({ apiKey: "test-key" });
  const parse = vi.spyOn(client.beta.messages, "parse") as unknown as Mock;
  for (const reply of replies) {
    if (reply instanceof Error) parse.mockRejectedValueOnce(reply);
    else parse.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: null, ...reply });
  }
  return { client, parse };
}

/** A body like the one Google sends for a bad key, which the SDK puts in `ApiError.message`. */
const invalidKeyBody = JSON.stringify({
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }],
  },
});

describe("draftToYaml", () => {
  it("produces a valid policy and leaves out empty sections", () => {
    const source = draftToYaml(draft);

    expect(parsePolicy(source).ok).toBe(true);
    expect(source).not.toContain("block:");
    expect(source).not.toContain("review:");
    expect(source.startsWith("# Written by Claude")).toBe(true);
  });

  it("credits the provider it was told about", () => {
    expect(draftToYaml(draft, "google").startsWith("# Written by Gemini")).toBe(true);
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
  /** A real Google client whose `generateContent` returns the given texts (or throws the Errors). */
  function fakeGoogleClient(...replies: Array<string | Error>) {
    const client = new GoogleGenAI({ apiKey: "test-key" });
    const generateContent = vi.spyOn(client.models, "generateContent") as unknown as Mock;
    for (const reply of replies) {
      if (reply instanceof Error) generateContent.mockRejectedValueOnce(reply);
      else generateContent.mockResolvedValueOnce({ text: reply });
    }
    return { client, generateContent };
  }

  it("returns a valid policy and Gemini's notes", async () => {
    const draftWithNotes = { ...draft, notes: ["Assumed a weekly schedule."] };
    const { client } = fakeGoogleClient(JSON.stringify(draftWithNotes));

    const result = await describePolicy("npm project, auto-merge patches", client, {
      model: "gemini-3-flash-preview",
    });

    expect(result.errors).toEqual([]);
    expect(result.notes).toEqual(["Assumed a weekly schedule."]);
    expect(parsePolicy(result.source).ok).toBe(true);
    expect(result.source.startsWith("# Written by Gemini")).toBe(true);
  });

  it("asks for JSON with the model, schema, and system instruction", async () => {
    const { client, generateContent } = fakeGoogleClient(JSON.stringify(draft));

    await describePolicy("npm project", client, { model: "gemini-3-flash-preview" });

    const request = generateContent.mock.calls[0]![0] as {
      model: string;
      contents: string;
      config: { responseMimeType: string; systemInstruction: string; responseJsonSchema: unknown };
    };
    expect(request.model).toBe("gemini-3-flash-preview");
    expect(request.contents).toBe("npm project");
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.systemInstruction).toContain("depbot-policy");
    expect(request.config.responseJsonSchema).toMatchObject({
      properties: expect.objectContaining({ ecosystems: expect.anything(), notes: expect.anything() }),
    });
  });

  it("leaves $schema out of the schema, which Gemini's responseJsonSchema doesn't list", async () => {
    const { client, generateContent } = fakeGoogleClient(JSON.stringify(draft));

    await describePolicy("npm project", client, { model: "gemini-3-flash-preview" });

    expect(generateContent.mock.calls[0]![0].config.responseJsonSchema).not.toHaveProperty("$schema");
  });

  it("repairs an invalid draft once, then reports what's left", async () => {
    const broken = { ...draft, ecosystems: [{ type: "npm", directory: "web", schedule: "weekly" }] };
    const fixed = { ...draft, ecosystems: [{ type: "npm", directory: "/web", schedule: "weekly" }] };
    const { client, generateContent } = fakeGoogleClient(JSON.stringify(broken), JSON.stringify(fixed));

    const result = await describePolicy("web app in web/", client, { model: "gemini-3-flash-preview" });

    expect(generateContent).toHaveBeenCalledTimes(2);
    const repair = generateContent.mock.calls[1]![0].contents as string;
    expect(repair).toContain("web app in web/");
    expect(repair).toContain('ecosystems[0].directory: Must start with "/"');
    expect(result.errors).toEqual([]);
    expect(result.source).toContain("directory: /web");
  });

  it.each([
    ["", /didn't return a policy/],
    ["not json", /didn't match the policy format/],
  ])("explains a reply it can't use: %o", async (reply, message) => {
    const { client } = fakeGoogleClient(reply);

    await expect(
      describePolicy("npm", client, { model: "gemini-3-flash-preview" }),
    ).rejects.toThrow(DescribeError);
    const { client: again } = fakeGoogleClient(reply);
    await expect(
      describePolicy("npm", again, { model: "gemini-3-flash-preview" }),
    ).rejects.toThrow(message);
  });

  it("passes API errors through, even a 400 for a bad key, to be explained", async () => {
    const error = new ApiError({ message: invalidKeyBody, status: 400 });
    const { client } = fakeGoogleClient(error);

    await expect(describePolicy("npm", client, { model: "gemini-3-flash-preview" })).rejects.toBe(error);
    expect(describeFailureMessage(error)).toBe("The API key was rejected. Check it and try again.");
  });

  it("uses every Gemini model", async () => {
    for (const model of describeModels.filter((entry) => entry.provider === "google")) {
      const { client, generateContent } = fakeGoogleClient(JSON.stringify(draft));
      await describePolicy("npm", client, { model: model.id });
      expect(generateContent.mock.calls[0]![0].model).toBe(model.id);
    }
  });
});

describe("describeFailureMessage", () => {
  it.each([
    [new DescribeError("Claude declined."), "Claude declined."],
    [new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers()), "The API key was rejected. Check it and try again."],
    [new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()), "Rate limited by the Anthropic API. Wait a moment and try again."],
    [new Anthropic.APIConnectionError({ message: "offline" }), "Couldn't reach the Anthropic API. Check your connection."],
    [new Anthropic.InternalServerError(500, undefined, "oops", new Headers()), "The Anthropic API returned an error (500)."],
    [new ApiError({ message: invalidKeyBody, status: 400 }), "The API key was rejected. Check it and try again."],
    [new ApiError({ message: "bad key", status: 401 }), "The API key was rejected. Check it and try again."],
    [new ApiError({ message: "forbidden", status: 403 }), "The API key was rejected. Check it and try again."],
    [new ApiError({ message: "no such model", status: 404 }), "The Gemini API doesn't know that model, or this key can't use it."],
    [new ApiError({ message: "slow down", status: 429 }), "Rate limited by the Gemini API. Wait a moment and try again."],
    [new ApiError({ message: '{"error":{"code":400,"message":"bad schema","status":"INVALID_ARGUMENT"}}', status: 400 }), "The Gemini API rejected the request (400)."],
    [new ApiError({ message: "not json at all", status: 400 }), "The Gemini API rejected the request (400)."],
    [new ApiError({ message: "boom", status: 500 }), "The Gemini API returned an error (500)."],
    [new Error("boom"), "Something went wrong while generating the policy."],
  ])("explains %s", (error, message) => {
    expect(describeFailureMessage(error)).toBe(message);
  });
});

describe("choosing the adapter", () => {
  it("rejects a Claude client paired with a Gemini model", async () => {
    const { client } = fakeClient();

    await expect(describePolicy("npm", client, { model: "gemini-3-flash-preview" })).rejects.toThrow(
      /needs a Gemini client/,
    );
  });

  it("rejects a Gemini client paired with a Claude model", async () => {
    const client = new GoogleGenAI({ apiKey: "test-key" });

    await expect(describePolicy("npm", client, { model: "claude-haiku-5-5" })).rejects.toThrow(
      /needs a Claude client/,
    );
  });
});

describe("describeModels", () => {
  it("uses the exact ids Google lists, including the dot in 3.1", () => {
    const googleIds = describeModels.filter((model) => model.provider === "google").map((model) => model.id);

    expect(googleIds).toEqual(["gemini-3-flash-preview", "gemini-3.1-pro-preview"]);
  });

  it("defaults to Claude Opus 5.5", () => {
    expect(defaultDescribeModel).toBe("claude-opus-5-5");
  });

  it("recognises supported model ids only", () => {
    expect(isDescribeModelId("claude-haiku-5-5")).toBe(true);
    expect(isDescribeModelId("gemini-3-flash-preview")).toBe(true);
    expect(isDescribeModelId("gpt-5")).toBe(false);
  });
});
