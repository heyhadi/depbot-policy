import { defineConfig } from "vitest/config";

export default defineConfig({
  // The playground has its own Vitest setup (jsdom, path aliases).
  test: { include: ["test/**/*.test.ts"] },
});
