import { LineCounter, parseDocument } from "yaml";
import type { z } from "zod";
import { locate, type Span } from "./locate.ts";
import { policySchema, type Policy } from "./schema.ts";

export interface PolicyError {
  /** Dotted path to the offending value, e.g. `ecosystems[0].type`. Empty for document-level errors. */
  path: string;
  message: string;
  /** Where the error is in the source. Absent when there's nothing to point at, e.g. an empty file. */
  location?: SourceLocation;
}

/** A span in the policy source. `line` and `column` are 1-based and describe `start`. */
export interface SourceLocation {
  start: number;
  end: number;
  line: number;
  column: number;
}

export type ParseResult =
  | { ok: true; policy: Policy }
  | { ok: false; errors: PolicyError[] };

/**
 * Parses and validates a policy from YAML source.
 *
 * Pure: no file system or network access, so it runs in the browser as well as Node.
 * Returns every error found rather than stopping at the first one.
 */
export function parsePolicy(source: string): ParseResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });
  const withLocation = (error: PolicyError, span: Span | undefined): PolicyError => {
    if (span === undefined) return error;
    const { line, col } = lineCounter.linePos(span[0]);
    return { ...error, location: { start: span[0], end: span[1], line, column: col } };
  };

  if (doc.errors.length > 0) {
    return {
      ok: false,
      errors: doc.errors.map((error) =>
        withLocation({ path: "", message: error.message }, error.pos),
      ),
    };
  }

  if (doc.contents === null) {
    return { ok: false, errors: [{ path: "", message: "Policy file is empty" }] };
  }

  const result = policySchema.safeParse(doc.toJS(), {
    // Zod's default for a missing field is "expected string, received undefined".
    error: (issue) =>
      issue.code === "invalid_type" && issue.input === undefined ? "Required" : undefined,
  });
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues
        .flatMap(toPathErrors)
        .map(({ path, message }) =>
          withLocation({ path: formatPath(path), message }, locate(source, doc, path)),
        ),
    };
  }
  return { ok: true, policy: result.data };
}

interface PathError {
  path: PropertyKey[];
  message: string;
}

function toPathErrors(issue: z.core.$ZodIssue): PathError[] {
  // Zod reports all unknown keys of an object as one issue on the object; point at each key instead.
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({ path: [...issue.path, key], message: "Unknown key" }));
  }
  return [{ path: issue.path, message: issue.message }];
}

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc === "" ? String(segment) : `${acc}.${String(segment)}`;
  }, "");
}
