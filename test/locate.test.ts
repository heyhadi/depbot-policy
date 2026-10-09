import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/index.ts";

/** Returns the source text each error points at, keyed by path. */
function pointedAt(source: string) {
  const result = parsePolicy(source);
  if (result.ok) throw new Error("expected parsing to fail");
  return Object.fromEntries(
    result.errors.map((error) => [
      error.path,
      error.location && source.slice(error.location.start, error.location.end),
    ]),
  );
}

describe("error locations", () => {
  it("points at the key and value of a wrong field", () => {
    expect(pointedAt("version: 2\necosystems: [{ type: npm, directory: / }]")).toEqual({
      version: "version: 2",
    });
  });

  it("points into nested maps and lists", () => {
    const source = `version: 1
ecosystems:
  - type: npm
    directory: /
  - type: yarn
    directory: api
`;

    expect(pointedAt(source)).toEqual({
      "ecosystems[1].type": "type: yarn",
      "ecosystems[1].directory": "directory: api",
    });
  });

  it("points at an item in a list", () => {
    const source = "version: 1\necosystems: [{ type: npm, directory: / }]\nreview: { rotation: [alice, -bob] }";

    expect(pointedAt(source)).toEqual({ "review.rotation[1]": "-bob" });
  });

  it("points at the whole duplicate list item", () => {
    const source = `version: 1
ecosystems:
  - { type: npm, directory: / }
  - { type: npm, directory: / }
`;

    expect(pointedAt(source)).toEqual({ "ecosystems[1]": "{ type: npm, directory: / }" });
  });

  it("points at an unknown key", () => {
    const source = "version: 1\necosystems: [{ type: npm, directory: / }]\nautomerge: {}";

    expect(pointedAt(source)).toEqual({ automerge: "automerge: {}" });
  });

  it("points at the first line of the parent when a required field is missing", () => {
    const source = `version: 1
ecosystems: [{ type: npm, directory: / }]
block:
  - name: react
    ecosystems: [npm]
`;

    expect(pointedAt(source)).toEqual({ "block[0].reason": "name: react" });
  });

  it("points at YAML syntax errors", () => {
    const result = parsePolicy("version: 1\necosystems: [\n");

    expect(!result.ok && result.errors[0]?.location).toMatchObject({ line: 3, column: 1 });
  });

  it("reports 1-based line and column", () => {
    const result = parsePolicy("version: 1\necosystems:\n  - type: yarn\n    directory: /\n");

    expect(!result.ok && result.errors[0]?.location).toMatchObject({ line: 3, column: 5 });
  });

  it("has no location for an empty file", () => {
    const result = parsePolicy("");

    expect(!result.ok && result.errors[0]).not.toHaveProperty("location");
  });
});
