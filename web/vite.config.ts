/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "./", // works under a GitHub Pages subpath
  // Rules are read straight from the Python package (../cleanreps/rules).
  server: { fs: { allow: [".."] } },
  test: { include: ["src/**/*.test.ts"] },
});
