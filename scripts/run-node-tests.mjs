import { globSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { testWorkers } from "./test-concurrency.mjs";

const patterns = process.argv.slice(2);
const files = [...new Set((patterns.length ? patterns : ["tests/*.test.mjs"]).flatMap(pattern => {
  const matches = globSync(pattern);
  if (!matches.length) throw new Error(`No Node test files matched: ${pattern}`);
  return matches;
}))].sort();
if (!files.length) throw new Error("No Node test files matched");
const result = spawnSync(process.execPath, ["--test", `--test-concurrency=${testWorkers(files.length)}`, ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
