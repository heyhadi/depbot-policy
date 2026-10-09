import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePolicy, type ParseResult } from "../src/index.js";

const examplePath = new URL("../examples/depbot.policy.yml", import.meta.url);

function errorsOf(result: ParseResult) {
  if (result.ok) throw new Error("expected parsing to fail");
  return result.errors;
}

describe("parsePolicy: valid policies", () => {
  it("accepts the example policy", () => {
    const result = parsePolicy(readFileSync(examplePath, "utf8"));

    expect(result.ok).toBe(true);
  });

  it("applies defaults to a minimal policy", () => {
    const result = parsePolicy(`
version: 1
ecosystems:
  - type: npm
    directory: /
`);

    expect(result).toEqual({
      ok: true,
      policy: {
        version: 1,
        ecosystems: [{ type: "npm", directory: "/", schedule: "weekly" }],
        autoMerge: {
          updateTypes: ["patch"],
          dependencyTypes: ["development", "production"],
        },
        block: [],
      },
    });
  });

  it("keeps explicit values over defaults", () => {
    const result = parsePolicy(`
version: 1
ecosystems:
  - type: pip
    directory: /api
    schedule: daily
autoMerge:
  updateTypes: [patch, minor]
  dependencyTypes: [development]
`);

    expect(result.ok && result.policy).toMatchObject({
      ecosystems: [{ type: "pip", directory: "/api", schedule: "daily" }],
      autoMerge: { updateTypes: ["patch", "minor"], dependencyTypes: ["development"] },
    });
  });
});

describe("parsePolicy: invalid policies", () => {
  it.each([
    {
      name: "unsupported version",
      source: "version: 2\necosystems: [{ type: npm, directory: / }]",
      path: "version",
    },
    {
      name: "missing ecosystems",
      source: "version: 1",
      path: "ecosystems",
    },
    {
      name: "empty ecosystems",
      source: "version: 1\necosystems: []",
      path: "ecosystems",
    },
    {
      name: "unknown ecosystem type",
      source: "version: 1\necosystems: [{ type: yarn, directory: / }]",
      path: "ecosystems[0].type",
    },
    {
      name: "major in updateTypes",
      source: "version: 1\necosystems: [{ type: npm, directory: / }]\nautoMerge: { updateTypes: [major] }",
      path: "autoMerge.updateTypes[0]",
    },
    {
      name: "block entry without a reason",
      source: "version: 1\necosystems: [{ type: npm, directory: / }]\nblock: [{ name: react }]",
      path: "block[0].reason",
    },
    {
      name: "empty review rotation",
      source: "version: 1\necosystems: [{ type: npm, directory: / }]\nreview: { rotation: [] }",
      path: "review.rotation",
    },
  ])("rejects $name at $path", ({ source, path }) => {
    const errors = errorsOf(parsePolicy(source));

    expect(errors.map((error) => error.path)).toContain(path);
  });

  it("rejects unknown keys so typos are caught", () => {
    const errors = errorsOf(
      parsePolicy("version: 1\necosystems: [{ type: npm, directory: / }]\nautomerge: {}"),
    );

    expect(errors).toEqual([{ path: "", message: expect.stringContaining("automerge") }]);
  });

  it("reports every error, not just the first", () => {
    const errors = errorsOf(
      parsePolicy("version: 2\necosystems: [{ type: yarn, directory: / }]\nblock: [{ name: react }]"),
    );

    expect(errors.map((error) => error.path)).toEqual([
      "version",
      "ecosystems[0].type",
      "block[0].reason",
    ]);
  });

  it("reports YAML syntax errors", () => {
    const errors = errorsOf(parsePolicy("version: 1\necosystems: [\n"));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("");
  });

  it("rejects duplicate YAML keys", () => {
    const errors = errorsOf(parsePolicy("version: 1\nversion: 1\necosystems: []"));

    expect(errors[0]?.message).toMatch(/unique/i);
  });

  it("rejects an empty document", () => {
    expect(parsePolicy("").ok).toBe(false);
  });
});
