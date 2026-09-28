#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseLexicon } from "./build-release-lexicon.mjs";
import { certifyLexicalRelease } from "./certify-lexical-release.mjs";

const LOCK_PATH = resolve("lexicon/source-locks/core-semantic-pwn3-cow.json");
const SOURCE_ROOT = resolve(".release-sources/omw-data");
const SOURCE_PATHS = Object.freeze({
  "pwn-3.0": "wns/eng/wn-data-eng.tab",
  "chinese-open-wordnet": "wns/cow/wn-data-cmn.tab"
});

export async function setupLexicon({
  lockPath = LOCK_PATH,
  sourceRoot = SOURCE_ROOT,
  outRoot = "assets/lexicon",
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch API is required");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const sources = resolveLockedSources(lock);

  const downloaded = {};
  for (const source of sources) {
    const relativePath = SOURCE_PATHS[source.id];
    const targetPath = resolve(sourceRoot, relativePath);
    downloaded[source.id] = await ensureLockedSource({
      source,
      targetPath,
      fetchImpl
    });
  }

  const build = await buildReleaseLexicon({
    englishPath: downloaded["pwn-3.0"],
    chinesePath: downloaded["chinese-open-wordnet"],
    outRoot
  });
  const certification = await certifyLexicalRelease({ root: resolve(outRoot) });
  if (certification.failures.length) {
    throw new Error("Lexicon certification failed: " + certification.failures.join("; "));
  }

  return {
    sourceRevision: lockedRevision(lock),
    outputRoot: build.outputRoot,
    totalBytes: build.totalBytes,
    core: build.core,
    technical: build.technical,
    certification: {
      assets: certification.assets,
      cache: certification.cache
    }
  };
}

export function resolveLockedSources(lock) {
  const sources = Array.isArray(lock?.sources) ? lock.sources : [];
  const resolved = Object.keys(SOURCE_PATHS).map((id) => {
    const source = sources.find((item) => item?.id === id);
    if (!source?.data?.url || !/^[a-f0-9]{64}$/i.test(source?.data?.sha256 || "")) {
      throw new Error("Locked lexical source metadata is missing or invalid: " + id);
    }
    const url = new URL(source.data.url);
    if (url.protocol !== "https:") throw new Error("Locked lexical source must use HTTPS: " + id);
    return {
      id,
      url: url.href,
      sha256: source.data.sha256.toLowerCase()
    };
  });
  return resolved;
}

export async function ensureLockedSource({ source, targetPath, fetchImpl }) {
  try {
    const existing = new Uint8Array(await readFile(targetPath));
    verifySourceBytes(existing, source);
    return targetPath;
  } catch (error) {
    if (error?.code !== "ENOENT" && !/checksum mismatch/.test(error?.message || "")) throw error;
  }

  const response = await fetchImpl(source.url, { redirect: "follow" });
  if (!response?.ok) throw new Error(`Failed to download locked lexical source ${source.id}: HTTP ${response?.status || "unknown"}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifySourceBytes(bytes, source);

  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = targetPath + ".tmp";
  await rm(tempPath, { force: true });
  await writeFile(tempPath, bytes);
  await rename(tempPath, targetPath);
  return targetPath;
}

export function verifySourceBytes(bytes, source) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== source.sha256) {
    throw new Error(`Locked lexical source checksum mismatch for ${source.id}: expected ${source.sha256}, got ${actual}`);
  }
  return actual;
}

function lockedRevision(lock) {
  const provenance = String(lock?.sources?.[0]?.provenance || "");
  const match = provenance.match(/omwn\/omw-data@([a-f0-9]{40})/i);
  return match?.[1] || "";
}

async function main() {
  const report = await setupLexicon();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
