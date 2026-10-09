import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { generateAutoMergeWorkflow, parsePolicy, type Policy } from "../src/index.js";

const examplePath = new URL("../examples/depbot.policy.yml", import.meta.url);
const base = "version: 1\necosystems: [{ type: npm, directory: / }]";

function policyFrom(source: string): Policy {
  const result = parsePolicy(source);
  if (!result.ok) throw new Error(`invalid test policy: ${JSON.stringify(result.errors)}`);
  return result.policy;
}

function workflowFor(source: string) {
  return parse(generateAutoMergeWorkflow(policyFrom(source)));
}

function mergeStep(workflow: ReturnType<typeof workflowFor>) {
  return workflow.jobs["auto-merge"].steps[1];
}

// These snapshot files are also linted by actionlint in CI.
describe("generateAutoMergeWorkflow: snapshots", () => {
  it("example policy", async () => {
    const output = generateAutoMergeWorkflow(policyFrom(readFileSync(examplePath, "utf8")));

    await expect(output).toMatchFileSnapshot("__snapshots__/example.auto-merge.yml");
  });

  it("patch and minor, development only, merge commit", async () => {
    const output = generateAutoMergeWorkflow(
      policyFrom(
        `${base}\nautoMerge: { updateTypes: [patch, minor], dependencyTypes: [development], mergeMethod: merge }`,
      ),
    );

    await expect(output).toMatchFileSnapshot("__snapshots__/minor-dev.auto-merge.yml");
  });
});

describe("generateAutoMergeWorkflow: content", () => {
  it("only runs for pull requests opened and triggered by Dependabot", () => {
    const workflow = workflowFor(base);

    expect(workflow.on).toBe("pull_request");
    expect(workflow.jobs["auto-merge"].if).toBe(
      "github.event.pull_request.user.login == 'dependabot[bot]' && github.actor == 'dependabot[bot]'",
    );
  });

  it("asks only for the permissions it needs", () => {
    expect(workflowFor(base).permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
    });
  });

  it("pins fetch-metadata to a commit with a version comment", () => {
    const output = generateAutoMergeWorkflow(policyFrom(base));

    expect(output).toMatch(/uses: dependabot\/fetch-metadata@[0-9a-f]{40} # v\d+\.\d+\.\d+\n/);
  });

  it("auto-merges only patch updates by default", () => {
    const step = mergeStep(workflowFor(base));

    expect(step.if).toContain("steps.metadata.outputs.update-type == 'version-update:semver-patch'");
    expect(step.if).not.toContain("semver-minor");
    expect(step.if).not.toContain("semver-major");
  });

  it("includes minor updates when the policy allows them", () => {
    const step = mergeStep(workflowFor(`${base}\nautoMerge: { updateTypes: [patch, minor] }`));

    expect(step.if).toContain(
      "(steps.metadata.outputs.update-type == 'version-update:semver-patch' || steps.metadata.outputs.update-type == 'version-update:semver-minor')",
    );
  });

  it("limits auto-merge to the allowed dependency types", () => {
    const step = mergeStep(workflowFor(`${base}\nautoMerge: { dependencyTypes: [development] }`));

    expect(step.if).toContain("steps.metadata.outputs.dependency-type == 'direct:development'");
    expect(step.if).not.toContain("direct:production");
    expect(step.if).not.toContain("indirect");
  });

  it("never auto-merges when the package's maintainers changed", () => {
    const step = mergeStep(workflowFor(base));

    expect(step.if).toContain("steps.metadata.outputs.maintainer-changes != 'true'");
  });

  it.each(["squash", "merge", "rebase"])("merges with --%s", (method) => {
    const step = mergeStep(workflowFor(`${base}\nautoMerge: { mergeMethod: ${method} }`));

    expect(step.run).toBe(`gh pr merge --auto --${method} "$PR_URL"`);
  });

  it("passes the PR URL through an environment variable, not inline in the script", () => {
    const step = mergeStep(workflowFor(base));

    expect(step.run).not.toContain("${{");
    expect(step.env.PR_URL).toBe("${{ github.event.pull_request.html_url }}");
  });
});
