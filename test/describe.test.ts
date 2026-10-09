import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
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

/** A stand-in for the SDK client that returns the given replies in order. */
function fakeClient(...replies: Array<Partial<{ stop_reason: string; parsed_output: PolicyDraft | null }> | Error>) {
  const parse = vi.fn();
  for (const reply of replies) {
    if (reply instanceof Error) parse.mockRejectedValueOnce(reply);
    else parse.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: null, ...reply });
  }
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
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

  it.each(describeModels.map((model) => [model.id, model.serverSideFallback] as const))(
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

describe("describeFailureMessage", () => {
  it.each([
    [new DescribeError("Claude declined."), "Claude declined."],
    [new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers()), "The API key was rejected. Check it and try again."],
    [new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()), "Rate limited by the Anthropic API. Wait a moment and try again."],
    [new Anthropic.APIConnectionError({ message: "offline" }), "Couldn't reach the Anthropic API. Check your connection."],
    [new Anthropic.InternalServerError(500, undefined, "oops", new Headers()), "The Anthropic API returned an error (500)."],
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
    expect(isDescribeModelId("gpt-5")).toBe(false);
  });
});
