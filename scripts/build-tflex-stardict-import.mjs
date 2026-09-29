#!/usr/bin/env node
import { createHash, webcrypto } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TFLEX_COMPILER_VERSION,
  TFLEX_FORMAT_VERSION,
  TFLEX_NORMALIZATION_VERSION,
  TFLEX_READER_MIN_VERSION,
  normalizeExactLookupKey,
  normalizeLookupKey,
  stableStringify
} from "./build-tflex-core.mjs";
import { TFLEX_OPFS_INDEXED_PROFILE } from "./build-tflex-freedict.mjs";
import { projectStarDictPoc } from "./project-stardict-import.mjs";
import { buildStarDictLocalTflexFromProjection } from "../src/background/packs/importers/stardict-local-adapter.js";
import {
  STARDICT_BILINGUAL_PROFILE,
  STARDICT_LOCAL_IMPORT_LICENSE_ID,
  buildStarDictTflexRecords,
  validateStarDictImportRecipe
} from "../src/background/packs/importers/stardict-semantic.js";
import { validateTflexRecord } from "../src/background/lexical/tflex-integrity.js";
import { isSafePackIdentifier } from "../src/shared/pack-manager.js";

export {
  STARDICT_BILINGUAL_PROFILE,
  STARDICT_LOCAL_IMPORT_LICENSE_ID,
  buildStarDictTflexRecords,
  validateStarDictImportRecipe
};

export async function compileTflexStarDictImport({
  ifoPath,
  idxPath,
  dictPath,
  synPath,
  recipePath,
  outDir,
  reportPath
} = {}) {
  const recipe = validateStarDictImportRecipe(JSON.parse(
    await readFile(requiredPath(recipePath, "recipePath"), "utf8")
  ));
  const projection = await projectStarDictPoc({
    ifoPath: requiredPath(ifoPath, "ifoPath"),
    idxPath: requiredPath(idxPath, "idxPath"),
    dictPath: requiredPath(dictPath, "dictPath"),
    synPath,
    sourceId: recipe.dictionary.sourceId,
    sourceVersion: recipe.dictionary.sourceVersion
  });

  const built = await buildStarDictLocalTflexFromProjection({
    projection,
    recipe,
    cryptoProvider: webcrypto
  });

  const output = requiredPath(outDir, "outDir");
  await prepareOutputDir(output);
  await Promise.all(
    Object.entries(built.files).map(([name, bytes]) =>
      writeFile(resolve(output, name), bytes)
    )
  );

  const manifest = built.manifest;
  const records = built.records;
  const index = built.index;
  const validation = await validateStarDictTflexPackOutput({ outDir: output });
  const report = {
    schemaVersion: 1,
    format: "stardict-tflex-import-poc-report",
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    semanticProfile: manifest.semanticProfile,
    dictionary: projection.dictionary,
    importInput: {
      dictFileBytes: projection.report.input.dictFileBytes,
      dictBytes: projection.report.input.dictBytes,
      dictCompression: projection.report.input.dictCompression,
      dictzip: projection.report.input.dictzip
    },
    sourceEntryCount: projection.entries.length,
    sourceAliasCount: manifest.sourceAliasCount,
    recordCount: records.length,
    files: manifest.files,
    fingerprint: manifest.fingerprint,
    distributionStatus: manifest.distributionStatus,
    policy: {
      localUseOnly: true,
      redistributionRightsVerified: false,
      semanticMapping: "explicit-recipe-only",
      runtimeRegistration: "not-connected",
      importedMarkup: "rejected-upstream"
    },
    validation: {
      validatedRecords: validation.validatedRecords
    }
  };
  if (reportPath) {
    await writeFile(resolve(reportPath), JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  return { manifest, records, index, report, projection };
}

export async function validateStarDictTflexPackOutput({ outDir } = {}) {
  const root = resolve(requiredPath(outDir, "outDir"));
  const [manifestText, indexText, entriesBytes] = await Promise.all([
    readFile(resolve(root, "manifest.json"), "utf8"),
    readFile(resolve(root, "index.dat"), "utf8"),
    readFile(resolve(root, "entries.dat"))
  ]);
  const manifest = JSON.parse(manifestText);
  const index = JSON.parse(indexText);

  if (
    manifest.format !== "tflex" ||
    manifest.formatVersion !== TFLEX_FORMAT_VERSION ||
    manifest.readerMinVersion !== TFLEX_READER_MIN_VERSION ||
    manifest.normalizationVersion !== TFLEX_NORMALIZATION_VERSION ||
    manifest.profile !== TFLEX_OPFS_INDEXED_PROFILE ||
    manifest.distributionStatus !== "user-import-only" ||
    manifest.semanticProfile !== STARDICT_BILINGUAL_PROFILE ||
    manifest.sourceLanguage !== "en" ||
    manifest.targetLanguage !== "zh-CN" ||
    !isSafePackIdentifier(manifest.packId) ||
    !String(manifest.packId).startsWith("local-") ||
    !isSafePackIdentifier(manifest.packVersion, 120)
  ) {
    throw new Error("StarDict local TFLex manifest is incompatible");
  }
  if (
    manifest.license?.id !== STARDICT_LOCAL_IMPORT_LICENSE_ID ||
    !Array.isArray(manifest.sources) ||
    manifest.sources.length !== 1 ||
    manifest.sources[0]?.license?.id !== STARDICT_LOCAL_IMPORT_LICENSE_ID
  ) {
    throw new Error("StarDict local TFLex source/license boundary is invalid");
  }

  const descriptors = new Map((manifest.files || []).map((file) => [file.path, file]));
  if (descriptors.size !== 2) throw new Error("StarDict local TFLex must contain exactly index.dat and entries.dat descriptors");
  verifyDescriptor(descriptors.get("index.dat"), Buffer.from(indexText), "lookup-index");
  verifyDescriptor(descriptors.get("entries.dat"), entriesBytes, "lexical-data");

  if (
    index.format !== "tflex-index" ||
    index.formatVersion !== TFLEX_FORMAT_VERSION ||
    index.normalizationVersion !== TFLEX_NORMALIZATION_VERSION ||
    index.recordCount !== manifest.recordCount ||
    index.entriesBytes !== entriesBytes.byteLength ||
    !Array.isArray(index.entries) ||
    !index.entries.length
  ) {
    throw new Error("StarDict local TFLex index is malformed");
  }

  let previous = "";
  const canonical = new Set();
  let validatedRecords = 0;
  for (const item of index.entries) {
    if (
      !item?.key ||
      normalizeLookupKey(item.key) !== item.key ||
      (previous && previous >= item.key) ||
      !Array.isArray(item.targets) ||
      !item.targets.length
    ) {
      throw new Error("StarDict local TFLex index keys/targets are malformed");
    }
    previous = item.key;

    for (const target of item.targets) {
      validateIndexTarget(target, entriesBytes.byteLength);
      const bytes = entriesBytes.subarray(target.offset, target.offset + target.length);
      if (sha256Bytes(bytes) !== target.sha256) {
        throw new Error("StarDict local TFLex record hash mismatch");
      }
      const record = JSON.parse(bytes.toString("utf8").trim());
      validateTflexRecord(record, manifest.packId, "entries.dat");
      if (record.lookupKey !== target.lookupKey) {
        throw new Error("StarDict local TFLex index/record key mismatch");
      }
      if (target.matchedAlias) {
        if (
          item.key === target.lookupKey ||
          !Array.isArray(record.aliases) ||
          !record.aliases.some((alias) => normalizeLookupKey(alias) === item.key)
        ) {
          throw new Error("StarDict local TFLex alias index/record mismatch");
        }
      } else if (item.key !== target.lookupKey) {
        throw new Error("StarDict local TFLex canonical index target mismatch");
      }
      if (canonical.has(target.lookupKey)) continue;
      canonical.add(target.lookupKey);
      validatedRecords += 1;
    }
  }
  if (validatedRecords !== manifest.recordCount) {
    throw new Error("StarDict local TFLex recordCount mismatch");
  }

  const fingerprintPayload = makeStarDictFingerprintPayload({
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    semanticProfile: manifest.semanticProfile,
    sources: manifest.sources,
    files: manifest.files
  });
  const actualFingerprint = "sha256:" + sha256Text(stableStringify(fingerprintPayload));
  if (actualFingerprint !== manifest.fingerprint) {
    throw new Error("StarDict local TFLex fingerprint mismatch");
  }
  return { manifest, index, validatedRecords };
}

export async function createStarDictTflexPocReader({ packDir } = {}) {
  const root = resolve(requiredPath(packDir, "packDir"));
  const { manifest, index } = await validateStarDictTflexPackOutput({ outDir: root });
  const entriesBytes = await readFile(resolve(root, "entries.dat"));

  async function lookupAll(text) {
    const key = normalizeLookupKey(text);
    if (!key) return [];
    const exactKey = normalizeExactLookupKey(text);
    const item = findIndexEntry(index.entries, key);
    if (!item) return [];
    const hits = [];
    for (const target of item.targets) {
      const bytes = entriesBytes.subarray(target.offset, target.offset + target.length);
      if (bytes.byteLength !== target.length || sha256Bytes(bytes) !== target.sha256) {
        throw new Error("StarDict local TFLex query slice failed integrity verification");
      }
      const record = JSON.parse(bytes.toString("utf8").trim());
      hits.push({
        record,
        exactCaseMatch: Array.isArray(item.exactLookupKeys) &&
          item.exactLookupKeys.includes(exactKey),
        matchedAlias: target.matchedAlias,
        aliasKey: target.matchedAlias ? item.key : "",
        pack: {
          packId: manifest.packId,
          packVersion: manifest.packVersion,
          fingerprint: manifest.fingerprint,
          sourceLanguage: manifest.sourceLanguage,
          targetLanguage: manifest.targetLanguage
        }
      });
    }
    return hits;
  }

  return Object.freeze({
    lookupAll,
    async lookup(text) {
      return (await lookupAll(text))[0] || null;
    },
    async inspect() {
      return {
        packId: manifest.packId,
        packVersion: manifest.packVersion,
        fingerprint: manifest.fingerprint,
        sourceLanguage: manifest.sourceLanguage,
        targetLanguage: manifest.targetLanguage,
        recordCount: manifest.recordCount,
        sources: manifest.sources.map((source) => ({
          id: source.id,
          version: source.version,
          licenseId: source.license?.id || ""
        }))
      };
    },
    stats() {
      return {
        profile: manifest.profile,
        recordsMaterialized: manifest.recordCount,
        productionRuntimeConnected: false
      };
    }
  });
}

export function makeStarDictFingerprintPayload({
  packId,
  packVersion,
  semanticProfile,
  sources,
  files
}) {
  return {
    formatVersion: TFLEX_FORMAT_VERSION,
    normalizationVersion: TFLEX_NORMALIZATION_VERSION,
    packId,
    packVersion,
    profile: TFLEX_OPFS_INDEXED_PROFILE,
    distributionStatus: "user-import-only",
    semanticProfile,
    sources: [...sources]
      .sort((a, b) => compareText(a.id, b.id))
      .map((source) => ({
        id: source.id,
        version: source.version,
        provenance: source.provenance,
        semanticProfile: source.semanticProfile,
        licenseId: source.license?.id
      })),
    files: [...files]
      .sort(compareFile)
      .map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }))
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

function validateIndexTarget(target, entriesBytes) {
  if (
    !target ||
    typeof target.lookupKey !== "string" ||
    normalizeLookupKey(target.lookupKey) !== target.lookupKey ||
    !Number.isSafeInteger(target.offset) ||
    target.offset < 0 ||
    !Number.isSafeInteger(target.length) ||
    target.length <= 0 ||
    target.offset + target.length > entriesBytes ||
    !/^[a-f0-9]{64}$/.test(target.sha256 || "") ||
    typeof target.matchedAlias !== "boolean"
  ) {
    throw new Error("StarDict local TFLex index target is malformed");
  }
}

function verifyDescriptor(descriptorValue, bytes, role) {
  if (
    descriptorValue?.role !== role ||
    descriptorValue.size !== bytes.byteLength ||
    descriptorValue.sha256 !== sha256Bytes(bytes)
  ) {
    throw new Error("StarDict local TFLex descriptor mismatch: " + role);
  }
}

async function prepareOutputDir(path) {
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length) throw new Error("output directory must be empty");
}

function requiredPath(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(label + " is required");
  return text;
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(text) {
  return sha256Bytes(Buffer.from(text, "utf8"));
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareFile(a, b) {
  return compareText(a.path, b.path) || compareText(a.role, b.role);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(
        "usage: build-tflex-stardict-import.mjs --ifo PATH --idx PATH --dict PATH " +
        "[--syn PATH] --recipe PATH --out DIR [--report PATH]"
      );
    }
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ["ifo", "idx", "dict", "recipe", "out"]) {
    if (!args[key]) throw new Error("--" + key + " is required");
  }
  const result = await compileTflexStarDictImport({
    ifoPath: args.ifo,
    idxPath: args.idx,
    dictPath: args.dict,
    synPath: args.syn,
    recipePath: args.recipe,
    outDir: args.out,
    reportPath: args.report
  });
  process.stdout.write(JSON.stringify(result.report, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
