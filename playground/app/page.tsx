import { Playground } from "@/components/Playground";

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-mono text-lg font-semibold tracking-tight">
            depbot-policy{" "}
            <span className="font-sans text-sm font-normal text-zinc-500 dark:text-zinc-400">
              playground
            </span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            One policy file becomes a <code className="font-mono">dependabot.yml</code> and a
            workflow that auto-merges only the updates you allow. Edit the policy to see both
            change. Nothing leaves your browser.
          </p>
        </div>
        <a
          href="https://github.com/heyhadi/depbot-policy"
          className="text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          GitHub
        </a>
      </header>

      <main>
        <Playground />
      </main>
    </div>
  );
}
