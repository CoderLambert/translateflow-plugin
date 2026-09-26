#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
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

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

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
    fingerprint: "sha256:" + sha256Text(stableStringify(fingerprintPayload)),
    recordCount: records.length,
    sources,
    files: files.map(({ text: _text, ...descriptor }) => descriptor)
  };
  await writeTextFile(output, "manifest.json", stableStringify(manifest) + "\n");
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

  for (const required of Object.values(SOURCE_IDS)) {
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

export function normalizeLookupKey(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
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
  if (/<\s*(?:script|style|iframe|object|embed|link|img)\b/iu.test(text) || /javascript\s*:/iu.test(text)) {
    throw new Error(label + " contains executable/renderable markup");
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
  if (path === cwd || path === resolve("/") || path.split(sep).filter(Boolean).length < 2) {
    throw new Error("refusing unsafe output directory: " + path);
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
