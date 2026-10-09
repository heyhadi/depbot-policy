# depbot-policy

One policy file → `dependabot.yml`, a patch-only auto-merge workflow, a block list, and a weekly review rotation.

> Work in progress.

## Try it locally

Requires Node 22.

```sh
npm install
npm test          # library tests
npm run preview   # validate examples/depbot.policy.yml and print the generated files
```

The web playground lives in [`playground/`](playground/):

```sh
cd playground
npm install
npm run dev       # http://localhost:3000
```
