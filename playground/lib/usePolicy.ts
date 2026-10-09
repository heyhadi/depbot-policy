import { useDeferredValue, useMemo, useState } from "react";
import {
  generateAutoMergeWorkflow,
  generateDependabotConfig,
  parsePolicy,
  type Policy,
  type PolicyError,
} from "depbot-policy";

export interface GeneratedFile {
  path: string;
  contents: string;
}

export interface PolicyState {
  errors: PolicyError[];
  /** Output for the current policy or, while it's invalid, for the last valid one. */
  files: GeneratedFile[] | undefined;
  /** True when `files` come from an earlier version because the current one has errors. */
  stale: boolean;
}

export function generateFiles(policy: Policy): GeneratedFile[] {
  return [
    { path: ".github/dependabot.yml", contents: generateDependabotConfig(policy) },
    {
      path: ".github/workflows/dependabot-auto-merge.yml",
      contents: generateAutoMergeWorkflow(policy),
    },
  ];
}

export function usePolicy(source: string): PolicyState {
  // Parsing runs at a lower priority than typing, so the editor stays responsive.
  const deferredSource = useDeferredValue(source);
  const result = useMemo(() => parsePolicy(deferredSource), [deferredSource]);
  const files = useMemo(() => (result.ok ? generateFiles(result.policy) : undefined), [result]);

  // Keep the last good output on screen while the user is mid-edit.
  const [lastFiles, setLastFiles] = useState(files);
  if (files !== undefined && files !== lastFiles) setLastFiles(files);

  return {
    errors: result.ok ? [] : result.errors,
    files: files ?? lastFiles,
    stale: files === undefined && lastFiles !== undefined,
  };
}
