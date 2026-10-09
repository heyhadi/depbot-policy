# depbot-policy

[![CI](https://github.com/heyhadi/depbot-policy/actions/workflows/ci.yml/badge.svg)](https://github.com/heyhadi/depbot-policy/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/depbot-policy.svg)](https://www.npmjs.com/package/depbot-policy)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Write one small policy file. Get a `dependabot.yml` and a GitHub Actions workflow that
auto-merges only the dependency updates you consider safe, and hands everything else to this
week's reviewer.

```yaml
# depbot.policy.yml
version: 1
ecosystems:
  - type: npm
    directory: /
autoMerge:
  updateTypes: [patch]
block:
  - name: react
    reason: Pinned until the React 19 migration
review:
  rotation: [alice, bob, carol]
```

```sh
npx depbot-policy generate
```

- `.github/dependabot.yml`: what Dependabot updates, how often, and what it ignores, with your
  reasons kept as comments.
- `.github/workflows/dependabot-auto-merge.yml`: merges patch updates once CI passes, never major
  ones, and requests a review from this week's person for everything else.

**[Try it in the browser →](https://heyhadi.github.io/depbot-policy/)**

## Contents

- [Why](#why)
- [Quick start](#quick-start)
- [CLI](#cli)
- [Writing a policy with AI](#writing-a-policy-with-ai)
- [Policy reference](#policy-reference)
- [What gets generated](#what-gets-generated)
- [Repository setup](#repository-setup)
- [Keeping files in sync in CI](#keeping-files-in-sync-in-ci)
- [Validation and errors](#validation-and-errors)
- [Web playground](#web-playground)
- [Library API](#library-api)
- [Development](#development)
- [Releasing](#releasing)
- [Design notes](#design-notes)

## Why

Dependabot opens a pull request for every dependency update. Teams end up either merging them
without looking or letting them pile up. Setting up something better usually means hand-writing
two YAML files that have to agree with each other:

- `dependabot.yml`, for what to update and what to ignore, and
- an auto-merge workflow full of `fetch-metadata` outputs and GitHub expressions.

depbot-policy replaces both with one validated file:

- **Safe updates merge themselves.** Patch updates (and minor ones, if you opt in) merge after your
  CI passes.
- **Risky updates go to a person.** Major versions, packages whose maintainers changed, and
  anything else outside the policy get a review request from whoever's turn it is this week.
- **Blocked packages stay blocked, with a reason.** The reason is kept next to the rule, so the
  block list can be cleaned up later.

## Quick start

Requires Node 22 or newer.

```sh
# 1. Create a starter policy (valid as-is, with every option explained)
npx depbot-policy init

# 2. Edit depbot.policy.yml, then generate the files
npx depbot-policy generate

# 3. Commit all three files
git add depbot.policy.yml .github/dependabot.yml .github/workflows/dependabot-auto-merge.yml
git commit -m "Manage Dependabot with depbot-policy"
```

Then do the one-time [repository setup](#repository-setup), so that auto-merge waits for CI.

Prefer to describe what you want? `npx depbot-policy init --describe "…"` has Claude write the
policy for you. See [Writing a policy with AI](#writing-a-policy-with-ai).

To change anything later, edit `depbot.policy.yml` and run `npx depbot-policy generate` again.
Don't edit the generated files by hand. [`check`](#keeping-files-in-sync-in-ci) catches that.

## CLI

```text
depbot-policy <command> [options]

Commands:
  init        Create a starter depbot.policy.yml, or one written by Claude with --describe
  generate    Write .github/dependabot.yml and the auto-merge workflow
  check       Fail if the policy is invalid or the generated files are out of date
  reviewer    Print this week's reviewer from review.rotation

Options:
  --policy <file>   Policy file (default: depbot.policy.yml)
  --out <dir>       Repository root to write to or check (default: .)
  --dry-run         generate: print the files instead of writing them
  --describe <text> init: have Claude write the policy from a description
                    (needs ANTHROPIC_API_KEY)
  --model <id>      init --describe: which Claude model to use (default: claude-opus-5-5)
  --force           init: overwrite an existing policy file
  --date <date>     reviewer: use this date instead of today (e.g. 2026-10-12)
  -h, --help        Show this help
  -v, --version     Show the version
```

| Command | Exit code |
|---|---|
| Success | `0` |
| Invalid policy, `check` found missing or outdated files, or `--describe` failed | `1` |
| Wrong usage (unknown command or option, bad `--date`) | `2` |

Examples:

```sh
npx depbot-policy generate --dry-run                 # preview without writing anything
npx depbot-policy generate --policy ops/deps.yml     # policy somewhere else
npx depbot-policy reviewer                           # who's on duty this week?
npx depbot-policy reviewer --date 2026-12-28         # ...and in the last week of the year?
```

You can also install it as a dev dependency (`npm install --save-dev depbot-policy`) and call
`depbot-policy` from npm scripts.

## Writing a policy with AI

Describe your setup in plain words and let Claude write the policy:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
npx depbot-policy init --describe "pnpm monorepo with apps in /apps/web and /apps/api, \
  plus Dockerfiles. Auto-merge patch updates to dev dependencies. Never update react \
  until we migrate to 19. alice and bob-smith take turns reviewing."
```

Example output (Claude's notes vary):

```text
Asking Claude to write the policy...
Note: Assumed a weekly schedule, since none was given.
Created depbot.policy.yml. Review it, then run: depbot-policy generate
```

The [playground](#web-playground) has the same feature under **Describe with AI**.

**How it works.** Claude only writes the *policy*. It never writes the workflow or
`dependabot.yml`.

1. Claude fills in a simplified version of the policy schema, using
   [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), and
   adds short notes about any assumptions it made.
2. depbot-policy turns that into YAML and validates it with the same rules as a hand-written
   policy.
3. If anything fails validation, the errors go back to Claude once to fix. Anything still wrong is
   reported with its line and column, like any other policy error.
4. You review the policy. `generate` then produces the files with the same deterministic code as
   always.

So the safety properties of the generated workflow (pinned actions, minimal permissions, the
Dependabot-only checks, no major auto-merges) don't depend on the model.

**Details:**

- **Models:** pick one with `--model <id>` (or the Model menu in the playground). All run at low
  effort, and costs are rough list-price estimates per policy:

  | Model | `--model` | About |
  |---|---|---|
  | Claude Opus 5.5 (default) | `claude-opus-5-5` | 3–5¢, best balance of quality and cost |
  | Claude Sonnet 5.5 | `claude-sonnet-5-5` | 2¢, faster and cheaper |
  | Claude Haiku 5.5 | `claude-haiku-5-5` | well under 1¢, fastest and cheapest |
  | Claude Fable 5.1 | `claude-fable-5-1` | 8–13¢, most capable |

  Try a cheaper model first. This is a short, well-specified task, and every result is validated
  and shown to you before it's used.
- **Credentials:** the CLI reads `ANTHROPIC_API_KEY`, or a login from Anthropic's `ant` CLI.
- **Privacy:** only your description is sent to Anthropic. The playground sends it straight from
  your browser, keeps your key in memory only, and forgets it when you leave the page.
- **Exit codes:** if Claude declines, or the result still has errors after the repair attempt,
  `init --describe` exits with `1`. If there are remaining errors, it still writes the file so you
  can fix them by hand.

## Policy reference

A complete policy, with every option:

```yaml
version: 1                       # required, always 1

ecosystems:                      # required, at least one
  - type: npm                    # required
    directory: /                 # required, starts with "/"
    schedule: weekly             # daily | weekly | monthly (default: weekly)
  - type: github-actions
    directory: /
    schedule: monthly

autoMerge:                       # optional; defaults shown
  updateTypes: [patch]           # patch, minor
  dependencyTypes: [development, production]
  mergeMethod: squash            # squash | merge | rebase

block:                           # optional, default: []
  - name: react                  # package name or glob, e.g. "@types/*"
    reason: Pinned until the React 19 migration   # required
    ecosystems: [npm]            # optional; default: every ecosystem

review:                          # optional
  rotation: [alice, bob, carol]  # GitHub usernames
```

### `version`

Must be `1`. It's there so that a future, incompatible format can be detected and migrated.

### `ecosystems`

One entry for each package manager and directory that Dependabot should watch.

| Field | Required | Values | Default |
|---|---|---|---|
| `type` | yes | `bundler`, `cargo`, `composer`, `docker`, `github-actions`, `gomod`, `gradle`, `maven`, `mix`, `npm`, `nuget`, `pip`, `pub`, `swift`, `terraform` | |
| `directory` | yes | Path from the repository root, starting with `/` (e.g. `/`, `/apps/web`) | |
| `schedule` | no | `daily`, `weekly`, `monthly` | `weekly` |

- Yarn, pnpm and Bun projects use `npm`; Poetry and Pipenv use `pip`. If you write one of those
  names instead, the error message tells you which one to use.
- The same `type` can appear more than once with different directories, which is how monorepos
  are handled. The same `type` and `directory` twice is an error.
- Include `github-actions` if you can. It keeps your workflows' actions up to date, including the
  pinned `fetch-metadata` action in the generated workflow.

### `autoMerge`

Which Dependabot pull requests merge without a person.

| Field | Values | Default |
|---|---|---|
| `updateTypes` | `patch`, `minor` | `[patch]` |
| `dependencyTypes` | `development`, `production` | `[development, production]` |
| `mergeMethod` | `squash`, `merge`, `rebase` | `squash` |

- `major` is deliberately not allowed. Major versions can contain breaking changes, so a person
  should always read them.
- `development` and `production` mean direct dependencies (Dependabot's `direct:development` and
  `direct:production`). Indirect (transitive) updates are never auto-merged.
- The merge method must be enabled in your repository settings.

If you leave out `autoMerge`, the defaults apply: patch updates to all direct dependencies,
squash-merged.

### `block`

Packages Dependabot should never update. Each entry becomes an `ignore` rule.

| Field | Required | Description |
|---|---|---|
| `name` | yes | Exact package name, or a glob such as `@types/*` |
| `reason` | yes | Why it's blocked. Kept as a comment in `dependabot.yml`. |
| `ecosystems` | no | Only block it for these ecosystem types (each must appear in `ecosystems`). Without this, it's blocked everywhere. |

### `review`

| Field | Required | Description |
|---|---|---|
| `rotation` | yes, if `review` is present | GitHub usernames, without `@`. Compared case-insensitively, so `alice` and `Alice` count as duplicates. |

Every Dependabot pull request that **isn't** auto-merged gets a review request from one person:

- **One person per week.** Weeks run from Monday 00:00 to Sunday 23:59 UTC, and people take turns
  in list order.
- **Based on when the pull request was opened**, so re-runs always pick the same person.
- **Nothing is stored anywhere.** The turn is worked out from the date alone, so
  `npx depbot-policy reviewer` (and the playground) can tell you who's on duty.
- **Changing the rota:** to cover a holiday, reorder or edit the list and regenerate.

Reviewers must have access to the repository, or GitHub rejects the request.

## What gets generated

For the [example policy](examples/depbot.policy.yml):

<details>
<summary><code>.github/dependabot.yml</code></summary>

```yaml
# Generated by depbot-policy from depbot.policy.yml. Do not edit by hand:
# change the policy file and regenerate.

version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    ignore:
      - dependency-name: react # Pinned until the React 19 migration
      - dependency-name: "@types/*" # Type packages are updated together with their runtime package
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
```

</details>

<details>
<summary><code>.github/workflows/dependabot-auto-merge.yml</code></summary>

```yaml
# Generated by depbot-policy from depbot.policy.yml. Do not edit by hand:
# change the policy file and regenerate.

# Requires, in the repository settings:
# - "Allow auto-merge" enabled.
# - Branch protection on the default branch with required status checks.
#   Without required checks, GitHub merges at once instead of waiting for CI.

name: Dependabot auto-merge
on: pull_request
permissions:
  contents: write
  pull-requests: write
jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.event.pull_request.user.login == 'dependabot[bot]' && github.actor == 'dependabot[bot]'
    steps:
      - id: metadata
        uses: dependabot/fetch-metadata@25dd0e34f4fe68f24cc83900b1fe3fe149efef98 # v3.1.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
      - id: auto-merge
        name: Enable auto-merge
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch' && (steps.metadata.outputs.dependency-type == 'direct:development' || steps.metadata.outputs.dependency-type == 'direct:production') && steps.metadata.outputs.maintainer-changes != 'true'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Request a review from this week's reviewer
        if: steps.auto-merge.outcome == 'skipped'
        run: |-
          read -ra reviewers <<< "$REVIEWERS"
          created=$(date -u -d "$PR_CREATED_AT" +%s)
          week=$(( (created + 259200) / 604800 ))
          reviewer="${reviewers[week % ${#reviewers[@]}]}"
          gh pr edit "$PR_URL" --add-reviewer "$reviewer"
        env:
          REVIEWERS: alice bob carol
          PR_CREATED_AT: ${{ github.event.pull_request.created_at }}
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

</details>

### When does a pull request get auto-merged?

All of these must be true:

1. **Dependabot opened the pull request, and Dependabot triggered this run.** If anyone else
   pushes a commit to a Dependabot branch, that run doesn't qualify.
2. **The update type is allowed** by `autoMerge.updateTypes`. For grouped updates,
   `fetch-metadata` reports the largest change in the group, so one minor bump makes the whole
   group "minor".
3. **The dependency type is allowed** by `autoMerge.dependencyTypes`.
4. **The package's maintainers haven't changed.** A new maintainer is a common sign of a
   supply-chain attack, so those updates wait for a person.

The workflow then runs `gh pr merge --auto`. That doesn't merge immediately. It tells GitHub to
merge once the branch's protection rules pass, which is why the setup below matters. If any
condition is false and the policy has a rotation, the next step requests a review instead.

## Repository setup

Do this once in each repository that uses the generated files.

1. **Allow auto-merge:** *Settings → General → Pull Requests →* check **Allow auto-merge**.
2. **Allow your merge method:** in the same section, make sure the method in
   `autoMerge.mergeMethod` (squash by default) is enabled.
3. **Require CI before merging:** *Settings → Branches* (or *Settings → Rules → Rulesets*) → add a
   rule for your default branch → **Require status checks to pass**, and select your CI checks.

   > ⚠️ Without required status checks, `gh pr merge --auto` merges straight away, without waiting
   > for CI.

4. **Commit the policy and the generated files** to the default branch.

You don't need any extra tokens or secrets. The workflow uses the built-in `GITHUB_TOKEN` and
declares the two permissions it needs. If your organization stops workflows from raising token
permissions, allow it for this repository under *Settings → Actions → General → Workflow
permissions*.

**To check it works:** the next Dependabot patch update should show "Auto-merge enabled" and merge
by itself once CI passes. A major update should get a review request instead.

## Keeping files in sync in CI

Add `check` to your CI, so a policy change can't be merged without regenerating the files:

```yaml
- run: npx depbot-policy check
```

It fails, with exit code 1, when the policy is invalid or when either generated file is missing or
differs from what the policy produces:

```text
.github/workflows/dependabot-auto-merge.yml is out of date
Run `depbot-policy generate` and commit the result.
```

## Validation and errors

The policy is validated before anything is generated, and every problem is reported at once, not
just the first. Each line is `file:line:column: path: message`, which editors and CI logs can
link to:

```text
$ npx depbot-policy check
depbot.policy.yml:4:5: ecosystems[0].type: Dependabot covers yarn under "npm"; use type: npm
depbot.policy.yml:5:5: ecosystems[0].directory: Must start with "/" (paths are relative to the repository root)
depbot.policy.yml:6:5: ecosystems[0].shedule: Unknown key
depbot.policy.yml:9:24: autoMerge.updateTypes[1]: Major updates are never auto-merged; they always need a human review
depbot.policy.yml:12:5: block[0].reason: Required
```

Rules worth knowing:

- **Unknown keys are errors**, so a typo like `automerge:` or `shedule:` is caught instead of
  being silently ignored.
- **Duplicates are errors**, and the error points at the second occurrence. This covers the same
  ecosystem and directory, the same blocked package, the same username in the rotation (ignoring
  case), and the same value twice in any list.
- **YAML syntax errors** and **duplicate YAML keys** are reported with their position too.

## Web playground

**[heyhadi.github.io/depbot-policy](https://heyhadi.github.io/depbot-policy/)** lets you write a
policy and see the generated files as you type.

- **Describe with AI.** Describe your setup in plain words, paste your own Anthropic API key, and
  Claude writes the policy into the editor, with notes on any assumptions it made. You can choose
  between four Claude models. See
  [Writing a policy with AI](#writing-a-policy-with-ai).
- **Live validation.** Errors are underlined in the editor and listed below it in line order.
  Click one to jump to the exact text.
- **Generated files in tabs**, with Copy and Download buttons. While the policy has errors, the
  last valid output stays visible, dimmed.
- **This week's reviewer** is shown when the policy has a rotation.
- **Presets:** full example, minimal, monorepo, and one with deliberate mistakes.
- **Share link:** stores the policy in the URL after the `#`. That part of a URL is never sent to
  a server, so nothing leaves your browser.
- Light and dark mode follow your system settings, the layout works on phones, and the file tabs
  can be used with the keyboard.

It's built with Next.js 16 (static export), React 19, CodeMirror 6 and Tailwind CSS 4, and it
imports the library straight from [`src/`](src/), so it always matches the code in the same commit.

## Library API

```sh
npm install depbot-policy
```

```ts
import { generateFiles, parsePolicy } from "depbot-policy";

const result = parsePolicy(source); // source: the policy's YAML text

if (!result.ok) {
  for (const error of result.errors) {
    // error.path:      "ecosystems[0].type"
    // error.message:   'Dependabot covers yarn under "npm"; use type: npm'
    // error.location?: { start, end, line, column }  (offsets, plus 1-based line and column)
  }
} else {
  for (const file of generateFiles(result.policy)) {
    // file.path:     ".github/dependabot.yml", ".github/workflows/dependabot-auto-merge.yml"
    // file.contents: the YAML to write
  }
}
```

| Export | Description |
|---|---|
| `parsePolicy(source: string): ParseResult` | Parses and validates YAML. Returns `{ ok: true, policy }` with defaults filled in, or `{ ok: false, errors }`. Never throws for bad input. |
| `generateFiles(policy): GeneratedFile[]` | Every generated file, as `{ path, contents }`. |
| `generateDependabotConfig(policy): string` | Just `.github/dependabot.yml`. |
| `generateAutoMergeWorkflow(policy): string` | Just `.github/workflows/dependabot-auto-merge.yml`. |
| `reviewerFor(rotation: string[], date: Date): string` | The reviewer on duty at `date`, using the same formula as the workflow. |
| `policySchema` | The Zod schema, if you need to validate an already-parsed object. |
| `ecosystemTypes` | The supported ecosystem names. |
| Types: `Policy`, `ParseResult`, `PolicyError`, `SourceLocation`, `GeneratedFile` | |

Everything is pure: no file system, network or global state. That's what lets the same code run in
the CLI, in tests and in the browser.

To write a policy from a description, import from `depbot-policy/describe`. It's a separate entry
point, so the core library never loads the Anthropic SDK:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { describePolicy } from "depbot-policy/describe";

const { source, errors, notes } = await describePolicy(
  "npm project at the root; auto-merge patch updates",
  new Anthropic(), // reads ANTHROPIC_API_KEY
  { model: "claude-sonnet-5-5" }, // optional; defaults to claude-opus-5-5
);
// source: policy YAML, errors: [] when valid, notes: Claude's assumptions
```

## Development

Requires Node 22 or newer (see [`.nvmrc`](.nvmrc)). Node runs the TypeScript source directly
during development; only the published package is compiled.

```sh
git clone https://github.com/heyhadi/depbot-policy.git
cd depbot-policy
npm install
npm test
```

### Commands

At the repository root:

| Command | What it does |
|---|---|
| `npm test` | Library and CLI tests (Vitest) |
| `npm run typecheck` | Type-check the library, CLI and tests |
| `npm run cli -- <command>` | Run the CLI from source, e.g. `npm run cli -- generate --dry-run --policy examples/depbot.policy.yml` |
| `npm run build` | Compile `src/` to `dist/` (JavaScript and type declarations) |

In `playground/` (run `npm install` at the root first; the playground uses the library source):

| Command | What it does |
|---|---|
| `npm install` | Install the playground's own dependencies |
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run build` | Static site in `playground/out/` |
| `npm test` | Playground tests (Vitest, React Testing Library, jsdom) |
| `npm run typecheck` | Type-check the playground |

### Project structure

```text
src/
  schema.ts          Policy schema and validation rules (Zod)
  parse.ts           parsePolicy: YAML → validated policy or errors with locations
  locate.ts          Maps an error path to its position in the YAML source
  dependabot.ts      dependabot.yml generator
  workflow.ts        Auto-merge workflow generator
  rotation.ts        Weekly reviewer: TypeScript formula and the workflow's shell version
  describe.ts        Write a policy from a description with Claude (depbot-policy/describe)
  describe-models.ts The models it can use, kept free of the SDK so help text and UI can list them
  files.ts           generateFiles: every generated file and its path
  cli.ts, bin.ts     The depbot-policy command (bin.ts is the executable entry point)
  starter.ts         The policy written by `init`
  index.ts           Public exports
test/                Library and CLI tests; __snapshots__/ holds generated files
examples/            The example policy (the playground's default preset must match it)
playground/          Next.js web playground (app/, components/, lib/, test/)
depbot.policy.yml    This repository's own policy; .github/dependabot.yml and the
                     auto-merge workflow are generated from it
.github/workflows/
  ci.yml             Tests, checks and linting on every pull request
  pages.yml          Deploys the playground to GitHub Pages
```

### Tests

- **Validation:** every rule has a test that checks the exact error path and message;
  `locate.test.ts` checks the text each error points at.
- **Generators:** two kinds of test for each file.
  - **Snapshots** (`test/__snapshots__/*.yml`) catch any change to the output's formatting. They're
    real YAML files, so changes are easy to read in a diff.
  - **Content tests** parse the output and check what it means, whatever the formatting.
- **Rotation:** the workflow's shell script runs in bash, with stand-in `date` and `gh` commands,
  and must pick the same person as `reviewerFor` on every test date.
- **CLI:** every command runs against a real temporary directory.
- **AI:** tests use a stand-in client, so they never call the API. They cover the request (model,
  structured output format, refusal fallback for each model), the repair loop, replies Claude can't use, and
  error messages.
- **Playground:** unit tests for its logic, plus tests of the whole page with React Testing Library.
  CodeMirror can't run in jsdom, so the tests replace the two small editor components with plain
  elements.

When you change a generator on purpose, update the snapshots and review the diff before
committing:

```sh
npx vitest run -u
git diff test/__snapshots__
```

### Continuous integration

[`ci.yml`](.github/workflows/ci.yml) runs on every pull request and every push to `main`:

- **Library:**
  - Type-check and tests.
  - `depbot-policy check` on this repository's own generated files.
  - A **packed-package smoke test**: `npm pack`, install the tarball in an empty project, then run
    `init`, `generate` and `check`.
  - [actionlint](https://github.com/rhysd/actionlint) on this repository's workflows *and* on the
    generated workflow snapshots, which also runs shellcheck on their scripts. actionlint is
    downloaded from a pinned release and checked against its SHA-256.
- **Playground:** type-check, tests and a production build.

[`pages.yml`](.github/workflows/pages.yml) deploys the playground to GitHub Pages when `src/` or
`playground/` changes on `main`.

### Updating the pinned `fetch-metadata` action

The generated workflow pins `dependabot/fetch-metadata` to a commit SHA. To move to a new
release:

1. Find the release's commit: `gh api repos/dependabot/fetch-metadata/commits/<tag> -q .sha`
2. Update `action` and `version` in `fetchMetadata` in [`src/workflow.ts`](src/workflow.ts).
3. Check that the outputs used in the generated `if:` conditions still exist in that release.
4. Update the snapshots (`npx vitest run -u`), run the tests, and regenerate this repository's own
   files (`npm run cli -- generate`).

## Releasing

1. Update `version` in `package.json` (for example `npm version minor`).
2. `npm publish`. `prepublishOnly` runs the type-check, the tests and the build first, so a broken
   package can't be published by accident. Only `dist/`, `README.md`, `LICENSE` and
   `package.json` are included (about 11 kB).
3. Push the commit and tag.

## Design notes

Short versions of the main decisions. The pull requests have the full reasoning.

- **One source of truth.** The Zod schema defines both the validation rules and the `Policy`
  TypeScript type, so they can't disagree.
- **Strict validation.** Unknown keys are errors, because silently ignoring `automerge:` would leave
  auto-merge on its defaults without you knowing.
- **Return errors, don't throw.** Invalid input is an expected case for a config tool, and callers
  need every error, not just the first.
- **Pure core.** No I/O in the library, so it runs unchanged in the CLI, in tests and in the
  browser.
- **Generated YAML via the `yaml` document API**, not string templates. The library handles quoting
  (`"@types/*"` must be quoted) and comments.
- **AI writes the policy, never the workflow.** Claude handles what needs judgment (understanding a
  description). Validation and generation stay deterministic, so a bad model reply can't weaken
  the security properties.
- **Stateless rotation.** The reviewer is a function of the week, so there's nothing to store, sync
  or get out of date.
- **Pinned actions.** Actions are referenced by commit SHA with a `# vX.Y.Z` comment, both in the
  generated workflow and in this repository's own workflows. Tags can be moved; SHAs can't.
  Dependabot understands the comment and updates both.
- **Least-privilege workflows.**
  - Only the permissions each job needs.
  - `pull_request`, not `pull_request_target`.
  - No `${{ }}` expressions inside `run:` scripts. Values go through environment variables, which
    prevents script injection.
- **It uses itself.** This repository's Dependabot setup is generated from its own
  [`depbot.policy.yml`](depbot.policy.yml), and CI checks it.

## License

[MIT](LICENSE) © Munawirul Hadi
