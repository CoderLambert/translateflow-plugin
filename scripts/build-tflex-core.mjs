#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TFLEX_FORMAT_VERSION = 1;
export const TFLEX_READER_MIN_VERSION = 1;
export const TFLEX_NORMALIZATION_VERSION = 1;
export const TFLEX_BUNDLED_PROFILE = "bundled-sharded-v1";
export const TFLEX_COMPILER_VERSION = 1;
export const DEFAULT_MAX_SHARD_BYTES = 512 * 1024;

const SOURCE_IDS = Object.freeze({
  english: "pwn-3.0",
  chinese: "chinese-open-wordnet"
});

export async function compileTflexCore({
  englishPath,
  chinesePath,
  sourceLockPath,
  outDir,
  maxShardBytes = DEFAULT_MAX_SHARD_BYTES
}) {
  const output = resolveRequiredPath(outDir, "outDir");
  assertSafeOutputDir(output);
  assertPositiveInteger(maxShardBytes, "maxShardBytes");

  const [englishBytes, chineseBytes, sourceLockText] = await Promise.all([
    readFile(resolveRequiredPath(englishPath, "englishPath")),
    readFile(resolveRequiredPath(chinesePath, "chinesePath")),
    readFile(resolveRequiredPath(sourceLockPath, "sourceLockPath"), "utf8")
  ]);

  const sourceLock = validateSourceLock(JSON.parse(sourceLockText));
  verifyLockedBytes(sourceLock.sources.find((item) => item.id === SOURCE_IDS.english), englishBytes);
  verifyLockedBytes(sourceLock.sources.find((item) => item.id === SOURCE_IDS.chinese), chineseBytes);

  const records = buildCoreRecords({
    englishTab: englishBytes.toString("utf8"),
    chineseTab: chineseBytes.toString("utf8")
  });
  if (!records.length) throw new Error("TFLex core build produced no bilingual records");

  await prepareOutputDir(output);

  const shardFiles = await writeShards({ output, records, maxShardBytes });
  const directory = {
    format: "tflex-directory",
    formatVersion: TFLEX_FORMAT_VERSION,
    normalizationVersion: TFLEX_NORMALIZATION_VERSION,
    shards: shardFiles.map(({ path, firstKey, lastKey, count, size, sha256 }) => ({
      path, firstKey, lastKey, count, size, sha256
    }))
  };
  const directoryText = stableStringify(directory) + "\n";
  const directoryPath = "directory.json";
  await writeTextFile(output, directoryPath, directoryText);

  const noticesText = buildThirdPartyNotices(sourceLock.sources);
  const noticesPath = "THIRD_PARTY_NOTICES.txt";
  await writeTextFile(output, noticesPath, noticesText);

  const files = [
    makeFileDescriptor("lookup-index", directoryPath, directoryText),
    ...shardFiles.map(({ path, text }) => makeFileDescriptor("lexical-data", path, text)),
    makeFileDescriptor("license-notice", noticesPath, noticesText)
  ].sort(compareFileDescriptor);

  const sources = [...sourceLock.sources]
    .sort((a, b) => compareText(a.id, b.id))
    .map((source) => ({
      id: source.id,
      version: source.version,
      provenance: source.provenance,
      dataSha256: source.data.sha256,
      dataUrl: source.data.url,
      license: {
        id: source.license.id,
        name: source.license.name,
        source: source.license.source
      }
    }));

  const fingerprintPayload = {
    formatVersion: TFLEX_FORMAT_VERSION,
    normalizationVersion: TFLEX_NORMALIZATION_VERSION,
    packId: sourceLock.packId,
    packVersion: sourceLock.packVersion,
    profile: TFLEX_BUNDLED_PROFILE,
    profileOptions: { maxShardBytes },
    sources: sources.map((source) => ({
      id: source.id,
      version: source.version,
      provenance: source.provenance,
      dataSha256: source.dataSha256,
      licenseId: source.license.id
    })),
    files: files.map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }))
  };

  const manifest = {
    format: "tflex",
    formatVersion: TFLEX_FORMAT_VERSION,
    readerMinVersion: TFLEX_READER_MIN_VERSION,
    compilerVersion: TFLEX_COMPILER_VERSION,
    normalizationVersion: TFLEX_NORMALIZATION_VERSION,
    packId: sourceLock.packId,
    packVersion: sourceLock.packVersion,
    sourceLanguage: sourceLock.sourceLanguage,
    targetLanguage: sourceLock.targetLanguage,
    profile: TFLEX_BUNDLED_PROFILE,
    profileOptions: { maxShardBytes },
    fingerprint: "sha256:" + sha256Text(stableStringify(fingerprintPayload)),
    recordCount: records.length,
    sources,
    files: files.map(({ text: _text, ...descriptor }) => descriptor)
  };
  await writeTextFile(output, "manifest.json", stableStringify(manifest) + "\n");
  await validateTflexCoreOutput({ outDir: output, readerVersion: TFLEX_READER_MIN_VERSION });
  return { manifest, directory, records };
}

export function validateSourceLock(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("source lock must be an object");
  if (input.schemaVersion !== 1) throw new Error("source lock schemaVersion must be 1");
  if (input.formatVersion !== TFLEX_FORMAT_VERSION) throw new Error("source lock formatVersion is incompatible");
  if (input.readerMinVersion !== TFLEX_READER_MIN_VERSION) throw new Error("source lock readerMinVersion is incompatible");
  if (input.normalizationVersion !== TFLEX_NORMALIZATION_VERSION) throw new Error("source lock normalizationVersion is incompatible");
  for (const key of ["packId", "packVersion", "sourceLanguage", "targetLanguage"]) {
    requireNonEmptyString(input[key], "source lock " + key);
  }
  if (input.sourceLanguage !== "en") throw new Error("source lock sourceLanguage is incompatible; expected en");
  if (input.targetLanguage !== "zh-CN") throw new Error("source lock targetLanguage is incompatible; expected zh-CN");
  if (!Array.isArray(input.sources) || input.sources.length < 2) throw new Error("source lock must contain source descriptors");

  const seen = new Set();
  const sources = input.sources.map((source) => {
    if (!source || typeof source !== "object") throw new Error("source descriptor must be an object");
    requireNonEmptyString(source.id, "source id");
    if (seen.has(source.id)) throw new Error("duplicate source id: " + source.id);
    seen.add(source.id);
    requireNonEmptyString(source.version, "source version");
    requireNonEmptyString(source.provenance, "source provenance");
    if (!source.data || typeof source.data !== "object") throw new Error("source " + source.id + " data descriptor is required");
    requireNonEmptyString(source.data.url, "source " + source.id + " data url");
    requireSha256(source.data.sha256, "source " + source.id + " data sha256");
    if (!source.license || typeof source.license !== "object") throw new Error("source " + source.id + " license descriptor is required");
    requireNonEmptyString(source.license.id, "source " + source.id + " license id");
    requireNonEmptyString(source.license.name, "source " + source.id + " license name");
    requireNonEmptyString(source.license.source, "source " + source.id + " license source");
    requireNonEmptyString(source.license.notice, "source " + source.id + " license notice");
    return source;
  });

  const requiredSourceIds = new Set(Object.values(SOURCE_IDS));
  for (const source of sources) {
    if (!requiredSourceIds.has(source.id)) throw new Error("unsupported source id for core pack: " + source.id);
  }
  for (const required of requiredSourceIds) {
    if (!seen.has(required)) throw new Error("source lock missing required source: " + required);
  }
  return { ...input, sources };
}

export function buildCoreRecords({ englishTab, chineseTab }) {
  const english = parseOmwRows(englishTab, "lemma");
  const chinese = parseOmwRows(chineseTab, "cmn:lemma");
  const records = new Map();

  for (const [synset, englishForms] of english) {
    const chineseForms = chinese.get(synset);
    if (!chineseForms?.length) continue;
    const displayTranslations = uniqueSorted(chineseForms.map(normalizeChineseDisplay).filter(Boolean));
    const rawTranslations = uniqueSorted(chineseForms);
    if (!displayTranslations.length) continue;

    for (const rawEnglish of englishForms) {
      assertDataOnlyString(rawEnglish, "English lemma");
      for (const value of chineseForms) assertDataOnlyString(value, "Chinese lemma");
      const displayForm = normalizeEnglishDisplay(rawEnglish);
      const lookupKey = normalizeLookupKey(displayForm);
      if (!lookupKey) continue;

      let record = records.get(lookupKey);
      if (!record) {
        record = {
          lookupKey,
          exactLookupKeys: [],
          displayForm,
          kind: "lexical",
          aliases: [],
          sourceForms: [],
          senses: [],
          sourceRefs: []
        };
        records.set(lookupKey, record);
      }

      record.sourceForms.push(rawEnglish);
      record.exactLookupKeys.push(normalizeExactLookupKey(displayForm));
      if (displayForm !== record.displayForm) record.aliases.push(displayForm);
      record.sourceRefs.push({ sourceId: SOURCE_IDS.english, recordId: synset });

      if (!record.senses.some((sense) => sense.id === "pwn3:" + synset)) {
        record.senses.push({
          id: "pwn3:" + synset,
          partOfSpeech: partOfSpeechFromSynset(synset),
          translations: displayTranslations,
          rawTranslations,
          sourceRefs: [
            { sourceId: SOURCE_IDS.english, recordId: synset },
            { sourceId: SOURCE_IDS.chinese, recordId: synset }
          ]
        });
      }
    }
  }

  return [...records.values()]
    .map((record) => ({
      ...record,
      aliases: uniqueSorted(record.aliases),
      exactLookupKeys: uniqueSorted(record.exactLookupKeys),
      sourceForms: uniqueSorted(record.sourceForms),
      senses: [...record.senses].sort((a, b) => compareText(a.id, b.id)),
      sourceRefs: dedupeSourceRefs(record.sourceRefs)
    }))
    .sort((a, b) => compareText(a.lookupKey, b.lookupKey));
}

export function parseOmwRows(text, relation) {
  const bySynset = new Map();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const fields = rawLine.split("\t");
    if (fields.length < 3 || fields[1] !== relation) continue;
    const synset = String(fields[0] || "").trim();
    const form = fields.slice(2).join("\t").trim();
    if (!synset || !form) continue;
    if (!/^[0-9]{8}-[anrsv]$/.test(synset)) throw new Error("invalid WordNet synset id: " + synset);
    if (!bySynset.has(synset)) bySynset.set(synset, []);
    bySynset.get(synset).push(form);
  }
  for (const [synset, forms] of bySynset) bySynset.set(synset, uniqueSorted(forms));
  return bySynset;
}

export function normalizeExactLookupKey(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizeLookupKey(value) {
  return normalizeExactLookupKey(value).toLowerCase();
}

export function normalizeEnglishDisplay(value) {
  return String(value || "").replaceAll("_", " ").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizeChineseDisplay(value) {
  return String(value || "").normalize("NFKC").replaceAll("+", "").trim().replace(/\s+/gu, " ");
}

export function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}

export function validateCoreRecords(records) {
  if (!Array.isArray(records)) throw new Error("TFLex records must be an array");
  const seenKeys = new Set();

  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("malformed TFLex record");
    requireNonEmptyString(record.lookupKey, "record lookupKey");
    requireNonEmptyString(record.displayForm, "record displayForm");
    if (record.kind !== "lexical") throw new Error("unsupported Core record kind: " + record.kind);
    if (seenKeys.has(record.lookupKey)) throw new Error("duplicate TFLex lookup key: " + record.lookupKey);
    seenKeys.add(record.lookupKey);
    if (normalizeLookupKey(record.lookupKey) !== record.lookupKey) throw new Error("record lookupKey is not canonical: " + record.lookupKey);
    assertDataOnlyString(record.displayForm, "record displayForm");

    if (!Array.isArray(record.exactLookupKeys) || !record.exactLookupKeys.length) {
      throw new Error("record exactLookupKeys are required: " + record.lookupKey);
    }
    for (const key of record.exactLookupKeys) {
      requireNonEmptyString(key, "exact lookup key");
      assertDataOnlyString(key, "exact lookup key");
    }

    if (!Array.isArray(record.senses) || !record.senses.length) throw new Error("record senses are required: " + record.lookupKey);
    const seenSenseIds = new Set();
    for (const sense of record.senses) {
      if (!sense || typeof sense !== "object" || Array.isArray(sense)) throw new Error("malformed sense: " + record.lookupKey);
      requireNonEmptyString(sense.id, "sense id");
      if (seenSenseIds.has(sense.id)) throw new Error("duplicate sense id: " + sense.id);
      seenSenseIds.add(sense.id);
      if (!Array.isArray(sense.translations) || !sense.translations.length) throw new Error("sense translations are required: " + sense.id);
      for (const translation of sense.translations) {
        requireNonEmptyString(translation, "sense translation");
        assertDataOnlyString(translation, "sense translation");
      }
      if (!Array.isArray(sense.sourceRefs) || !sense.sourceRefs.length) throw new Error("sense sourceRefs are required: " + sense.id);
    }
  }

  return true;
}

export async function validateTflexCoreOutput({
  outDir,
  readerVersion = TFLEX_READER_MIN_VERSION
}) {
  const root = resolveRequiredPath(outDir, "outDir");
  assertPositiveInteger(readerVersion, "readerVersion");

  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  } catch (error) {
    throw new Error("invalid TFLex manifest: " + (error?.message || error));
  }

  if (manifest.format !== "tflex") throw new Error("invalid TFLex manifest format");
  if (manifest.formatVersion !== TFLEX_FORMAT_VERSION) throw new Error("incompatible TFLex formatVersion");
  if (!Number.isSafeInteger(manifest.readerMinVersion) || manifest.readerMinVersion > readerVersion) {
    throw new Error("incompatible TFLex reader version");
  }
  if (manifest.normalizationVersion !== TFLEX_NORMALIZATION_VERSION) throw new Error("incompatible TFLex normalizationVersion");
  if (manifest.profile !== TFLEX_BUNDLED_PROFILE) throw new Error("incompatible TFLex physical profile");
  const maxShardBytes = manifest.profileOptions?.maxShardBytes;
  assertPositiveInteger(maxShardBytes, "manifest profileOptions.maxShardBytes");

  if (!Array.isArray(manifest.sources) || manifest.sources.length !== Object.keys(SOURCE_IDS).length) {
    throw new Error("manifest source metadata is incomplete");
  }
  const manifestSourceIds = new Set();
  for (const source of manifest.sources) {
    requireNonEmptyString(source?.id, "manifest source id");
    if (!Object.values(SOURCE_IDS).includes(source.id)) throw new Error("manifest contains unsupported source: " + source.id);
    if (manifestSourceIds.has(source.id)) throw new Error("duplicate manifest source: " + source.id);
    manifestSourceIds.add(source.id);
    requireNonEmptyString(source.version, "manifest source version");
    requireSha256(source.dataSha256, "manifest source dataSha256");
    requireNonEmptyString(source.license?.id, "manifest source license id");
    requireNonEmptyString(source.license?.name, "manifest source license name");
    requireNonEmptyString(source.license?.source, "manifest source license source");
  }

  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error("manifest file descriptors are required");
  const files = new Map();
  for (const descriptor of manifest.files) {
    requireNonEmptyString(descriptor?.role, "manifest file role");
    requireNonEmptyString(descriptor?.path, "manifest file path");
    assertSafePackPath(descriptor.path);
    assertPositiveInteger(descriptor.size, "manifest file size");
    requireSha256(descriptor.sha256, "manifest file sha256");
    if (files.has(descriptor.path)) throw new Error("duplicate manifest file path: " + descriptor.path);
    const bytes = await readFile(resolve(root, descriptor.path));
    if (bytes.byteLength !== descriptor.size) throw new Error("TFLex file size mismatch: " + descriptor.path);
    const actualHash = sha256Bytes(bytes);
    if (actualHash !== descriptor.sha256.toLowerCase()) throw new Error("TFLex file hash mismatch: " + descriptor.path);
    files.set(descriptor.path, { descriptor, bytes });
  }

  const directoryFile = files.get("directory.json");
  if (!directoryFile || directoryFile.descriptor.role !== "lookup-index") throw new Error("TFLex directory descriptor is missing");
  if (![...files.values()].some((item) => item.descriptor.role === "license-notice")) {
    throw new Error("TFLex license notice descriptor is missing");
  }

  let directory;
  try {
    directory = JSON.parse(directoryFile.bytes.toString("utf8"));
  } catch (error) {
    throw new Error("invalid TFLex directory: " + (error?.message || error));
  }
  if (directory.format !== "tflex-directory") throw new Error("invalid TFLex directory format");
  if (directory.formatVersion !== manifest.formatVersion) throw new Error("directory formatVersion mismatch");
  if (directory.normalizationVersion !== manifest.normalizationVersion) throw new Error("directory normalizationVersion mismatch");
  if (!Array.isArray(directory.shards) || !directory.shards.length) throw new Error("TFLex directory has no shards");

  const allRecords = [];
  const seenShardPaths = new Set();
  let previousLastKey = null;
  for (const shard of directory.shards) {
    requireNonEmptyString(shard?.path, "directory shard path");
    assertSafePackPath(shard.path);
    if (seenShardPaths.has(shard.path)) throw new Error("duplicate directory shard path: " + shard.path);
    seenShardPaths.add(shard.path);
    const file = files.get(shard.path);
    if (!file || file.descriptor.role !== "lexical-data") throw new Error("directory references missing lexical shard: " + shard.path);
    if (shard.size !== file.descriptor.size || shard.sha256 !== file.descriptor.sha256) {
      throw new Error("directory shard descriptor mismatch: " + shard.path);
    }
    if (shard.size > maxShardBytes) throw new Error("TFLex shard exceeds declared maxShardBytes: " + shard.path);

    const lines = file.bytes.toString("utf8").split(/\r?\n/).filter(Boolean);
    if (lines.length !== shard.count) throw new Error("TFLex shard count mismatch: " + shard.path);
    const shardRecords = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error("malformed TFLex record JSON in " + shard.path + ": " + (error?.message || error));
      }
    });
    validateCoreRecords(shardRecords);
    if (shardRecords[0]?.lookupKey !== shard.firstKey || shardRecords.at(-1)?.lookupKey !== shard.lastKey) {
      throw new Error("TFLex shard key range mismatch: " + shard.path);
    }
    for (let index = 1; index < shardRecords.length; index += 1) {
      if (compareText(shardRecords[index - 1].lookupKey, shardRecords[index].lookupKey) >= 0) {
        throw new Error("TFLex shard keys are not strictly ordered: " + shard.path);
      }
    }
    if (previousLastKey !== null && compareText(previousLastKey, shard.firstKey) >= 0) {
      throw new Error("TFLex shard ranges overlap or are unordered: " + shard.path);
    }
    previousLastKey = shard.lastKey;
    allRecords.push(...shardRecords);
  }

  validateCoreRecords(allRecords);
  if (allRecords.length !== manifest.recordCount) throw new Error("TFLex manifest recordCount mismatch");
  return { manifest, directory, recordCount: allRecords.length };
}

function assertSafePackPath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("unsafe TFLex pack path: " + path);
  }
}


function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => [key, sortJson(value[key])]));
}

async function writeShards({ output, records, maxShardBytes }) {
  const shards = [];
  let lines = [];
  let bytes = 0;
  let firstKey = "";
  let lastKey = "";

  async function flush() {
    if (!lines.length) return;
    const path = "shards/" + String(shards.length).padStart(4, "0") + ".jsonl";
    const text = lines.join("");
    const size = Buffer.byteLength(text);
    await writeTextFile(output, path, text);
    shards.push({ path, text, firstKey, lastKey, count: lines.length, size, sha256: sha256Text(text) });
    lines = [];
    bytes = 0;
    firstKey = "";
    lastKey = "";
  }

  for (const record of records) {
    const line = stableStringify(record) + "\n";
    const size = Buffer.byteLength(line);
    if (size > maxShardBytes) throw new Error("record exceeds max shard size: " + record.lookupKey);
    if (lines.length && bytes + size > maxShardBytes) await flush();
    if (!lines.length) firstKey = record.lookupKey;
    lastKey = record.lookupKey;
    lines.push(line);
    bytes += size;
  }
  await flush();
  return shards;
}

function partOfSpeechFromSynset(synset) {
  return { n: "noun", v: "verb", a: "adjective", s: "adjective-satellite", r: "adverb" }[synset.at(-1)] || null;
}

function buildThirdPartyNotices(sources) {
  return [...sources]
    .sort((a, b) => compareText(a.id, b.id))
    .map((source) => [
      "=== " + source.id + " (" + source.version + ") ===",
      "Source: " + source.data.url,
      "License: " + source.license.name + " [" + source.license.id + "]",
      "License source: " + source.license.source,
      "",
      source.license.notice.trim(),
      ""
    ].join("\n"))
    .join("\n");
}

function verifyLockedBytes(source, bytes) {
  if (!source) throw new Error("missing locked source");
  const actual = sha256Bytes(bytes);
  if (actual !== source.data.sha256.toLowerCase()) {
    throw new Error("SHA-256 mismatch for " + source.id + ": expected " + source.data.sha256 + ", got " + actual);
  }
}

function makeFileDescriptor(role, path, text) {
  return { role, path, size: Buffer.byteLength(text), sha256: sha256Text(text), text };
}

function compareFileDescriptor(a, b) {
  return compareText(a.path, b.path) || compareText(a.role, b.role);
}

function dedupeSourceRefs(refs) {
  const map = new Map();
  for (const ref of refs) map.set(ref.sourceId + "\u0000" + ref.recordId, ref);
  return [...map.values()].sort((a, b) => compareText(a.sourceId, b.sourceId) || compareText(a.recordId, b.recordId));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareText);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertDataOnlyString(value, label) {
  const text = String(value || "");
  if (/<\/?[A-Za-z][^>]*>/u.test(text) || /<!--|<!DOCTYPE\b|<\?/iu.test(text) || /javascript\s*:/iu.test(text)) {
    throw new Error(label + " contains HTML-like markup or an executable scheme");
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " must be a non-empty string");
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(label + " must be a SHA-256 hex digest");
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(label + " must be a positive integer");
}

function resolveRequiredPath(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required");
  return resolve(value);
}

function assertSafeOutputDir(path) {
  const cwd = resolve(process.cwd());
  if (path === cwd || path === resolve("/")) {
    throw new Error("refusing unsafe output directory: " + path);
  }
}

async function prepareOutputDir(path) {
  await mkdir(path, { recursive: true });
  const entries = await readdir(path);
  if (entries.length) {
    throw new Error("output directory must be empty; refusing to delete existing files: " + path);
  }
}

async function writeTextFile(root, relativePath, text) {
  const path = resolve(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(text) {
  return sha256Bytes(Buffer.from(text, "utf8"));
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
  const result = await compileTflexCore({
    englishPath: args.eng,
    chinesePath: args.cmn,
    sourceLockPath: args["source-lock"],
    outDir: args.out,
    maxShardBytes: args["max-shard-bytes"] ? Number(args["max-shard-bytes"]) : DEFAULT_MAX_SHARD_BYTES
  });
  process.stdout.write(JSON.stringify({
    packId: result.manifest.packId,
    packVersion: result.manifest.packVersion,
    fingerprint: result.manifest.fingerprint,
    recordCount: result.manifest.recordCount,
    shards: result.directory.shards.length
  }, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
