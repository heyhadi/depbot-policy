import { describe, expect, it } from "vitest";
import { readSharedPolicy, shareUrl } from "@/lib/share";

describe("share links", () => {
  it("round-trips a policy through the URL hash", () => {
    const source = "version: 1\necosystems: [{ type: npm, directory: / }]\n";

    const url = new URL(shareUrl("https://example.com/playground/", source));

    expect(url.pathname).toBe("/playground/");
    expect(readSharedPolicy(url.hash)).toBe(source);
  });

  it("keeps non-ASCII text intact", () => {
    const source = "block:\n  - name: react\n    reason: React 19 への移行まで固定 ✅\n";

    expect(readSharedPolicy(new URL(shareUrl("https://example.com/", source)).hash)).toBe(source);
  });

  it("replaces an existing hash", () => {
    const url = shareUrl("https://example.com/#policy=old&x=1", "new");

    expect(readSharedPolicy(new URL(url).hash)).toBe("new");
  });

  it.each([
    ["no hash", ""],
    ["another key", "#tab=1"],
    ["invalid base64", "#policy=***"],
    ["invalid UTF-8", `#policy=${btoa("\xff\xfe")}`],
  ])("returns undefined for %s", (_, hash) => {
    expect(readSharedPolicy(hash)).toBeUndefined();
  });
});
