import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePolicy, type ParseResult } from "../src/index.ts";

const base = "version: 1\necosystems: [{ type: npm, directory: / }]";
const examplePath = new URL("../examples/depbot.policy.yml", import.meta.url);

// Locations are covered in locate.test.ts; these tests check paths and messages.
function errorsOf(result: ParseResult) {
  if (result.ok) throw new Error("expected parsing to fail");
  return result.errors.map(({ location: _location, ...error }) => error);
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
          mergeMethod: "squash",
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
      name: "unknown merge method",
      source: "version: 1\necosystems: [{ type: npm, directory: / }]\nautoMerge: { mergeMethod: fast-forward }",
      path: "autoMerge.mergeMethod",
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

  it("reports each unknown key at its own path so typos are caught", () => {
    const errors = errorsOf(
      parsePolicy(
        "version: 1\necosystems: [{ type: npm, directory: /, shedule: daily }]\nautomerge: {}",
      ),
    );

    expect(errors).toEqual([
      { path: "ecosystems[0].shedule", message: "Unknown key" },
      { path: "automerge", message: "Unknown key" },
    ]);
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

  it.each(["", "# only a comment\n"])("rejects an empty document: %j", (source) => {
    expect(errorsOf(parsePolicy(source))).toEqual([
      { path: "", message: "Policy file is empty" },
    ]);
  });

  it("says a missing field is required", () => {
    const errors = errorsOf(parsePolicy(`${base}\nblock: [{ name: react }]`));

    expect(errors).toEqual([{ path: "block[0].reason", message: "Required" }]);
  });
});

describe("parsePolicy: policy rules", () => {
  it.each([
    {
      name: "major updates are never auto-merged",
      source: `${base}\nautoMerge: { updateTypes: [patch, major] }`,
      error: {
        path: "autoMerge.updateTypes[1]",
        message: "Major updates are never auto-merged; they always need a human review",
      },
    },
    {
      name: "directory must be rooted",
      source: "version: 1\necosystems: [{ type: npm, directory: api }]",
      error: {
        path: "ecosystems[0].directory",
        message: 'Must start with "/" (paths are relative to the repository root)',
      },
    },
    {
      name: "duplicate ecosystem and directory",
      source:
        "version: 1\necosystems: [{ type: npm, directory: / }, { type: pip, directory: / }, { type: npm, directory: /, schedule: daily }]",
      error: { path: "ecosystems[2]", message: 'npm in "/" is already listed at index 0' },
    },
    {
      name: "duplicate update type",
      source: `${base}\nautoMerge: { updateTypes: [patch, patch] }`,
      error: { path: "autoMerge.updateTypes[1]", message: '"patch" is already listed at index 0' },
    },
    {
      name: "duplicate dependency type",
      source: `${base}\nautoMerge: { dependencyTypes: [production, production] }`,
      error: {
        path: "autoMerge.dependencyTypes[1]",
        message: '"production" is already listed at index 0',
      },
    },
    {
      name: "duplicate block entry",
      source: `${base}\nblock: [{ name: react, reason: a }, { name: react, reason: b }]`,
      error: { path: "block[1]", message: '"react" is already listed at index 0' },
    },
    {
      name: "invalid GitHub username",
      source: `${base}\nreview: { rotation: [alice, -bob] }`,
      error: { path: "review.rotation[1]", message: "Not a valid GitHub username" },
    },
    {
      name: "username with a leading @",
      source: `${base}\nreview: { rotation: ["@alice"] }`,
      error: {
        path: "review.rotation[0]",
        message: 'Write GitHub usernames without the leading "@"',
      },
    },
    {
      name: "usernames that differ only by case",
      source: `${base}\nreview: { rotation: [alice, Alice] }`,
      error: { path: "review.rotation[1]", message: '"Alice" is already listed at index 0' },
    },
  ])("$name", ({ source, error }) => {
    expect(errorsOf(parsePolicy(source))).toEqual([error]);
  });

  it("still reports duplicates when another item in the list is invalid", () => {
    const errors = errorsOf(parsePolicy(`${base}\nreview: { rotation: [alice, alice, -bob] }`));

    expect(errors.map((error) => error.path).sort()).toEqual([
      "review.rotation[1]",
      "review.rotation[2]",
    ]);
  });

  it("rejects a block entry scoped to an ecosystem the policy doesn't configure", () => {
    const errors = errorsOf(
      parsePolicy(`${base}\nblock: [{ name: react, reason: Pinned, ecosystems: [npm, pip] }]`),
    );

    expect(errors).toEqual([
      {
        path: "block[0].ecosystems[1]",
        message: 'No "pip" ecosystem is configured in this policy',
      },
    ]);
  });

  it("does not crash when block has the wrong shape", () => {
    const errors = errorsOf(parsePolicy(`${base}\nblock: x`));

    expect(errors.map((error) => error.path)).toEqual(["block"]);
  });

  it.each([
    ["yarn", 'Dependabot covers yarn under "npm"; use type: npm'],
    ["poetry", 'Dependabot covers poetry under "pip"; use type: pip'],
    ["cobol", /^Unknown ecosystem "cobol"\. Use one of: bundler, cargo, .*, terraform$/],
  ])("explains an unknown ecosystem type: %s", (type, message) => {
    const [error] = errorsOf(parsePolicy(`version: 1\necosystems: [{ type: ${type}, directory: / }]`));

    expect(error?.message).toEqual(typeof message === "string" ? message : expect.stringMatching(message));
  });

  it("still says a missing ecosystem type is required", () => {
    const errors = errorsOf(parsePolicy("version: 1\necosystems: [{ directory: / }]"));

    expect(errors).toEqual([{ path: "ecosystems[0].type", message: "Required" }]);
  });

  it("allows the same ecosystem in different directories", () => {
    const result = parsePolicy(
      "version: 1\necosystems: [{ type: npm, directory: / }, { type: npm, directory: /web }]",
    );

    expect(result.ok).toBe(true);
  });
});
