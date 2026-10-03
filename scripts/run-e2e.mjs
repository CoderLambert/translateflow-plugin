import assert from "node:assert/strict";
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
  // Discovery/help do not execute an artifact. Execution never builds, falls
  // back to dist or selects a leftover package when the requested one is absent.
  if (!args.some(arg => ["--list", "--help", "-h", "--version", "-V"].includes(arg))) {
    await requireE2EArtifact(env);
  }
  const cli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
  const result = spawnSync(process.execPath, [cli, "test", ...args], { cwd: repoRoot, env, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
