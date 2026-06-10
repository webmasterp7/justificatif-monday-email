import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "on-email": "src/on-email.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
  sourcemap: false,
  splitting: false,
  shims: false,
  // No external deps — everything is built-in Node.js.
  external: [],
});
