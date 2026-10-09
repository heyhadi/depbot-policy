"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { GeneratedFile } from "@/lib/usePolicy";
import { CodeViewer } from "./CodeViewer";

interface OutputPanelProps {
  files: GeneratedFile[] | undefined;
  stale: boolean;
  dark: boolean;
}

export function OutputPanel({ files, stale, dark }: OutputPanelProps) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  if (files === undefined) {
    return (
      <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
        Fix the errors in the policy to see the generated files.
      </p>
    );
  }

  const file = files[selected] ?? files[0]!;

  // Arrow keys move between tabs, per the WAI-ARIA tabs pattern.
  function onTabKeyDown(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 || files === undefined) return;
    event.preventDefault();
    const next = (selected + step + files.length) % files.length;
    setSelected(next);
    tabs.current[next]?.focus();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-2 border-b border-zinc-200 pr-2 dark:border-zinc-800">
        <div role="tablist" aria-label="Generated files" className="flex min-w-0 overflow-x-auto">
          {files.map((tab, index) => (
            <button
              key={tab.path}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              id={`${id}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={index === selected}
              aria-controls={`${id}-panel`}
              tabIndex={index === selected ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={onTabKeyDown}
              title={tab.path}
              className="shrink-0 border-b-2 border-transparent px-4 py-2.5 font-mono text-xs text-zinc-500 hover:text-zinc-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600 aria-selected:border-emerald-600 aria-selected:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 dark:aria-selected:text-zinc-100"
            >
              {tab.path.split("/").pop()}
            </button>
          ))}
        </div>
        <FileActions file={file} />
      </div>

      {stale && (
        <p
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          The policy has errors. Showing output from the last valid version.
        </p>
      )}

      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${selected}`}
        className={`min-h-0 flex-1 ${stale ? "opacity-60" : ""}`}
      >
        <p className="border-b border-zinc-100 px-4 py-1.5 font-mono text-[11px] text-zinc-500 dark:border-zinc-900 dark:text-zinc-500">
          {file.path}
        </p>
        <div className="h-[calc(100%-1.75rem)]">
          <CodeViewer value={file.contents} label={file.path} dark={dark} />
        </div>
      </div>
    </div>
  );
}

function FileActions({ file }: { file: GeneratedFile }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  async function copy() {
    await navigator.clipboard.writeText(file.contents);
    setCopied(true);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([file.contents], { type: "text/yaml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.path.split("/").pop()!;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex shrink-0 gap-1">
      <button type="button" onClick={copy} className={smallButton}>
        {copied ? "Copied" : "Copy"}
      </button>
      <button type="button" onClick={download} className={smallButton}>
        Download
      </button>
    </div>
  );
}

const smallButton =
  "rounded-md px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";
