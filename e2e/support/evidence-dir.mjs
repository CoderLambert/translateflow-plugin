import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultEvidenceDir(specUrl) {
  return resolve(process.env.TF_TEST_RUN_DIR || `test-results/direct-${process.pid}`, "evidence", basename(fileURLToPath(specUrl), ".spec.mjs"));
}
