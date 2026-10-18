import { test } from "node:test";
import assert from "node:assert/strict";
import { testWorkers } from "../scripts/test-concurrency.mjs";

test("worker budgets respect CPUs, files, local maximum and explicit CI budget", () => {
  assert.equal(testWorkers(30, {}, 32), 10);
  assert.equal(testWorkers(30, { CI: "true", TF_TEST_WORKERS: "2" }, 32), 2);
  assert.equal(testWorkers(30, { CI: "true" }, 32), 2);
  assert.equal(testWorkers(30, { TF_TEST_WORKERS: "5" }, 4), 4);
  assert.equal(testWorkers(3, { TF_TEST_WORKERS: "10" }, 32), 3);
  assert.equal(testWorkers(30, { TF_TEST_WORKERS: "50" }, 32), 10);
  for (const value of ["0", "-1", "NaN", "2.5", ""]) {
    assert.throws(() => testWorkers(3, { TF_TEST_WORKERS: value }, 4), /positive integer/);
  }
});

test("Playwright partitions every spec once, serializes specials and never retries", async () => {
  const { globSync } = await import("node:fs");
  const previous = process.env.TF_E2E_FULL;
  process.env.TF_E2E_FULL = "1";
  const { default: config } = await import("../playwright.config.mjs");
  if (previous === undefined) delete process.env.TF_E2E_FULL; else process.env.TF_E2E_FULL = previous;
  const { serialE2EFiles } = await import("../scripts/test-concurrency.mjs");
  const [functional, special] = config.projects;
  assert.equal(config.fullyParallel, false);
  assert.equal(config.retries, 0);
  assert.equal(special.workers, 1);
  assert.deepEqual(special.dependencies, ["functional"]);
  const all = globSync("e2e/*.spec.mjs");
  const matches = all.filter(file => serialE2EFiles.some(name => file.endsWith(`/${name}`)));
  assert.equal(matches.length, serialE2EFiles.length);
  assert.deepEqual(special.testMatch, functional.testIgnore);
  const { defaultEvidenceDir } = await import("../e2e/support/evidence-dir.mjs");
  assert.notEqual(defaultEvidenceDir(new URL("../e2e/rich-mdict-product.spec.mjs", import.meta.url)),
    defaultEvidenceDir(new URL("../e2e/rich-mdict-real-corpus.spec.mjs", import.meta.url)));
});
