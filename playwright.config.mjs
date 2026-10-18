import { globSync } from "node:fs";
import { resolve } from "node:path";
import { testWorkers, serialE2EFiles } from "./scripts/test-concurrency.mjs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.mjs",
  timeout: 30_000,
  expect: {
    timeout: 6_000
  },
  fullyParallel: false,
  workers: testWorkers(globSync("e2e/*.spec.mjs").length),
  retries: 0,
  projects: [
    { name: "functional", testIgnore: serialE2EFiles.map(name => `**/${name}`) },
    { name: "special", testMatch: serialE2EFiles.map(name => `**/${name}`), workers: 1,
      dependencies: process.env.TF_E2E_FULL ? ["functional"] : [] }
  ],
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: resolve(process.env.TF_TEST_RUN_DIR || "test-results/e2e", "html") }]]
    : [["line"]],
  outputDir: resolve(process.env.TF_TEST_RUN_DIR || "test-results/e2e", "artifacts"),
  use: {
    trace: "retain-on-failure"
  }
});
