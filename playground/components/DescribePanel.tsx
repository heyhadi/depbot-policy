"use client";

import type { DescribeResult } from "depbot-policy/describe";
import {
  defaultDescribeModel,
  describeModels,
  isDescribeModelId,
  providerLabel,
  type DescribeModelId,
} from "depbot-policy/describe-models";
import { useId, useState, type FormEvent } from "react";
import { explainFailure, generatePolicy } from "@/lib/generatePolicy";

interface DescribePanelProps {
  id: string;
  onGenerated: (result: DescribeResult) => void;
}

type Status =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; notes: string[]; errorCount: number }
  | { state: "failed"; message: string };

const placeholder =
  "A pnpm monorepo with apps in /apps/web and /apps/api, plus Dockerfiles. Auto-merge patch updates to dev dependencies. Never update react until we migrate to 19. Alice and bob-smith take turns reviewing.";

export function DescribePanel({ id, onGenerated }: DescribePanelProps) {
  const [description, setDescription] = useState("");
  // Kept in memory only: every github.io project page shares one origin, so browser storage
  // would expose the key to other sites on it.
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<DescribeModelId>(defaultDescribeModel);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const fieldId = useId();
  const loading = status.state === "loading";

  // The chosen model decides which provider we talk to, which drives the key field, its help
  // text, and the wording of the result. The model always resolves, so the lookup can't miss.
  const provider = describeModels.find((option) => option.id === model)!.provider;
  const product = providerLabel(provider);
  const key = {
    anthropic: {
      name: "Anthropic",
      placeholder: "sk-ant-…",
      to: "Anthropic",
      href: "https://console.anthropic.com/settings/keys",
    },
    google: {
      name: "Gemini",
      placeholder: "AIza…",
      to: "Google's Gemini API",
      href: "https://aistudio.google.com/apikey",
    },
  }[provider];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus({ state: "loading" });
    try {
      const result = await generatePolicy(description, apiKey.trim(), model);
      onGenerated(result);
      setStatus({ state: "done", notes: result.notes, errorCount: result.errors.length });
    } catch (error) {
      setStatus({ state: "failed", message: await explainFailure(error) });
    }
  }

  return (
    <section
      id={id}
      aria-label="Write a policy with AI"
      className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${fieldId}-description`} className={labelClass}>
            Describe your setup
          </label>
          <textarea
            id={`${fieldId}-description`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={placeholder}
            rows={3}
            className={`${inputClass} resize-y`}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-48 flex-col gap-1.5">
            <label htmlFor={`${fieldId}-model`} className={labelClass}>
              Model
            </label>
            <select
              id={`${fieldId}-model`}
              value={model}
              onChange={(event) => {
                if (isDescribeModelId(event.target.value)) setModel(event.target.value);
              }}
              aria-describedby={`${fieldId}-model-help`}
              className={inputClass}
            >
              {((["anthropic", "google"] as const).map((provider) => (
                <optgroup key={provider} label={providerLabel(provider)}>
                  {describeModels
                    .filter((option) => option.provider === provider)
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                </optgroup>
              )))}
            </select>
          </div>
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <label htmlFor={`${fieldId}-key`} className={labelClass}>
              {key.name} API key
            </label>
            <input
              id={`${fieldId}-key`}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={key.placeholder}
              aria-describedby={`${fieldId}-key-help`}
              className={`${inputClass} font-mono`}
            />
          </div>
          <button
            type="submit"
            disabled={loading || description.trim() === "" || apiKey.trim() === ""}
            aria-busy={loading}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Writing…" : "Write policy"}
          </button>
        </div>

        <p id={`${fieldId}-model-help`} className="text-xs text-zinc-600 dark:text-zinc-400">
          {describeModels.find((option) => option.id === model)?.summary}, using your own API key.
        </p>
        <p id={`${fieldId}-key-help`} className="text-xs text-zinc-500 dark:text-zinc-400">
          Your key goes straight from this browser to {key.to} and is forgotten when you leave the
          page.{" "}
          <a
            href={key.href}
            className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Get a key
          </a>
        </p>

        <div aria-live="polite">
          {status.state === "failed" && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {status.message}
            </p>
          )}
          {status.state === "done" && (
            <div className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              <p>
                {status.errorCount === 0
                  ? `${product} wrote the policy below. Review it before using it.`
                  : `${product} wrote the policy below, but it still has ${status.errorCount === 1 ? "1 problem" : `${status.errorCount} problems`} to fix by hand.`}
              </p>
              {status.notes.length > 0 && (
                <ul aria-label={`${product}'s notes`} className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                  {status.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </form>
    </section>
  );
}

const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";
const inputClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600";
