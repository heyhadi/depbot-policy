import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { reviewerFor } from "../src/index.ts";
import { reviewerScript } from "../src/rotation.ts";

const rotation = ["alice", "bob", "carol"];

describe("reviewerFor", () => {
  it("keeps the same reviewer from Monday to Sunday (UTC)", () => {
    const monday = reviewerFor(rotation, new Date("2026-10-05T00:00:00Z"));

    expect(reviewerFor(rotation, new Date("2026-10-08T12:00:00Z"))).toBe(monday);
    expect(reviewerFor(rotation, new Date("2026-10-11T23:59:59Z"))).toBe(monday);
  });

  it("moves to the next person at Monday 00:00 UTC", () => {
    const sunday = reviewerFor(rotation, new Date("2026-10-11T23:59:59Z"));
    const monday = reviewerFor(rotation, new Date("2026-10-12T00:00:00Z"));

    expect(rotation.indexOf(monday)).toBe((rotation.indexOf(sunday) + 1) % rotation.length);
  });

  it("cycles through everyone in order", () => {
    const weeks = [0, 1, 2, 3].map((week) =>
      reviewerFor(rotation, new Date(Date.UTC(2026, 9, 5 + week * 7))),
    );

    expect(new Set(weeks.slice(0, 3))).toEqual(new Set(rotation));
    expect(weeks[3]).toBe(weeks[0]);
  });

  it("always picks the only person in a rotation of one", () => {
    expect(reviewerFor(["alice"], new Date())).toBe("alice");
  });
});

// The generated workflow computes the reviewer in shell. Run that script with stand-ins for
// `date` (returns a fixed time) and `gh` (prints its arguments) and compare it with reviewerFor.
describe("reviewer script in the generated workflow", () => {
  const bin = mkdtempSync(path.join(tmpdir(), "depbot-rotation-"));
  writeFileSync(path.join(bin, "date"), '#!/bin/sh\necho "$FAKE_EPOCH"\n');
  writeFileSync(path.join(bin, "gh"), '#!/bin/sh\necho "$@"\n');
  chmodSync(path.join(bin, "date"), 0o755);
  chmodSync(path.join(bin, "gh"), 0o755);
  afterAll(() => rmSync(bin, { recursive: true }));

  it.each([
    "2026-10-05T00:00:00Z",
    "2026-10-11T23:59:59Z",
    "2026-10-12T00:00:00Z",
    "2026-12-31T18:30:00Z",
    "2027-03-01T09:00:00Z",
    "2031-07-15T00:00:00Z",
  ])("agrees with reviewerFor for a PR created at %s", (createdAt) => {
    const date = new Date(createdAt);

    const output = execFileSync("bash", ["-c", reviewerScript], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_EPOCH: String(date.getTime() / 1000),
        REVIEWERS: rotation.join(" "),
        PR_CREATED_AT: createdAt,
        PR_URL: "https://github.com/o/r/pull/1",
      },
      encoding: "utf8",
    });

    expect(output.trim()).toBe(
      `pr edit https://github.com/o/r/pull/1 --add-reviewer ${reviewerFor(rotation, date)}`,
    );
  });
});
