import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Everything runs in the browser, so the site can be served as static files.
  output: "export",
  // GitHub Pages serves the site from /<repo>; the deploy workflow passes that path in.
  basePath: process.env.PAGES_BASE_PATH ?? "",
  turbopack: {
    // The playground imports the library straight from ../src, so Turbopack must see the repo root.
    root: path.join(import.meta.dirname, ".."),
  },
};

export default config;
