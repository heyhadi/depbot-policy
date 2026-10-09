import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": import.meta.dirname,
      "depbot-policy": path.join(import.meta.dirname, "../src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
