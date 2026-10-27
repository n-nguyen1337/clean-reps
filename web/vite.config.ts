/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  base: "./", // works under a GitHub Pages subpath
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Rules are read straight from the Python package (../cleanreps/rules).
  server: { fs: { allow: [".."] } },
  test: { include: ["src/**/*.test.ts"], setupFiles: ["fake-indexeddb/auto"] },
});
