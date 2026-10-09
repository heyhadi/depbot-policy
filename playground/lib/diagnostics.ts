import type { Diagnostic } from "@codemirror/lint";
import type { PolicyError } from "depbot-policy";

/**
 * Converts policy errors into editor diagnostics.
 *
 * Errors can lag one keystroke behind the editor (parsing uses a deferred value), so ranges are
 * clamped to the current document. Errors with no location appear only in the error list.
 */
export function toDiagnostics(errors: readonly PolicyError[], docLength: number): Diagnostic[] {
  return errors.flatMap((error) => {
    if (error.location === undefined) return [];
    const from = Math.min(error.location.start, docLength);
    const to = Math.min(Math.max(error.location.end, from), docLength);
    return [{ from, to, severity: "error", message: describeError(error), source: "depbot-policy" }];
  });
}

export function describeError(error: PolicyError): string {
  return error.path ? `${error.path}: ${error.message}` : error.message;
}
