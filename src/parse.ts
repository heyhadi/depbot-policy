import { parseDocument } from "yaml";
import type { z } from "zod";
import { policySchema, type Policy } from "./schema.js";

export interface PolicyError {
  /** Dotted path to the offending value, e.g. `ecosystems[0].type`. Empty for document-level errors. */
  path: string;
  message: string;
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
  const doc = parseDocument(source);
  if (doc.errors.length > 0) {
    return {
      ok: false,
      errors: doc.errors.map((error) => ({ path: "", message: error.message })),
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
    return { ok: false, errors: result.error.issues.flatMap(toPolicyErrors) };
  }
  return { ok: true, policy: result.data };
}

function toPolicyErrors(issue: z.core.$ZodIssue): PolicyError[] {
  // Zod reports all unknown keys of an object as one issue on the object; point at each key instead.
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      path: formatPath([...issue.path, key]),
      message: "Unknown key",
    }));
  }
  return [{ path: formatPath(issue.path), message: issue.message }];
}

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc === "" ? String(segment) : `${acc}.${String(segment)}`;
  }, "");
}
