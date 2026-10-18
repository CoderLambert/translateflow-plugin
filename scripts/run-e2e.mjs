import assert from "node:assert/strict";
import { globSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { testWorkers, serialE2EFiles } from "./test-concurrency.mjs";
import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function e2eEnvironment(env = process.env) {
  const artifact = env.TF_E2E_ARTIFACT ?? ".output/chrome-mv3";
  assert(artifact.trim(), "TF_E2E_ARTIFACT must explicitly name an artifact");
  return { ...env, TF_E2E_ARTIFACT: artifact, TF_I18N_ARTIFACT: env.TF_I18N_ARTIFACT ?? artifact };
}

export async function requireE2EArtifact(env, root = repoRoot) {
  const artifact = resolve(root, env.TF_E2E_ARTIFACT);
  await access(join(artifact, "manifest.json"));
  return artifact;
}

async function main() {
  const args = process.argv.slice(2);
  const env = e2eEnvironment();
  env.TF_TEST_RUN_DIR ||= resolve(repoRoot, "test-results", `run-${Date.now()}-${randomUUID()}`);
  const discovery = args.some(arg => ["--list", "--help", "-h", "--version", "-V"].includes(arg));
  if (!discovery) await requireE2EArtifact(env);
  const cli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
  const files = globSync("e2e/*.spec.mjs", { cwd: repoRoot }).sort();
  const specialOnly = args.includes("--special");
  const forwarded = args.filter(arg => arg !== "--special");
  const focused = forwarded.some(arg => !arg.startsWith("-") && files.some(file => file.includes(arg)));
  delete env.TF_E2E_FULL;
  if (!specialOnly && !focused) env.TF_E2E_FULL = "1";
  const serialSelection = specialOnly || (focused && files.some(file => serialE2EFiles.some(name => file.endsWith(`/${name}`)) && forwarded.some(arg => file.includes(arg))));
  const workers = serialSelection ? 1 : testWorkers(files.length, env);
  const result = spawnSync(process.execPath, [cli, "test", ...forwarded,
    ...(specialOnly ? ["--project=special"] : []), `--workers=${workers}`],
    { cwd: repoRoot, env, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
