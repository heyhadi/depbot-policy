import { generateDependabotConfig } from "./dependabot.ts";
import type { Policy } from "./schema.ts";
import { generateAutoMergeWorkflow } from "./workflow.ts";

export interface GeneratedFile {
  /** Path from the repository root. */
  path: string;
  contents: string;
}

/** Every file a policy produces, at the path it belongs in a repository. */
export function generateFiles(policy: Policy): GeneratedFile[] {
  return [
    { path: ".github/dependabot.yml", contents: generateDependabotConfig(policy) },
    {
      path: ".github/workflows/dependabot-auto-merge.yml",
      contents: generateAutoMergeWorkflow(policy),
    },
  ];
}
