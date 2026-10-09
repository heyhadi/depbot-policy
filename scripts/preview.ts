// Dev-only preview until the CLI lands: validates a policy and prints every generated file.
// Usage: npm run preview [-- path/to/depbot.policy.yml]
import { readFileSync } from "node:fs";
import { generateAutoMergeWorkflow, generateDependabotConfig, parsePolicy } from "../src/index.ts";

const path = process.argv[2] ?? "examples/depbot.policy.yml";
const result = parsePolicy(readFileSync(path, "utf8"));

if (!result.ok) {
  for (const error of result.errors) {
    const where = error.location ? `${path}:${error.location.line}:${error.location.column}` : path;
    console.error(`${where}: ${error.path ? `${error.path}: ` : ""}${error.message}`);
  }
  process.exit(1);
}

const files = {
  ".github/dependabot.yml": generateDependabotConfig(result.policy),
  ".github/workflows/dependabot-auto-merge.yml": generateAutoMergeWorkflow(result.policy),
};
for (const [name, contents] of Object.entries(files)) {
  process.stdout.write(`# ==> ${name} <==\n${contents}\n`);
}
