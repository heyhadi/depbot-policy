import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exitCodes, run } from "../src/cli.ts";
import { parsePolicy } from "../src/index.ts";
import { starterPolicy } from "../src/starter.ts";

let cwd: string;
let stdout: string;
let stderr: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "depbot-cli-"));
  stdout = "";
  stderr = "";
});

afterEach(() => rmSync(cwd, { recursive: true }));

function cli(...argv: string[]): number {
  return run(argv, {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
}

const read = (file: string) => readFileSync(path.join(cwd, file), "utf8");
const write = (file: string, contents: string) => writeFileSync(path.join(cwd, file), contents);

const validPolicy = "version: 1\necosystems: [{ type: npm, directory: / }]\nreview: { rotation: [alice, bob] }\n";
const generatedPaths = [".github/dependabot.yml", ".github/workflows/dependabot-auto-merge.yml"];

describe("init", () => {
  it("writes a starter policy that is valid as-is", () => {
    expect(cli("init")).toBe(exitCodes.ok);

    expect(read("depbot.policy.yml")).toBe(starterPolicy);
    expect(parsePolicy(starterPolicy).ok).toBe(true);
  });

  it("refuses to overwrite an existing policy unless forced", () => {
    write("depbot.policy.yml", "mine");

    expect(cli("init")).toBe(exitCodes.failed);
    expect(read("depbot.policy.yml")).toBe("mine");
    expect(stderr).toContain("--force");

    expect(cli("init", "--force")).toBe(exitCodes.ok);
    expect(read("depbot.policy.yml")).toBe(starterPolicy);
  });
});

describe("generate", () => {
  it("writes both files, creating directories", () => {
    write("depbot.policy.yml", validPolicy);

    expect(cli("generate")).toBe(exitCodes.ok);

    expect(read(".github/dependabot.yml")).toContain("package-ecosystem: npm");
    expect(read(".github/workflows/dependabot-auto-merge.yml")).toContain("gh pr merge --auto");
  });

  it("supports a custom policy path and output directory", () => {
    write("custom.yml", validPolicy);

    expect(cli("generate", "--policy", "custom.yml", "--out", "repo")).toBe(exitCodes.ok);

    expect(existsSync(path.join(cwd, "repo/.github/dependabot.yml"))).toBe(true);
  });

  it("prints instead of writing with --dry-run", () => {
    write("depbot.policy.yml", validPolicy);

    expect(cli("generate", "--dry-run")).toBe(exitCodes.ok);

    expect(stdout).toContain("# ==> .github/dependabot.yml <==");
    expect(existsSync(path.join(cwd, ".github"))).toBe(false);
  });

  it("reports every error with file, line and column, and writes nothing", () => {
    write("depbot.policy.yml", "version: 1\necosystems:\n  - type: yarn\n    directory: api\n");

    expect(cli("generate")).toBe(exitCodes.failed);

    expect(stderr.trim().split("\n")).toEqual([
      expect.stringMatching(/^depbot\.policy\.yml:3:5: ecosystems\[0\]\.type: /),
      expect.stringMatching(/^depbot\.policy\.yml:4:5: ecosystems\[0\]\.directory: /),
    ]);
    expect(existsSync(path.join(cwd, ".github"))).toBe(false);
  });

  it("explains how to start when there is no policy", () => {
    expect(cli("generate")).toBe(exitCodes.failed);

    expect(stderr).toContain("depbot-policy init");
  });
});

describe("check", () => {
  beforeEach(() => write("depbot.policy.yml", validPolicy));

  it("passes when the generated files are up to date", () => {
    cli("generate");

    expect(cli("check")).toBe(exitCodes.ok);
  });

  it("fails when a file is missing", () => {
    expect(cli("check")).toBe(exitCodes.failed);

    for (const file of generatedPaths) expect(stderr).toContain(`${file} is missing`);
  });

  it("fails when a file was edited or the policy changed", () => {
    cli("generate");
    write("depbot.policy.yml", validPolicy.replace("[alice, bob]", "[alice, bob, carol]"));

    expect(cli("check")).toBe(exitCodes.failed);

    expect(stderr).toContain(".github/workflows/dependabot-auto-merge.yml is out of date");
    expect(stderr).not.toContain(".github/dependabot.yml");
  });
});

describe("reviewer", () => {
  it("prints the reviewer for a given week", () => {
    write("depbot.policy.yml", validPolicy);

    cli("reviewer", "--date", "2026-10-05");
    const first = stdout.trim();
    stdout = "";
    cli("reviewer", "--date", "2026-10-12");

    expect([first, stdout.trim()].sort()).toEqual(["alice", "bob"]);
  });

  it("fails without a rotation", () => {
    write("depbot.policy.yml", "version: 1\necosystems: [{ type: npm, directory: / }]\n");

    expect(cli("reviewer")).toBe(exitCodes.failed);
    expect(stderr).toContain("no review.rotation");
  });

  it("rejects an invalid date", () => {
    write("depbot.policy.yml", validPolicy);

    expect(cli("reviewer", "--date", "next tuesday")).toBe(exitCodes.usage);
  });
});

describe("usage", () => {
  it.each([[[]], [["--help"]]])("prints help for %j", (argv) => {
    expect(cli(...argv)).toBe(exitCodes.ok);
    expect(stdout).toContain("Usage: depbot-policy <command>");
  });

  it("prints the package version", () => {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    expect(cli("--version")).toBe(exitCodes.ok);
    expect(stdout.trim()).toBe(version);
  });

  it.each([
    ["an unknown command", ["deploy"]],
    ["an unknown option", ["generate", "--verbose"]],
    ["an extra argument", ["generate", "extra"]],
  ])("exits with 2 for %s", (_, argv) => {
    expect(cli(...argv)).toBe(exitCodes.usage);
    expect(stderr).toContain("Usage:");
  });
});
