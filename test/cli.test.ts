import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exitCodes, run, type CliIo } from "../src/cli.ts";
import { DescribeError } from "../src/describe.ts";
import { parsePolicy } from "../src/index.ts";
import { starterPolicy } from "../src/starter.ts";

let cwd: string;
let stdout: string;
let stderr: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "depbot-cli-"));
  stdout = "";
  stderr = "";
  fakeDescribe = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true });
});

let fakeDescribe: CliIo["describe"];

function cli(...argv: string[]): Promise<number> {
  return run(argv, {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    ...(fakeDescribe && { describe: fakeDescribe }),
  });
}

const read = (file: string) => readFileSync(path.join(cwd, file), "utf8");
const write = (file: string, contents: string) => writeFileSync(path.join(cwd, file), contents);

const validPolicy = "version: 1\necosystems: [{ type: npm, directory: / }]\nreview: { rotation: [alice, bob] }\n";
const generatedPaths = [".github/dependabot.yml", ".github/workflows/dependabot-auto-merge.yml"];

describe("init", () => {
  it("writes a starter policy that is valid as-is", async () => {
    expect(await cli("init")).toBe(exitCodes.ok);

    expect(read("depbot.policy.yml")).toBe(starterPolicy);
    expect(parsePolicy(starterPolicy).ok).toBe(true);
  });

  it("refuses to overwrite an existing policy unless forced", async () => {
    write("depbot.policy.yml", "mine");

    expect(await cli("init")).toBe(exitCodes.failed);
    expect(read("depbot.policy.yml")).toBe("mine");
    expect(stderr).toContain("--force");

    expect(await cli("init", "--force")).toBe(exitCodes.ok);
    expect(read("depbot.policy.yml")).toBe(starterPolicy);
  });
});

describe("generate", () => {
  it("writes both files, creating directories", async () => {
    write("depbot.policy.yml", validPolicy);

    expect(await cli("generate")).toBe(exitCodes.ok);

    expect(read(".github/dependabot.yml")).toContain("package-ecosystem: npm");
    expect(read(".github/workflows/dependabot-auto-merge.yml")).toContain("gh pr merge --auto");
  });

  it("supports a custom policy path and output directory", async () => {
    write("custom.yml", validPolicy);

    expect(await cli("generate", "--policy", "custom.yml", "--out", "repo")).toBe(exitCodes.ok);

    expect(existsSync(path.join(cwd, "repo/.github/dependabot.yml"))).toBe(true);
  });

  it("prints instead of writing with --dry-run", async () => {
    write("depbot.policy.yml", validPolicy);

    expect(await cli("generate", "--dry-run")).toBe(exitCodes.ok);

    expect(stdout).toContain("# ==> .github/dependabot.yml <==");
    expect(existsSync(path.join(cwd, ".github"))).toBe(false);
  });

  it("reports every error with file, line and column, and writes nothing", async () => {
    write("depbot.policy.yml", "version: 1\necosystems:\n  - type: yarn\n    directory: api\n");

    expect(await cli("generate")).toBe(exitCodes.failed);

    expect(stderr.trim().split("\n")).toEqual([
      expect.stringMatching(/^depbot\.policy\.yml:3:5: ecosystems\[0\]\.type: /),
      expect.stringMatching(/^depbot\.policy\.yml:4:5: ecosystems\[0\]\.directory: /),
    ]);
    expect(existsSync(path.join(cwd, ".github"))).toBe(false);
  });

  it("explains how to start when there is no policy", async () => {
    expect(await cli("generate")).toBe(exitCodes.failed);

    expect(stderr).toContain("depbot-policy init");
  });
});

describe("check", () => {
  beforeEach(() => write("depbot.policy.yml", validPolicy));

  it("passes when the generated files are up to date", async () => {
    await cli("generate");

    expect(await cli("check")).toBe(exitCodes.ok);
  });

  it("fails when a file is missing", async () => {
    expect(await cli("check")).toBe(exitCodes.failed);

    for (const file of generatedPaths) expect(stderr).toContain(`${file} is missing`);
  });

  it("fails when a file was edited or the policy changed", async () => {
    await cli("generate");
    write("depbot.policy.yml", validPolicy.replace("[alice, bob]", "[alice, bob, carol]"));

    expect(await cli("check")).toBe(exitCodes.failed);

    expect(stderr).toContain(".github/workflows/dependabot-auto-merge.yml is out of date");
    expect(stderr).not.toContain(".github/dependabot.yml");
  });
});

describe("reviewer", () => {
  it("prints the reviewer for a given week", async () => {
    write("depbot.policy.yml", validPolicy);

    await cli("reviewer", "--date", "2026-10-05");
    const first = stdout.trim();
    stdout = "";
    await cli("reviewer", "--date", "2026-10-12");

    expect([first, stdout.trim()].sort()).toEqual(["alice", "bob"]);
  });

  it("fails without a rotation", async () => {
    write("depbot.policy.yml", "version: 1\necosystems: [{ type: npm, directory: / }]\n");

    expect(await cli("reviewer")).toBe(exitCodes.failed);
    expect(stderr).toContain("no review.rotation");
  });

  it("rejects an invalid date", async () => {
    write("depbot.policy.yml", validPolicy);

    expect(await cli("reviewer", "--date", "next tuesday")).toBe(exitCodes.usage);
  });
});

describe("usage", () => {
  it.each([[[]], [["--help"]]])("prints help for %j", async (argv) => {
    expect(await cli(...argv)).toBe(exitCodes.ok);
    expect(stdout).toContain("Usage: depbot-policy <command>");
  });

  it("prints the package version", async () => {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    expect(await cli("--version")).toBe(exitCodes.ok);
    expect(stdout.trim()).toBe(version);
  });

  it.each([
    ["an unknown command", ["deploy"]],
    ["an unknown option", ["generate", "--verbose"]],
    ["an extra argument", ["generate", "extra"]],
  ])("exits with 2 for %s", async (_, argv) => {
    expect(await cli(...argv)).toBe(exitCodes.usage);
    expect(stderr).toContain("Usage:");
  });
});

describe("init --describe", () => {
  const described = "# Written by Claude from a description. Review it before committing.\n\nversion: 1\necosystems:\n  - type: npm\n    directory: /\n    schedule: weekly\n";

  it("writes the policy Claude wrote and prints its notes", async () => {
    fakeDescribe = async () => ({ source: described, errors: [], notes: ["Assumed a weekly schedule."] });

    expect(await cli("init", "--describe", "npm project")).toBe(exitCodes.ok);

    expect(read("depbot.policy.yml")).toBe(described);
    expect(stdout).toContain("Note: Assumed a weekly schedule.");
    expect(stdout).toContain("Review it, then run: depbot-policy generate");
  });

  it("passes the description through, with Claude Opus 5.5 by default", async () => {
    let received: unknown[] = [];
    fakeDescribe = async (...args) => {
      received = args;
      return { source: described, errors: [], notes: [] };
    };

    await cli("init", "--describe", "pnpm monorepo, pin react");

    expect(received).toEqual(["pnpm monorepo, pin react", "claude-opus-5-5"]);
    expect(stdout).toContain("Asking Claude Opus 5.5 to write the policy");
  });

  it("uses the model chosen with --model", async () => {
    let model = "";
    fakeDescribe = async (_, chosen) => {
      model = chosen;
      return { source: described, errors: [], notes: [] };
    };

    expect(await cli("init", "--describe", "npm", "--model", "claude-haiku-5-5")).toBe(exitCodes.ok);

    expect(model).toBe("claude-haiku-5-5");
    expect(stdout).toContain("Asking Claude Haiku 5.5");
  });

  it("rejects an unknown model and lists the supported ones", async () => {
    expect(await cli("init", "--describe", "npm", "--model", "gpt-5")).toBe(exitCodes.usage);

    expect(stderr).toContain("Unknown model: gpt-5");
    expect(stderr).toContain("claude-sonnet-5-5");
    expect(stderr).toContain("gemini-3-flash-preview");
    expect(existsSync(path.join(cwd, "depbot.policy.yml"))).toBe(false);
  });

  it("rejects --model without --describe", async () => {
    expect(await cli("generate", "--model", "claude-haiku-5-5")).toBe(exitCodes.usage);

    expect(stderr).toContain("--model only applies to init --describe");
  });

  it("still writes the file but fails when problems remain", async () => {
    fakeDescribe = async () => ({
      source: described,
      errors: [{ path: "ecosystems[0].directory", message: "Must start with \"/\"", location: { start: 0, end: 1, line: 5, column: 5 } }],
      notes: [],
    });

    expect(await cli("init", "--describe", "web app")).toBe(exitCodes.failed);

    expect(existsSync(path.join(cwd, "depbot.policy.yml"))).toBe(true);
    expect(stderr).toContain("depbot.policy.yml:5:5: ecosystems[0].directory");
  });

  it("explains a failure and writes nothing", async () => {
    fakeDescribe = async () => {
      throw new DescribeError("Claude declined to write a policy for this description.");
    };

    expect(await cli("init", "--describe", "npm")).toBe(exitCodes.failed);

    expect(stderr).toContain("Claude declined");
    expect(existsSync(path.join(cwd, "depbot.policy.yml"))).toBe(false);
  });

  it("tells you to set GEMINI_API_KEY, once, when a Gemini model has no key", async () => {
    vi.stubEnv("GEMINI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_API_KEY", undefined);

    // No stand-in describer: this goes through the real path, which stops before any request.
    expect(await cli("init", "--describe", "npm", "--model", "gemini-3-flash-preview")).toBe(
      exitCodes.failed,
    );

    expect(stderr.match(/No Gemini API key found\. Set GEMINI_API_KEY\./g)).toHaveLength(1);
    expect(stderr).not.toContain("ANTHROPIC_API_KEY");
    expect(existsSync(path.join(cwd, "depbot.policy.yml"))).toBe(false);
  });

  it("hints at ANTHROPIC_API_KEY when a Claude model fails without credentials", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", undefined);
    fakeDescribe = async () => {
      throw new Error("Could not resolve authentication method");
    };

    expect(await cli("init", "--describe", "npm", "--model", "claude-haiku-5-5")).toBe(
      exitCodes.failed,
    );

    expect(stderr).toContain("Set ANTHROPIC_API_KEY");
  });

  it("doesn't hint at an Anthropic key for a Gemini failure", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    fakeDescribe = async () => {
      throw new Error("boom");
    };

    await cli("init", "--describe", "npm", "--model", "gemini-3.1-pro-preview");

    expect(stderr).not.toContain("ANTHROPIC_API_KEY");
  });

  it("doesn't overwrite an existing policy", async () => {
    write("depbot.policy.yml", "mine");
    fakeDescribe = async () => ({ source: described, errors: [], notes: [] });

    expect(await cli("init", "--describe", "npm")).toBe(exitCodes.failed);
    expect(read("depbot.policy.yml")).toBe("mine");
  });

  it("rejects an empty description", async () => {
    expect(await cli("init", "--describe", "  ")).toBe(exitCodes.usage);
  });
});
