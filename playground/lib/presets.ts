export interface Preset {
  id: string;
  label: string;
  source: string;
}

// `full` mirrors examples/depbot.policy.yml; a test keeps the two in sync.
export const presets: Preset[] = [
  {
    id: "full",
    label: "Full example",
    source: `version: 1

ecosystems:
  - type: npm
    directory: /
    schedule: weekly
  - type: github-actions
    directory: /
    schedule: monthly

autoMerge:
  updateTypes: [patch]
  dependencyTypes: [development, production]

block:
  - name: react
    reason: Pinned until the React 19 migration
    ecosystems: [npm]
  - name: "@types/*"
    reason: Type packages are updated together with their runtime package
    ecosystems: [npm]

review:
  rotation: [alice, bob, carol]
`,
  },
  {
    id: "minimal",
    label: "Minimal",
    source: `version: 1
ecosystems:
  - type: npm
    directory: /
`,
  },
  {
    id: "monorepo",
    label: "Monorepo, dev dependencies only",
    source: `version: 1

ecosystems:
  - type: npm
    directory: /apps/web
    schedule: daily
  - type: npm
    directory: /apps/api
    schedule: daily
  - type: docker
    directory: /

autoMerge:
  updateTypes: [patch, minor]
  dependencyTypes: [development]
  mergeMethod: rebase
`,
  },
  {
    id: "broken",
    label: "With mistakes",
    source: `version: 1

ecosystems:
  - type: yarn
    directory: web
    shedule: daily

autoMerge:
  updateTypes: [patch, major]

block:
  - name: react
`,
  },
];
