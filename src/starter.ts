/** The policy `depbot-policy init` writes: valid as-is, with every option explained. */
export const starterPolicy = `# depbot-policy: https://github.com/heyhadi/depbot-policy
# After editing, run \`npx depbot-policy generate\` and commit the generated files.
version: 1

# Package managers and directories for Dependabot to watch.
# type: bundler, cargo, composer, docker, github-actions, gomod, gradle, maven, mix,
#       npm, nuget, pip, pub, swift, terraform
# schedule: daily, weekly (default), monthly
ecosystems:
  - type: npm
    directory: /
    schedule: weekly
  - type: github-actions
    directory: /
    schedule: monthly

# Which Dependabot pull requests merge without a person, once required checks pass.
# Major updates are never auto-merged.
autoMerge:
  updateTypes: [patch]                       # patch, minor
  dependencyTypes: [development, production]
  mergeMethod: squash                        # squash, merge, rebase

# Packages Dependabot should never update. The reason is kept in dependabot.yml.
block: []
#  - name: react
#    reason: Pinned until the React 19 migration
#    ecosystems: [npm]

# Pull requests that aren't auto-merged get a review request from this week's person.
# review:
#   rotation: [your-github-username]
`;
