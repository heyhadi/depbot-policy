import type { PolicyError } from "depbot-policy";

interface ErrorListProps {
  errors: readonly PolicyError[];
  onSelect: (error: PolicyError) => void;
}

export function ErrorList({ errors, onSelect }: ErrorListProps) {
  if (errors.length === 0) return null;

  return (
    <ul aria-label="Errors" className="divide-y divide-red-100 dark:divide-red-950">
      {inSourceOrder(errors).map((error, index) => {
        const content = (
          <>
            <span className="w-14 shrink-0 font-mono text-xs text-red-700/80 dark:text-red-300/70">
              {error.location ? `${error.location.line}:${error.location.column}` : "file"}
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {error.path && (
                <code className="mr-2 font-mono text-xs text-red-800 dark:text-red-200">
                  {error.path}
                </code>
              )}
              <span>{error.message}</span>
            </span>
          </>
        );
        return (
          <li key={`${error.path}-${index}`}>
            {error.location ? (
              <button
                type="button"
                onClick={() => onSelect(error)}
                className="flex w-full gap-3 px-4 py-2 text-left text-sm text-red-900 hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none dark:text-red-100 dark:hover:bg-red-950/50 dark:focus-visible:bg-red-950/50"
              >
                {content}
              </button>
            ) : (
              <div className="flex gap-3 px-4 py-2 text-sm text-red-900 dark:text-red-100">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** File-level errors first, then in the order they appear in the source. */
function inSourceOrder(errors: readonly PolicyError[]): PolicyError[] {
  return errors.toSorted(
    (a, b) => (a.location?.start ?? -1) - (b.location?.start ?? -1),
  );
}
