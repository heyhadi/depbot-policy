import type { PolicyError } from "depbot-policy";
import { describe, expect, it } from "vitest";
import { describeError, toDiagnostics } from "@/lib/diagnostics";

const at = (start: number, end: number): PolicyError["location"] => ({
  start,
  end,
  line: 1,
  column: start + 1,
});

describe("toDiagnostics", () => {
  it("maps located errors to editor diagnostics", () => {
    const errors: PolicyError[] = [{ path: "version", message: "Invalid", location: at(0, 10) }];

    expect(toDiagnostics(errors, 100)).toEqual([
      { from: 0, to: 10, severity: "error", message: "version: Invalid", source: "depbot-policy" },
    ]);
  });

  it("skips errors without a location", () => {
    expect(toDiagnostics([{ path: "", message: "Policy file is empty" }], 0)).toEqual([]);
  });

  it("clamps ranges to the current document", () => {
    const [diagnostic] = toDiagnostics([{ path: "a", message: "m", location: at(8, 20) }], 5);

    expect(diagnostic).toMatchObject({ from: 5, to: 5 });
  });
});

describe("describeError", () => {
  it("prefixes the path when there is one", () => {
    expect(describeError({ path: "a.b", message: "m" })).toBe("a.b: m");
    expect(describeError({ path: "", message: "m" })).toBe("m");
  });
});
