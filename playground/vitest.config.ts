import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Exact matches, so "depbot-policy" doesn't also catch "depbot-policy/describe".
    alias: [
      { find: /^@\//, replacement: `${import.meta.dirname}/` },
      { find: /^depbot-policy$/, replacement: path.join(import.meta.dirname, "../src/index.ts") },
      {
        find: /^depbot-policy\/describe$/,
        replacement: path.join(import.meta.dirname, "../src/describe.ts"),
      },
      {
        find: /^depbot-policy\/describe-models$/,
        replacement: path.join(import.meta.dirname, "../src/describe-models.ts"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
