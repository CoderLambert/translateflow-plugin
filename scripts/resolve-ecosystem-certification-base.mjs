#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCOPE_PATH = "docs/DICTIONARY_ECOSYSTEM_V2_RELEASE_SCOPE.json";
const FULL_SHA = /^[0-9a-f]{40}$/u;

export function resolveEcosystemCertificationBase({
  cwd = ROOT,
  eventName,
  eventBaseSha,
  manualBaseSha
} = {}) {
  const git = (...args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 1024 * 1024
  }).trim();
  const headSha = git("rev-parse", "HEAD");
  const assertAncestorCommit = (sha, label) => {
    if (typeof sha !== "string" || !FULL_SHA.test(sha) || sha === "0".repeat(40)) {
      throw new Error(`${label} must be a nonzero full lowercase commit SHA`);
    }
    try {
      if (git("cat-file", "-t", sha) !== "commit") throw new Error("not a commit");
      git("merge-base", "--is-ancestor", sha, headSha);
    } catch {
      throw new Error(`${label} must be an available commit ancestor of HEAD`);
    }
  };
  assertAncestorCommit(headSha, "checked-out HEAD");

  if (eventName === "workflow_dispatch") {
    assertAncestorCommit(manualBaseSha, "explicit manual base SHA");
    return { eventName, eventBaseSha: null, headSha, frozenBaseSha: manualBaseSha };
  }
  if (eventName !== "pull_request" && eventName !== "push") {
    throw new Error("unsupported certification event; no implicit base fallback is allowed");
  }
  assertAncestorCommit(eventBaseSha, "event base SHA");
  let scope;
  try {
    // The event's trusted base, never the PR's current scope, owns this identity.
    scope = JSON.parse(git("show", `${eventBaseSha}:${SCOPE_PATH}`));
  } catch {
    throw new Error("event base commit must contain a readable frozen ecosystem scope");
  }
  if (scope?.schemaVersion !== 1 || scope?.manifest !== "dictionary-ecosystem-v2-release-scope") {
    throw new Error("event base commit has an invalid ecosystem scope identity");
  }
  assertAncestorCommit(scope.mainBaseSha, "frozen scope base SHA");
  return { eventName, eventBaseSha, headSha, frozenBaseSha: scope.mainBaseSha };
}

async function main() {
  const result = resolveEcosystemCertificationBase({
    eventName: process.env.GITHUB_EVENT_NAME,
    eventBaseSha: process.env.ECOSYSTEM_EVENT_BASE_SHA,
    manualBaseSha: process.env.ECOSYSTEM_MANUAL_BASE_SHA
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required for the resolved base");
  await appendFile(process.env.GITHUB_OUTPUT, `base_sha=${result.frozenBaseSha}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
