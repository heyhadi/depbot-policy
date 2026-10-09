"use client";

import type { PolicyError } from "depbot-policy";
import { useEffect, useRef, useState } from "react";
import { presets } from "@/lib/presets";
import { readSharedPolicy, shareUrl } from "@/lib/share";
import { useDarkMode } from "@/lib/useDarkMode";
import { usePolicy } from "@/lib/usePolicy";
import { ErrorList } from "./ErrorList";
import { OutputPanel } from "./OutputPanel";
import { PolicyEditor, type PolicyEditorHandle } from "./PolicyEditor";

const defaultSource = presets[0]!.source;

export function Playground() {
  const [source, setSource] = useState(defaultSource);
  const [preset, setPreset] = useState(presets[0]!.id);
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");
  const editor = useRef<PolicyEditorHandle>(null);
  const dark = useDarkMode();
  const { errors, files, stale } = usePolicy(source);

  // Open a shared link's policy. The hash is only readable in the browser, hence the effect.
  useEffect(() => {
    const shared = readSharedPolicy(window.location.hash);
    if (shared === undefined) return;
    setSource(shared);
    setPreset("");
  }, []);

  useEffect(() => {
    if (shareState === "idle") return;
    const timeout = setTimeout(() => setShareState("idle"), 2000);
    return () => clearTimeout(timeout);
  }, [shareState]);

  function onSourceChange(value: string) {
    setSource(value);
    setPreset("");
  }

  function onPresetChange(id: string) {
    const next = presets.find((candidate) => candidate.id === id);
    if (next === undefined) return;
    setPreset(id);
    setSource(next.source);
  }

  async function share() {
    const url = shareUrl(window.location.href, source);
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      setShareState("copied");
    } catch {
      setShareState("failed");
    }
  }

  function reveal(error: PolicyError) {
    if (error.location) editor.current?.reveal(error.location.start, error.location.end);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Start from
          <select
            value={preset}
            onChange={(event) => onPresetChange(event.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {preset === "" && <option value="">Your policy</option>}
            {presets.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={share}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {shareState === "copied"
            ? "Link copied"
            : shareState === "failed"
              ? "Copy the URL from the address bar"
              : "Share link"}
        </button>
        <Status errorCount={errors.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Policy" className={panel}>
          <h2 className={panelHeading}>depbot.policy.yml</h2>
          <div className="h-[24rem] min-h-0 lg:h-auto lg:flex-1">
            <PolicyEditor
              ref={editor}
              value={source}
              onChange={onSourceChange}
              errors={errors}
              dark={dark}
            />
          </div>
          {errors.length > 0 && (
            <div className="max-h-48 overflow-y-auto border-t border-red-200 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20">
              <ErrorList errors={errors} onSelect={reveal} />
            </div>
          )}
        </section>

        <section aria-label="Generated files" className={`${panel} h-[28rem]`}>
          <OutputPanel files={files} stale={stale} dark={dark} />
        </section>
      </div>
    </div>
  );
}

function Status({ errorCount }: { errorCount: number }) {
  return (
    <p
      role="status"
      className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        errorCount === 0
          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300"
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${errorCount === 0 ? "bg-emerald-500" : "bg-red-500"}`}
      />
      {errorCount === 0 ? "Valid policy" : `${errorCount} ${errorCount === 1 ? "error" : "errors"}`}
    </p>
  );
}

const panel =
  "flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm lg:h-[calc(100dvh-13rem)] lg:min-h-[32rem] dark:border-zinc-800 dark:bg-zinc-900";
const panelHeading =
  "border-b border-zinc-200 px-4 py-2.5 font-mono text-xs font-normal text-zinc-500 dark:border-zinc-800 dark:text-zinc-400";
