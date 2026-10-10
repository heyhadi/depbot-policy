import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  defaultDescribeModel,
  describeModel,
  describeModels,
  isDescribeModelId,
  providerLabel,
  type DescribeModelId,
} from "./describe-models.ts";
import type { DescribeResult } from "./describe.ts";
import { generateFiles } from "./files.ts";
import { parsePolicy, type PolicyError } from "./parse.ts";
import { reviewerFor } from "./rotation.ts";
import type { Policy } from "./schema.ts";
import { starterPolicy } from "./starter.ts";

export interface CliIo {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Writes a policy from a description. Defaults to calling the chosen provider; tests pass a stand-in. */
  describe?: (description: string, model: DescribeModelId) => Promise<DescribeResult>;
}

/** Exit codes: 0 success, 1 invalid policy or outdated files, 2 wrong usage. */
export const exitCodes = { ok: 0, failed: 1, usage: 2 } as const;

const defaultPolicyPath = "depbot.policy.yml";

// The model list, grouped by provider, for the --model help. Each provider gets its own heading
// so the two sets of models don't blur together.
const modelHelp = (["anthropic", "google"] as const)
  .map((provider) => {
    const heading = provider === "anthropic" ? "Claude models:" : "Gemini models:";
    return [
      `                      ${heading}`,
      ...describeModels
        .filter((model) => model.provider === provider)
        .map((model) => `                      ${model.id.padEnd(23)} ${model.summary}`),
    ].join("\n");
  })
  .join("\n");

const usage = `Usage: depbot-policy <command> [options]

Commands:
  init        Create a starter ${defaultPolicyPath}, or one written by AI with --describe
  generate    Write .github/dependabot.yml and the auto-merge workflow
  check       Fail if the policy is invalid or the generated files are out of date
  reviewer    Print this week's reviewer from review.rotation

Options:
  --policy <file>   Policy file (default: ${defaultPolicyPath})
  --out <dir>       Repository root to write to or check (default: .)
  --dry-run         generate: print the files instead of writing them
  --describe <text> init: have an AI model write the policy from a description
                    (needs ANTHROPIC_API_KEY or GEMINI_API_KEY)
  --model <id>      init --describe: which model to use (default: ${defaultDescribeModel})
${modelHelp}
  --force           init: overwrite an existing policy file
  --date <date>     reviewer: use this date instead of today (e.g. 2026-10-12)
  -h, --help        Show this help
  -v, --version     Show the version
`;

/** Runs the CLI and returns its exit code. Side effects go through `io` and the file system. */
export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        policy: { type: "string", default: defaultPolicyPath },
        out: { type: "string", default: "." },
        "dry-run": { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        describe: { type: "string" },
        model: { type: "string" },
        date: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${usage}`);
    return exitCodes.usage;
  }

  const { values, positionals } = parsed;
  if (values.version) {
    io.stdout(`${packageVersion()}\n`);
    return exitCodes.ok;
  }
  const [command, ...extra] = positionals;
  if (values.help || command === undefined) {
    io.stdout(usage);
    return exitCodes.ok;
  }
  if (extra.length > 0) {
    io.stderr(`Unexpected argument: ${extra[0]}\n\n${usage}`);
    return exitCodes.usage;
  }

  if (values.model !== undefined && values.describe === undefined) {
    io.stderr("--model only applies to init --describe.\n");
    return exitCodes.usage;
  }

  const policyPath = values.policy;
  const resolve = (file: string) => path.resolve(io.cwd, file);

  switch (command) {
    case "init": {
      if (existsSync(resolve(policyPath)) && !values.force) {
        io.stderr(`${policyPath} already exists. Use --force to overwrite it.\n`);
        return exitCodes.failed;
      }
      if (values.describe === undefined) {
        writeFileSync(resolve(policyPath), starterPolicy);
        io.stdout(`Created ${policyPath}. Edit it, then run: depbot-policy generate\n`);
        return exitCodes.ok;
      }
      return describeInto(policyPath, values.describe, values.model, resolve, io);
    }

    case "generate": {
      const policy = loadPolicy(policyPath, resolve, io);
      if (policy === undefined) return exitCodes.failed;
      for (const file of generateFiles(policy)) {
        if (values["dry-run"]) {
          io.stdout(`# ==> ${file.path} <==\n${file.contents}\n`);
          continue;
        }
        const target = path.join(resolve(values.out), file.path);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, file.contents);
        io.stdout(`Wrote ${path.relative(io.cwd, target) || target}\n`);
      }
      return exitCodes.ok;
    }

    case "check": {
      const policy = loadPolicy(policyPath, resolve, io);
      if (policy === undefined) return exitCodes.failed;
      const problems = generateFiles(policy).flatMap((file) => {
        const target = path.join(resolve(values.out), file.path);
        if (!existsSync(target)) return [`${file.path} is missing`];
        return readFileSync(target, "utf8") === file.contents ? [] : [`${file.path} is out of date`];
      });
      if (problems.length > 0) {
        for (const problem of problems) io.stderr(`${problem}\n`);
        io.stderr("Run `depbot-policy generate` and commit the result.\n");
        return exitCodes.failed;
      }
      io.stdout(`${policyPath} is valid and the generated files are up to date.\n`);
      return exitCodes.ok;
    }

    case "reviewer": {
      const policy = loadPolicy(policyPath, resolve, io);
      if (policy === undefined) return exitCodes.failed;
      if (policy.review === undefined) {
        io.stderr(`${policyPath} has no review.rotation.\n`);
        return exitCodes.failed;
      }
      const date = values.date === undefined ? new Date() : new Date(values.date);
      if (Number.isNaN(date.getTime())) {
        io.stderr(`Not a valid date: ${values.date}\n`);
        return exitCodes.usage;
      }
      io.stdout(`${reviewerFor(policy.review.rotation, date)}\n`);
      return exitCodes.ok;
    }

    default:
      io.stderr(`Unknown command: ${command}\n\n${usage}`);
      return exitCodes.usage;
  }
}

async function describeInto(
  policyPath: string,
  description: string,
  modelOption: string | undefined,
  resolve: (file: string) => string,
  io: CliIo,
): Promise<number> {
  if (description.trim() === "") {
    io.stderr("--describe needs a description, e.g. --describe \"pnpm monorepo, auto-merge patches\"\n");
    return exitCodes.usage;
  }
  // Loaded on demand, so the other commands never load the provider SDKs.
  const describeModule = await import("./describe.ts");
  const model = modelOption ?? defaultDescribeModel;
  if (!isDescribeModelId(model)) {
    const ids = describeModels.map((candidate) => candidate.id).join(", ");
    io.stderr(`Unknown model: ${model}. Use one of: ${ids}\n`);
    return exitCodes.usage;
  }
  const describe =
    io.describe ??
    ((text: string, chosen: DescribeModelId) =>
      describeModule.describePolicy(text, describeModule.environmentClient(describeModel(chosen).provider), {
        model: chosen,
      }));

  const { label } = describeModels.find((candidate) => candidate.id === model)!;
  io.stdout(`Asking ${label} to write the policy...\n`);
  let result: DescribeResult;
  try {
    result = await describe(description, model);
  } catch (error) {
    io.stderr(`${describeModule.describeFailureMessage(error)}\n`);
    // A missing Gemini key already says so. For Claude, the SDK's own error doesn't.
    if (
      describeModel(model).provider === "anthropic" &&
      !process.env.ANTHROPIC_API_KEY &&
      !process.env.ANTHROPIC_AUTH_TOKEN
    ) {
      io.stderr("Set ANTHROPIC_API_KEY (or log in with `ant auth login`) to use --describe.\n");
    }
    return exitCodes.failed;
  }

  writeFileSync(resolve(policyPath), result.source);
  for (const note of result.notes) io.stdout(`Note: ${note}\n`);
  if (result.errors.length > 0) {
    io.stderr(`Created ${policyPath}, but it still has problems to fix by hand:\n`);
    for (const error of result.errors) io.stderr(`${formatError(policyPath, error)}\n`);
    return exitCodes.failed;
  }
  io.stdout(`Created ${policyPath}. Review it, then run: depbot-policy generate\n`);
  return exitCodes.ok;
}

function loadPolicy(
  policyPath: string,
  resolve: (file: string) => string,
  io: CliIo,
): Policy | undefined {
  let source: string;
  try {
    source = readFileSync(resolve(policyPath), "utf8");
  } catch {
    io.stderr(`Can't read ${policyPath}. Create one with: depbot-policy init\n`);
    return undefined;
  }
  const result = parsePolicy(source);
  if (!result.ok) {
    for (const error of result.errors) io.stderr(`${formatError(policyPath, error)}\n`);
    return undefined;
  }
  return result.policy;
}

/** `file:line:column: path: message`, the format editors and CI annotations understand. */
export function formatError(file: string, error: PolicyError): string {
  const where = error.location ? `${file}:${error.location.line}:${error.location.column}` : file;
  return `${where}: ${error.path ? `${error.path}: ` : ""}${error.message}`;
}

function packageVersion(): string {
  // src/cli.ts and dist/cli.js are both one level below package.json.
  const packageJson = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(packageJson, "utf8")) as { version: string }).version;
}
