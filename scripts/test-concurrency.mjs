import { availableParallelism } from "node:os";

export function testWorkers(fileCount, env = process.env, cpus = availableParallelism()) {
  const raw = env.TF_TEST_WORKERS ?? (env.CI ? "2" : "10");
  if (!/^[1-9]\d*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) {
    throw new Error("TF_TEST_WORKERS must be a positive integer");
  }
  return Math.max(1, Math.min(10, Number(raw), cpus, fileCount));
}

// Resource/latency measurements must never compete with the functional suite.
export const serialE2EFiles = [
  "large-mdd-opfs-import.spec.mjs", "dictionary-ecosystem-v2-release.spec.mjs",
  "selection-rich-lookup-cancel.spec.mjs", "wxt-injection-samples.spec.mjs",
  "wxt-upgrade.spec.mjs", "user-dictionary-upgrade.spec.mjs", "design-freeze-poc.spec.mjs", "reading-loop-release-a.spec.mjs"
];
