import { readFileSync } from "node:fs";
import path from "node:path";
import { parsePolicy } from "depbot-policy";
import { describe, expect, it } from "vitest";
import { presets } from "@/lib/presets";

const preset = (id: string) => presets.find((candidate) => candidate.id === id)!;

describe("presets", () => {
  it("keeps the full example in sync with examples/depbot.policy.yml", () => {
    // import.meta.url isn't a file: URL under jsdom, so build the path from the directory.
    const examplePath = path.join(import.meta.dirname, "../../examples/depbot.policy.yml");
    const example = readFileSync(examplePath, "utf8");

    expect(preset("full").source).toBe(example);
  });

  it.each(["full", "minimal", "monorepo"])("%s is a valid policy", (id) => {
    expect(parsePolicy(preset(id).source).ok).toBe(true);
  });

  it("the broken preset shows several kinds of mistake", () => {
    const result = parsePolicy(preset("broken").source);

    expect(!result.ok && result.errors.map((error) => error.path)).toEqual(
      expect.arrayContaining([
        "ecosystems[0].type",
        "ecosystems[0].shedule",
        "autoMerge.updateTypes[1]",
        "block[0].reason",
      ]),
    );
  });
});
