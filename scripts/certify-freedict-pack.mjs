#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLookupKey } from "./build-tflex-core.mjs";
import { validateFreeDictPackOutput } from "./build-tflex-freedict.mjs";

const DEFAULT_TERMS = Object.freeze([
  "cache",
  "dependency",
  "commit",
  "state",
  "portable",
  "issue",
  "container",
  "repository",
  "session",
  "persistent",
  "runtime",
  "tmux",
  "kubernetes",
  "redis",
  "postgresql",
  "oauth"
]);

export async function certifyFreeDictPack({
  packDir,
  terms = DEFAULT_TERMS
}) {
  const root = resolveRequired(packDir, "packDir");
  const { manifest, index } = await validateFreeDictPackOutput({ outDir: root });
  const entriesBytes = await readFile(resolve(root, "entries.dat"));

  const results = {};
  for (const term of terms) {
    const key = normalizeLookupKey(term);
    const item = findIndexEntry(index.entries, key);
    const hits = [];
    for (const target of item?.targets || []) {
      const bytes = entriesBytes.subarray(target.offset, target.offset + target.length);
      if (bytes.byteLength !== target.length || sha256(bytes) !== target.sha256) {
        throw new Error("FreeDict certification record slice failed integrity verification");
      }
      const record = JSON.parse(bytes.toString("utf8").trim());
      if (record.lookupKey !== target.lookupKey) {
        throw new Error("FreeDict certification index/record key mismatch");
      }
      hits.push({
        headword: record.displayForm,
        matchedAlias: Boolean(target.matchedAlias),
        senses: (record.senses || []).map((sense) => ({
          partOfSpeech: sense.partOfSpeech || null,
          translations: sense.translations,
          sourceRefs: sense.sourceRefs
        }))
      });
    }
    results[term] = hits;
  }

  return {
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    fingerprint: manifest.fingerprint,
    recordCount: manifest.recordCount,
    sourceEntryCount: manifest.sourceEntryCount,
    distributionStatus: manifest.distributionStatus,
    terms: results
  };
}

function findIndexEntry(entries, key) {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const item = entries[middle];
    if (key < item.key) high = middle - 1;
    else if (key > item.key) low = middle + 1;
    else return item;
  }
  return null;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function resolveRequired(value, label) {
  if (!value) throw new Error(label + " is required");
  return resolve(value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("missing value for --" + key);
    result[key] = value;
    index += 1;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await certifyFreeDictPack({ packDir: args.pack });
  const text = JSON.stringify(result, null, 2) + "\n";
  if (args.out) await writeFile(resolve(args.out), text, "utf8");
  process.stdout.write(text);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
