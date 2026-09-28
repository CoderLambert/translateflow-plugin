#!/usr/bin/env node
import { createHash, webcrypto } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpfsTflexReader } from "../src/background/lexical/opfs-tflex-reader.js";

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
  const manifestBytes = new Uint8Array(await readFile(resolve(root, "manifest.json")));
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const snapshot = {
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    fingerprint: manifest.fingerprint,
    files: [
      {
        role: "manifest",
        path: "manifest.json",
        size: manifestBytes.byteLength,
        sha256: sha256(manifestBytes)
      },
      ...manifest.files
    ]
  };
  const store = createFsStore(root);
  const reader = createOpfsTflexReader({
    store,
    snapshot,
    cryptoProvider: webcrypto
  });
  const results = {};
  for (const term of terms) {
    const hits = await reader.lookupAll(term);
    results[term] = hits.map((hit) => ({
      headword: hit.record.displayForm,
      matchedAlias: hit.matchedAlias,
      senses: (hit.record.senses || []).map((sense) => ({
        partOfSpeech: sense.partOfSpeech || null,
        translations: sense.translations,
        sourceRefs: sense.sourceRefs
      }))
    }));
  }
  return {
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    fingerprint: manifest.fingerprint,
    recordCount: manifest.recordCount,
    sourceEntryCount: manifest.sourceEntryCount,
    terms: results
  };
}

function createFsStore(root) {
  return {
    async readFile(_packId, _version, path) {
      return new Uint8Array(await readFile(resolve(root, path)));
    },
    async readFileSlice(_packId, _version, path, offset, length) {
      const bytes = await readFile(resolve(root, path));
      return new Uint8Array(bytes.subarray(offset, offset + length));
    }
  };
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
