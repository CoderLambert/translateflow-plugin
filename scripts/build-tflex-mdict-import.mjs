#!/usr/bin/env node
import { createHash } from "node:crypto";
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
import {
  TFLEX_OPFS_INDEXED_PROFILE,
  buildIndexedData
} from "./build-tflex-freedict.mjs";
import { projectMdictPoc } from "./project-mdict-import.mjs";
import { validateTflexRecord } from "../src/background/lexical/tflex-integrity.js";
import { isSafePackIdentifier } from "../src/shared/pack-manager.js";

export const MDICT_BILINGUAL_PROFILE = "en-zh-plain-text-translation-v1";
export const MDICT_LOCAL_IMPORT_LICENSE_ID = "USER-PROVIDED-UNVERIFIED";

export async function compileTflexMdictImport({
  mdxPath,
  recipePath,
  outDir,
  reportPath
} = {}) {
  const mdx = requiredPath(mdxPath, "mdxPath");
  const recipe = validateMdictImportRecipe(JSON.parse(
    await readFile(requiredPath(recipePath, "recipePath"), "utf8")
  ));
  const mdxBytes = await readFile(resolve(mdx));
  const mdxSha256 = sha256Bytes(mdxBytes);
  if (mdxSha256 !== recipe.dictionary.mdxSha256) {
    throw new Error(
      "MDict recipe mdxSha256 mismatch: expected " +
      recipe.dictionary.mdxSha256 + ", got " + mdxSha256
    );
  }

  const projection = await projectMdictPoc({
    mdxPath: mdx,
    sourceId: recipe.dictionary.sourceId,
    sourceVersion: recipe.dictionary.sourceVersion
  });
  assertRecipeDictionaryMatch(projection.dictionary, recipe.dictionary);

  const records = buildMdictTflexRecords(projection.entries, recipe);
  if (!records.length) throw new Error("MDict TFLex import produced no records");

  const output = requiredPath(outDir, "outDir");
  await prepareOutputDir(output);
  const indexed = buildIndexedData(records);
  await writeFile(resolve(output, "entries.dat"), indexed.entriesText, "utf8");
  await writeFile(resolve(output, "index.dat"), indexed.indexText, "utf8");

  const files = [
    descriptor("lookup-index", "index.dat", indexed.indexText),
    descriptor("lexical-data", "entries.dat", indexed.entriesText)
  ].sort(compareFile);

  const source = makeSource(recipe, projection.dictionary);
  const sources = [source];
  const fingerprintPayload = makeMdictFingerprintPayload({
    packId: recipe.packId,
    packVersion: recipe.packVersion,
    semanticProfile: recipe.semanticProfile,
    sources,
    files
  });
  const manifest = {
    format: "tflex",
    formatVersion: TFLEX_FORMAT_VERSION,
    readerMinVersion: TFLEX_READER_MIN_VERSION,
    compilerVersion: TFLEX_COMPILER_VERSION,
    normalizationVersion: TFLEX_NORMALIZATION_VERSION,
    packId: recipe.packId,
    packVersion: recipe.packVersion,
    sourceLanguage: recipe.sourceLanguage,
    targetLanguage: recipe.targetLanguage,
    profile: TFLEX_OPFS_INDEXED_PROFILE,
    distributionStatus: "user-import-only",
    semanticProfile: recipe.semanticProfile,
    fingerprint: "sha256:" + sha256Text(stableStringify(fingerprintPayload)),
    recordCount: records.length,
    sourceEntryCount: projection.entries.length,
    sourceFileSha256: mdxSha256,
    license: {
      id: MDICT_LOCAL_IMPORT_LICENSE_ID,
      name: "User-provided dictionary; redistribution rights are not verified",
      source: "local-user-import"
    },
    sources,
    files: files.map(({ text: _text, ...file }) => file)
  };
  await writeFile(resolve(output, "manifest.json"), stableStringify(manifest) + "\n", "utf8");

  const validation = await validateMdictTflexPackOutput({ outDir: output });
  const report = {
    schemaVersion: 1,
    format: "mdict-tflex-import-poc-report",
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    semanticProfile: manifest.semanticProfile,
    dictionary: projection.dictionary,
    sourceFileSha256: mdxSha256,
    sourceEntryCount: projection.entries.length,
    recordCount: records.length,
    files: manifest.files,
    fingerprint: manifest.fingerprint,
    distributionStatus: manifest.distributionStatus,
    policy: {
      localUseOnly: true,
      redistributionRightsVerified: false,
      semanticMapping: "explicit-recipe-only",
      runtimeRegistration: "not-connected",
      importedMarkup: "rejected-upstream",
      mddResources: "not-loaded"
    },
    validation: {
      validatedRecords: validation.validatedRecords
    }
  };
  if (reportPath) {
    await writeFile(resolve(reportPath), JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  return { manifest, records, index: indexed.index, report, projection };
}

export function validateMdictImportRecipe(input) {
  if (!plainObject(input)) throw new Error("MDict import recipe must be an object");
  if (input.schemaVersion !== 1) throw new Error("MDict import recipe schemaVersion must be 1");
  if (input.semanticProfile !== MDICT_BILINGUAL_PROFILE) {
    throw new Error("MDict import recipe semanticProfile is unsupported");
  }
  if (input.sourceLanguage !== "en" || input.targetLanguage !== "zh-CN") {
    throw new Error("MDict import recipe must explicitly declare en -> zh-CN");
  }
  if (!isSafePackIdentifier(input.packId) || !String(input.packId).startsWith("local-")) {
    throw new Error("MDict local import packId must be a safe local-* identifier");
  }
  if (!isSafePackIdentifier(input.packVersion, 120)) {
    throw new Error("MDict local import packVersion is invalid");
  }

  const dictionary = input.dictionary;
  if (!plainObject(dictionary)) throw new Error("MDict import recipe dictionary metadata is required");
  requireText(dictionary.title, "MDict recipe title");
  if (dictionary.generatedByEngineVersion !== "2.0") {
    throw new Error("MDict recipe generatedByEngineVersion must be 2.0");
  }
  if (!["UTF-8", "UTF-16"].includes(dictionary.encoding)) {
    throw new Error("MDict recipe encoding is unsupported");
  }
  if (dictionary.format !== "Text") {
    throw new Error("MDict recipe format must be Text");
  }
  if (!isSafePackIdentifier(dictionary.sourceId)) {
    throw new Error("MDict recipe sourceId is invalid");
  }
  requireText(dictionary.sourceVersion, "MDict recipe sourceVersion");
  if (!/^[a-f0-9]{64}$/.test(dictionary.mdxSha256 || "")) {
    throw new Error("MDict recipe mdxSha256 must be a lowercase SHA-256");
  }

  const assertions = input.assertions;
  if (
    !plainObject(assertions) ||
    assertions.plainTextRepresentsTargetTranslation !== true ||
    assertions.localUseOnly !== true
  ) {
    throw new Error(
      "MDict import recipe requires explicit plain-text translation and local-use assertions"
    );
  }

  return {
    schemaVersion: 1,
    semanticProfile: MDICT_BILINGUAL_PROFILE,
    packId: input.packId,
    packVersion: input.packVersion,
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    dictionary: {
      title: dictionary.title,
      generatedByEngineVersion: "2.0",
      encoding: dictionary.encoding,
      format: "Text",
      sourceId: dictionary.sourceId,
      sourceVersion: dictionary.sourceVersion,
      mdxSha256: dictionary.mdxSha256
    },
    assertions: {
      plainTextRepresentsTargetTranslation: true,
      localUseOnly: true
    }
  };
}

export function buildMdictTflexRecords(entries, recipeInput) {
  const recipe = validateMdictImportRecipe(recipeInput);
  const grouped = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (
      !entry ||
      typeof entry.lookupKey !== "string" ||
      normalizeLookupKey(entry.lookupKey) !== entry.lookupKey ||
      typeof entry.displayForm !== "string" ||
      !entry.displayForm ||
      typeof entry.plainText !== "string" ||
      !entry.plainText ||
      entry.sourceRef?.sourceId !== recipe.dictionary.sourceId ||
      typeof entry.sourceRef?.recordId !== "string" ||
      !entry.sourceRef.recordId
    ) {
      throw new Error("Malformed MDict projection row");
    }

    let record = grouped.get(entry.lookupKey);
    if (!record) {
      record = {
        lookupKey: entry.lookupKey,
        exactLookupKeys: new Set(),
        displayForm: entry.displayForm,
        kind: "lexical",
        aliases: [],
        senses: []
      };
      grouped.set(entry.lookupKey, record);
    }
    const exact = normalizeExactLookupKey(entry.displayForm);
    if (exact) record.exactLookupKeys.add(exact);
    record.senses.push({
      id: "mdict:" + entry.sourceRef.recordId,
      translations: [entry.plainText],
      domains: [],
      sourceRefs: [{ ...entry.sourceRef }]
    });
  }

  const records = [...grouped.values()]
    .map((record) => ({
      ...record,
      exactLookupKeys: [...record.exactLookupKeys].sort(compareText),
      senses: [...record.senses]
    }))
    .sort((a, b) => compareText(a.lookupKey, b.lookupKey));

  let previous = "";
  for (const record of records) {
    if (previous && previous >= record.lookupKey) {
      throw new Error("MDict TFLex lookup keys must be strictly ordered");
    }
    validateTflexRecord(record, recipe.packId, "entries.dat");
    previous = record.lookupKey;
  }
  return records;
}

export async function validateMdictTflexPackOutput({ outDir } = {}) {
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
    manifest.semanticProfile !== MDICT_BILINGUAL_PROFILE ||
    manifest.sourceLanguage !== "en" ||
    manifest.targetLanguage !== "zh-CN" ||
    !isSafePackIdentifier(manifest.packId) ||
    !String(manifest.packId).startsWith("local-") ||
    !isSafePackIdentifier(manifest.packVersion, 120) ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceFileSha256 || "")
  ) {
    throw new Error("MDict local TFLex manifest is incompatible");
  }
  if (
    manifest.license?.id !== MDICT_LOCAL_IMPORT_LICENSE_ID ||
    !Array.isArray(manifest.sources) ||
    manifest.sources.length !== 1 ||
    manifest.sources[0]?.license?.id !== MDICT_LOCAL_IMPORT_LICENSE_ID ||
    manifest.sources[0]?.sourceFileSha256 !== manifest.sourceFileSha256
  ) {
    throw new Error("MDict local TFLex source/license boundary is invalid");
  }

  const descriptors = new Map((manifest.files || []).map((file) => [file.path, file]));
  if (descriptors.size !== 2) {
    throw new Error("MDict local TFLex must contain exactly index.dat and entries.dat descriptors");
  }
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
    throw new Error("MDict local TFLex index is malformed");
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
      throw new Error("MDict local TFLex index keys/targets are malformed");
    }
    previous = item.key;

    for (const target of item.targets) {
      validateIndexTarget(target, entriesBytes.byteLength);
      if (target.matchedAlias) {
        throw new Error("MDict local TFLex POC does not emit aliases");
      }
      if (item.key !== target.lookupKey) {
        throw new Error("MDict local TFLex canonical index target mismatch");
      }
      const bytes = entriesBytes.subarray(target.offset, target.offset + target.length);
      if (sha256Bytes(bytes) !== target.sha256) {
        throw new Error("MDict local TFLex record hash mismatch");
      }
      const record = JSON.parse(bytes.toString("utf8").trim());
      validateTflexRecord(record, manifest.packId, "entries.dat");
      if (record.lookupKey !== target.lookupKey) {
        throw new Error("MDict local TFLex index/record key mismatch");
      }
      if (canonical.has(target.lookupKey)) continue;
      canonical.add(target.lookupKey);
      validatedRecords += 1;
    }
  }
  if (validatedRecords !== manifest.recordCount) {
    throw new Error("MDict local TFLex recordCount mismatch");
  }

  const fingerprintPayload = makeMdictFingerprintPayload({
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    semanticProfile: manifest.semanticProfile,
    sources: manifest.sources,
    files: manifest.files
  });
  const actualFingerprint = "sha256:" + sha256Text(stableStringify(fingerprintPayload));
  if (actualFingerprint !== manifest.fingerprint) {
    throw new Error("MDict local TFLex fingerprint mismatch");
  }
  return { manifest, index, validatedRecords };
}

export async function createMdictTflexPocReader({ packDir } = {}) {
  const root = resolve(requiredPath(packDir, "packDir"));
  const { manifest, index } = await validateMdictTflexPackOutput({ outDir: root });
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
        throw new Error("MDict local TFLex query slice failed integrity verification");
      }
      const record = JSON.parse(bytes.toString("utf8").trim());
      hits.push({
        record,
        exactCaseMatch: Array.isArray(record.exactLookupKeys) &&
          record.exactLookupKeys.includes(exactKey),
        matchedAlias: false,
        aliasKey: "",
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

export function makeMdictFingerprintPayload({
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
        sourceFileSha256: source.sourceFileSha256,
        licenseId: source.license?.id
      })),
    files: [...files]
      .sort(compareFile)
      .map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }))
  };
}

function assertRecipeDictionaryMatch(dictionary, recipeDictionary) {
  for (const key of ["title", "generatedByEngineVersion", "encoding", "format"]) {
    if (dictionary[key] !== recipeDictionary[key]) {
      throw new Error(
        "MDict recipe " + key + " mismatch: expected " +
        recipeDictionary[key] + ", got " + dictionary[key]
      );
    }
  }
}

function makeSource(recipe, dictionary) {
  return {
    id: recipe.dictionary.sourceId,
    version: recipe.dictionary.sourceVersion,
    provenance: [
      "User-selected MDict: " + dictionary.title,
      "MDX engine " + dictionary.generatedByEngineVersion,
      "encoding " + dictionary.encoding,
      "source file SHA-256 " + recipe.dictionary.mdxSha256,
      "semantic profile explicitly declared by local import recipe"
    ].join("; "),
    semanticProfile: recipe.semanticProfile,
    sourceFileSha256: recipe.dictionary.mdxSha256,
    license: {
      id: MDICT_LOCAL_IMPORT_LICENSE_ID,
      name: "User-provided dictionary; redistribution rights are not verified",
      source: "local-user-import"
    }
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
    throw new Error("MDict local TFLex index target is malformed");
  }
}

function verifyDescriptor(descriptorValue, bytes, role) {
  if (
    descriptorValue?.role !== role ||
    descriptorValue.size !== bytes.byteLength ||
    descriptorValue.sha256 !== sha256Bytes(bytes)
  ) {
    throw new Error("MDict local TFLex descriptor mismatch: " + role);
  }
}

function descriptor(role, path, text) {
  return {
    role,
    path,
    size: Buffer.byteLength(text),
    sha256: sha256Text(text),
    text
  };
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

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
        "usage: build-tflex-mdict-import.mjs --mdx PATH --recipe PATH --out DIR [--report PATH]"
      );
    }
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ["mdx", "recipe", "out"]) {
    if (!args[key]) throw new Error("--" + key + " is required");
  }
  const result = await compileTflexMdictImport({
    mdxPath: args.mdx,
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
