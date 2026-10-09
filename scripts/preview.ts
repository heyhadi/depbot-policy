// Dev-only preview until the CLI lands: validates a policy and prints the generated dependabot.yml.
// Usage: npm run preview [-- path/to/depbot.policy.yml]
import { readFileSync } from "node:fs";
import { generateDependabotConfig, parsePolicy } from "../src/index.js";

const path = process.argv[2] ?? "examples/depbot.policy.yml";
const result = parsePolicy(readFileSync(path, "utf8"));

if (!result.ok) {
  for (const error of result.errors) {
    console.error(`${path}: ${error.path || "(file)"}: ${error.message}`);
  }
  process.exit(1);
}

process.stdout.write(generateDependabotConfig(result.policy));
