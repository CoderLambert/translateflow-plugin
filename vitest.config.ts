import { defineConfig } from "vitest/config";
import { globSync } from "node:fs";
import { testWorkers } from "./scripts/test-concurrency.mjs";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    exclude: ["tests/*.test.mjs", "e2e/**", "node_modules/**", ".wxt/**", ".output/**", "dist/**"],
    environment: "node",
    globals: false,
    maxWorkers: testWorkers(globSync("tests/unit/**/*.test.{ts,tsx}").length),
    passWithNoTests: false
  }
});
