#!/usr/bin/env node
import { rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTflexCore } from "./build-tflex-core.mjs";
import { compileTflexTechnical } from "./build-tflex-technical.mjs";

export async function buildReleaseLexicon({
  englishPath,
  chinesePath,
  outRoot = "assets/lexicon"
}) {
  if (!englishPath || !chinesePath) {
    throw new Error("englishPath and chinesePath are required locked source artifacts");
  }

  const root = resolve(outRoot);
  const coreOut = join(root, "core");
  const technicalOut = join(root, "technical");
  await rm(coreOut, { recursive: true, force: true });
  await rm(technicalOut, { recursive: true, force: true });

  const core = await compileTflexCore({
    englishPath,
    chinesePath,
    sourceLockPath: resolve("lexicon/source-locks/core-semantic-pwn3-cow.json"),
    outDir: coreOut
  });
  const technical = await compileTflexTechnical({
    extractPath: resolve("lexicon/sources/wikidata-tech-entities.json"),
    sourceLockPath: resolve("lexicon/source-locks/technical-wikidata.json"),
    outDir: technicalOut
  });

  return {
    outputRoot: root,
    core: summarize(core),
    technical: summarize(technical),
    totalBytes: await directoryBytes(root)
  };
}

function summarize(result) {
  return {
    packId: result.manifest.packId,
    packVersion: result.manifest.packVersion,
    fingerprint: result.manifest.fingerprint,
    recordCount: result.manifest.recordCount
  };
}

async function directoryBytes(path) {
  const { readdir } = await import("node:fs/promises");
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(child);
    else total += (await stat(child)).size;
  }
  return total;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error("missing value for --" + key);
    result[key] = value;
    i += 1;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReleaseLexicon({
    englishPath: args.eng,
    chinesePath: args.cmn,
    outRoot: args.out || "assets/lexicon"
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
