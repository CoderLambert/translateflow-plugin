#!/usr/bin/env node
import { createHash, webcrypto } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_SHARD_BYTES,
  TFLEX_BUNDLED_PROFILE,
  TFLEX_COMPILER_VERSION,
  TFLEX_FORMAT_VERSION,
  TFLEX_NORMALIZATION_VERSION,
  TFLEX_READER_MIN_VERSION,
  normalizeExactLookupKey,
  normalizeLookupKey,
  stableStringify
} from "./build-tflex-core.mjs";
import { createTflexReader } from "../src/background/lexical/tflex-reader.js";

const SOURCE_ID = "wikidata";

export async function compileTflexTechnical({
  extractPath,
  sourceLockPath,
  outDir,
  maxShardBytes = DEFAULT_MAX_SHARD_BYTES
}) {
  const output = resolveRequiredPath(outDir, "outDir");
  const [extractBytes, lockText] = await Promise.all([
    readFile(resolveRequiredPath(extractPath, "extractPath")),
    readFile(resolveRequiredPath(sourceLockPath, "sourceLockPath"), "utf8")
  ]);

  const lock = validateTechnicalSourceLock(JSON.parse(lockText));
  assertPositiveInteger(maxShardBytes, "maxShardBytes");
  verifyLockedExtract(lock, extractBytes);

  const extract = validateTechnicalExtract(JSON.parse(extractBytes.toString("utf8")));
  const records = buildTechnicalRecords(extract, lock.policy, lock.entities);
  if (!records.length) throw new Error("technical pack build produced no approved records");
  const aliases = buildTechnicalAliasIndex(records, lock.policy);

  await prepareOutputDir(output);
  const shards = await writeShards(output, records, maxShardBytes);
  const directory = {
    aliases,
    format: "tflex-directory",
    formatVersion: TFLEX_FORMAT_VERSION,
    normalizationVersion: TFLEX_NORMALIZATION_VERSION,
    shards: shards.map(({ text: _text, ...shard }) => shard)
  };
  const directoryText = stableStringify(directory) + "\n";
  await writeTextFile(output, "directory.json", directoryText);

  const noticesText = buildNotice(lock);
  await writeTextFile(output, "THIRD_PARTY_NOTICES.txt", noticesText);

  const files = [
    descriptor("lookup-index", "directory.json", directoryText),
    ...shards.map(({ path, text }) => descriptor("lexical-data", path, text)),
    descriptor("license-notice", "THIRD_PARTY_NOTICES.txt", noticesText)
  ].sort(compareFile);

  const sources = [{
    id: SOURCE_ID,
    version: lock.source.version,
    provenance: "revision-locked Wikidata structured extract",
    dataSha256: lock.source.extractSha256,
    dataUrl: lock.source.extractPath,
    license: {
      id: lock.source.license.id,
      name: lock.source.license.name,
      source: lock.source.license.source
    }
  }];

  const fingerprintPayload = makeFingerprintPayload({
    formatVersion: TFLEX_FORMAT_VERSION,
    normalizationVersion: TFLEX_NORMALIZATION_VERSION,
    packId: lock.packId,
    packVersion: lock.packVersion,
    profile: TFLEX_BUNDLED_PROFILE,
    profileOptions: { maxShardBytes },
    sources,
    files
  });

  const manifest = {
    format: "tflex",
    formatVersion: TFLEX_FORMAT_VERSION,
    readerMinVersion: TFLEX_READER_MIN_VERSION,
    compilerVersion: TFLEX_COMPILER_VERSION,
    normalizationVersion: TFLEX_NORMALIZATION_VERSION,
    packId: lock.packId,
    packVersion: lock.packVersion,
    sourceLanguage: lock.sourceLanguage,
    targetLanguage: lock.targetLanguage,
    profile: TFLEX_BUNDLED_PROFILE,
    profileOptions: { maxShardBytes },
    fingerprint: "sha256:" + sha256Text(stableStringify(fingerprintPayload)),
    recordCount: records.length,
    sources,
    files: files.map(({ text: _text, ...file }) => file)
  };
  await writeTextFile(output, "manifest.json", stableStringify(manifest) + "\n");

  await validateEmittedPack({ output, records, aliases });
  return { manifest, directory, records, aliases };
}

export function validateTechnicalSourceLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) throw new Error("technical source lock must be an object");
  if (lock.schemaVersion !== 1) throw new Error("technical source lock schemaVersion must be 1");
  if (lock.formatVersion !== TFLEX_FORMAT_VERSION) throw new Error("technical source lock formatVersion is incompatible");
  if (lock.readerMinVersion !== TFLEX_READER_MIN_VERSION) throw new Error("technical source lock readerMinVersion is incompatible");
  if (lock.normalizationVersion !== TFLEX_NORMALIZATION_VERSION) throw new Error("technical source lock normalizationVersion is incompatible");
  for (const key of ["packId", "packVersion", "sourceLanguage", "targetLanguage"]) requireText(lock[key], "lock " + key);
  if (lock.sourceLanguage !== "en" || lock.targetLanguage !== "zh-CN") throw new Error("technical source lock language pair is incompatible");

  const source = lock.source;
  if (!source || source.id !== SOURCE_ID) throw new Error("technical source lock must contain Wikidata source metadata");
  requireText(source.version, "source version");
  requireText(source.namespace, "source namespace");
  requireText(source.extractPath, "source extractPath");
  requireSha256(source.extractSha256, "source extractSha256");
  assertPositiveInteger(source.extractSize, "source extractSize");
  if (source.license?.id !== "CC0-1.0") throw new Error("Wikidata structured extract must be locked as CC0-1.0");
  for (const key of ["name", "source", "notice"]) requireText(source.license?.[key], "source license " + key);

  const policy = lock.policy;
  if (!policy || !Array.isArray(policy.allowedTypes) || !policy.allowedTypes.length) throw new Error("technical source lock allowedTypes are required");
  if (!Array.isArray(policy.blockedAliases) || !Array.isArray(policy.caseSensitiveAliases)) throw new Error("technical alias policy is incomplete");
  assertPositiveInteger(policy.maxAliasesPerEntity, "maxAliasesPerEntity");
  assertPositiveInteger(policy.maxTypeLabelsPerEntity, "maxTypeLabelsPerEntity");
  assertPositiveInteger(policy.maxDescriptionChars, "maxDescriptionChars");

  if (!Array.isArray(lock.entities) || !lock.entities.length) throw new Error("technical source lock entities are required");
  const seenQids = new Set();
  let previousQid = "";
  for (const entity of lock.entities) {
    if (!entity || !/^Q[1-9][0-9]*$/.test(entity.qid || "")) throw new Error("invalid locked Wikidata QID");
    if (seenQids.has(entity.qid)) throw new Error("duplicate locked Wikidata QID: " + entity.qid);
    if (previousQid && previousQid >= entity.qid) throw new Error("locked Wikidata entities must be sorted by QID");
    assertPositiveInteger(entity.revision, "locked Wikidata revision");
    if (!["technical-concept", "technical-entity"].includes(entity.kind)) throw new Error("invalid locked technical kind: " + entity.kind);
    requireText(entity.category, "locked technical category");
    seenQids.add(entity.qid);
    previousQid = entity.qid;
  }
  return lock;
}

export function validateTechnicalExtract(extract) {
  if (!extract || typeof extract !== "object" || Array.isArray(extract)) throw new Error("technical extract must be an object");
  if (extract.schemaVersion !== 1) throw new Error("technical extract schemaVersion must be 1");
  if (extract.source !== "Wikidata main namespace structured data") throw new Error("technical extract source namespace is incompatible");
  if (extract.license !== "CC0-1.0") throw new Error("technical extract license is incompatible");
  if (!Array.isArray(extract.entities) || !extract.entities.length) throw new Error("technical extract entities are required");
  return extract;
}

export function buildTechnicalRecords(extract, policy, lockedEntities = []) {
  const allowedTypes = new Set(policy.allowedTypes);
  const blockedAliases = new Set(policy.blockedAliases.map(normalizeLookupKey));
  const caseSensitiveAliases = new Set(policy.caseSensitiveAliases.map(normalizeExactLookupKey));
  const lockedByQid = new Map((Array.isArray(lockedEntities) ? lockedEntities : []).map((item) => [item.qid, item]));
  if (lockedByQid.size) validateExtractAgainstLock(extract.entities, lockedByQid);

  const records = [];
  const seenKeys = new Set();

  for (const entity of extract.entities) {
    validateEntity(entity, policy);
    const locked = lockedByQid.get(entity.qid);
    const approvedTypes = uniqueSorted(entity.types.filter((type) => allowedTypes.has(type)))
      .slice(0, policy.maxTypeLabelsPerEntity);
    if (!approvedTypes.length) continue;

    const displayForm = normalizeExactLookupKey(entity.label);
    const lookupKey = normalizeLookupKey(displayForm);
    if (!lookupKey) continue;
    if (seenKeys.has(lookupKey)) throw new Error("duplicate technical lookupKey: " + lookupKey);
    seenKeys.add(lookupKey);

    const aliases = [];
    const exactLookupKeys = new Set([displayForm]);
    for (const aliasValue of entity.aliases.slice(0, policy.maxAliasesPerEntity)) {
      const alias = normalizeExactLookupKey(aliasValue);
      if (!alias || blockedAliases.has(normalizeLookupKey(alias))) continue;
      assertDataOnly(alias, "technical alias");
      if (normalizeLookupKey(alias) === lookupKey) {
        exactLookupKeys.add(alias);
        continue;
      }
      aliases.push({
        value: alias,
        caseSensitive: caseSensitiveAliases.has(alias)
      });
    }

    const targetTranslations = uniqueSorted([
      entity.zhLabel,
      ...(Array.isArray(entity.zhAliases) ? entity.zhAliases : [])
    ].filter(Boolean).map(normalizeTargetDisplay));
    const translations = targetTranslations.length ? targetTranslations : [displayForm];
    const category = locked?.category || "";

    records.push({
      lookupKey,
      exactLookupKeys: [...exactLookupKeys].sort(compareText),
      displayForm,
      kind: locked?.kind || "technical-entity",
      aliases: uniqueSorted(aliases.map((item) => item.value)),
      entityId: entity.qid,
      translations,
      typeLabels: approvedTypes,
      domains: category ? [category] : [],
      description: normalizeDescription(entity.description || ""),
      sourceRevision: entity.revision,
      sourceRefs: [{ sourceId: SOURCE_ID, recordId: entity.qid + "@" + entity.revision }],
      _aliasPolicy: aliases
    });
  }

  return records
    .sort((a, b) => compareText(a.lookupKey, b.lookupKey))
    .map(({ _aliasPolicy: _hidden, ...record }) => record);
}

export function buildTechnicalAliasIndex(records, policy) {
  const caseSensitive = new Set(policy.caseSensitiveAliases.map(normalizeExactLookupKey));
  const index = new Map();

  for (const record of records) {
    for (const alias of record.aliases || []) {
      const exact = normalizeExactLookupKey(alias);
      const key = normalizeLookupKey(exact);
      if (!key || key === record.lookupKey) continue;
      const sensitive = caseSensitive.has(exact);
      let entry = index.get(key);
      if (!entry) {
        entry = { key, caseSensitive: sensitive, exactLookupKeys: new Set(), targets: new Set() };
        index.set(key, entry);
      } else if (entry.caseSensitive !== sensitive) {
        throw new Error("mixed case-sensitivity policy for alias: " + key);
      }
      entry.exactLookupKeys.add(exact);
      entry.targets.add(record.lookupKey);
    }
  }

  return [...index.values()]
    .map((entry) => ({
      key: entry.key,
      caseSensitive: entry.caseSensitive,
      exactLookupKeys: [...entry.exactLookupKeys].sort(compareText),
      targets: [...entry.targets].sort(compareText)
    }))
    .sort((a, b) => compareText(a.key, b.key));
}

function validateEntity(entity, policy) {
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) throw new Error("malformed Wikidata entity");
  const allowedFields = new Set([
    "qid", "revision", "label", "aliases", "zhLabel", "zhAliases",
    "description", "types", "permanentUrl"
  ]);
  for (const key of Object.keys(entity)) {
    if (!allowedFields.has(key)) throw new Error("unsupported Wikidata extract field: " + key);
  }

  if (!/^Q[1-9][0-9]*$/.test(entity.qid || "")) throw new Error("invalid Wikidata QID");
  assertPositiveInteger(entity.revision, "Wikidata revision");
  requireText(entity.label, "Wikidata label");
  assertDataOnly(entity.label, "Wikidata label");
  if (!Array.isArray(entity.aliases) || !Array.isArray(entity.types) || !Array.isArray(entity.zhAliases)) {
    throw new Error("Wikidata aliases/zhAliases/types are required");
  }
  if (entity.aliases.length > policy.maxAliasesPerEntity) throw new Error("Wikidata entity exceeds alias limit");
  if (entity.types.length > policy.maxTypeLabelsPerEntity) throw new Error("Wikidata entity exceeds type-label limit");
  if (entity.zhLabel !== null && entity.zhLabel !== undefined) {
    requireText(entity.zhLabel, "Wikidata zhLabel");
    assertDataOnly(entity.zhLabel, "Wikidata zhLabel");
  }
  for (const alias of [...entity.aliases, ...entity.zhAliases]) {
    requireText(alias, "Wikidata alias");
    assertDataOnly(alias, "Wikidata alias");
  }
  for (const type of entity.types) {
    requireText(type, "Wikidata type");
    assertDataOnly(type, "Wikidata type");
  }

  const description = String(entity.description || "");
  if (description.length > policy.maxDescriptionChars) throw new Error("Wikidata description exceeds limit");
  assertDataOnly(description, "Wikidata description");

  requireText(entity.permanentUrl, "Wikidata permanentUrl");
  const expected = "https://www.wikidata.org/w/index.php?title=" + entity.qid + "&oldid=" + entity.revision;
  if (entity.permanentUrl !== expected) throw new Error("Wikidata permanentUrl does not match QID/revision");
}

function validateExtractAgainstLock(entities, lockedByQid) {
  if (entities.length !== lockedByQid.size) throw new Error("Wikidata extract entity set does not match source lock");
  const seen = new Set();
  for (const entity of entities) {
    const locked = lockedByQid.get(entity?.qid);
    if (!locked) throw new Error("unexpected Wikidata entity in extract: " + String(entity?.qid || ""));
    if (seen.has(entity.qid)) throw new Error("duplicate Wikidata entity in extract: " + entity.qid);
    if (entity.revision !== locked.revision) throw new Error("Wikidata revision mismatch for " + entity.qid);
    seen.add(entity.qid);
  }
  for (const qid of lockedByQid.keys()) {
    if (!seen.has(qid)) throw new Error("locked Wikidata entity missing from extract: " + qid);
  }
}

function normalizeTargetDisplay(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function normalizeDescription(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

async function validateEmittedPack({ output, records, aliases }) {
  const reader = createTflexReader({
    packBasePath: "pack",
    cryptoProvider: webcrypto,
    readBytes: async (path) => new Uint8Array(await readFile(resolve(output, path.replace(/^pack\//, ""))))
  });

  for (const record of records) {
    const hit = await reader.lookup(record.displayForm);
    if (!hit || hit.record.entityId !== record.entityId) throw new Error("emitted technical record failed self-check: " + record.lookupKey);
  }
  for (const alias of aliases) {
    const query = alias.exactLookupKeys[0] || alias.key;
    const hits = await reader.lookupAll(query);
    const actual = hits.map((hit) => hit.record.lookupKey).sort(compareText);
    if (stableStringify(actual) !== stableStringify(alias.targets)) throw new Error("emitted technical alias failed self-check: " + alias.key);
  }
}

async function writeShards(output, records, maxShardBytes) {
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
    shards.push({ path, firstKey, lastKey, count: lines.length, size, sha256: sha256Text(text), text });
    lines = [];
    bytes = 0;
  }

  for (const record of records) {
    const line = stableStringify(record) + "\n";
    const size = Buffer.byteLength(line);
    if (size > maxShardBytes) throw new Error("technical record exceeds max shard size: " + record.lookupKey);
    if (lines.length && bytes + size > maxShardBytes) await flush();
    if (!lines.length) firstKey = record.lookupKey;
    lastKey = record.lookupKey;
    lines.push(line);
    bytes += size;
  }
  await flush();
  return shards;
}

function makeFingerprintPayload({ formatVersion, normalizationVersion, packId, packVersion, profile, profileOptions, sources, files }) {
  return {
    formatVersion,
    normalizationVersion,
    packId,
    packVersion,
    profile,
    profileOptions: { maxShardBytes: profileOptions.maxShardBytes },
    sources: [...sources].sort((a, b) => compareText(a.id, b.id)).map((source) => ({
      id: source.id,
      version: source.version,
      provenance: source.provenance,
      dataSha256: source.dataSha256,
      licenseId: source.license.id
    })),
    files: [...files].sort(compareFile).map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }))
  };
}

function buildNotice(lock) {
  return [
    "=== Wikidata structured data ===",
    "Source extract: " + lock.source.extractPath,
    "License: " + lock.source.license.name + " [" + lock.source.license.id + "]",
    "License source: " + lock.source.license.source,
    "",
    lock.source.license.notice.trim(),
    ""
  ].join("\n");
}

function verifyLockedExtract(lock, bytes) {
  if (bytes.byteLength !== lock.source.extractSize) throw new Error("Wikidata extract size mismatch");
  const actual = sha256Bytes(bytes);
  if (actual !== lock.source.extractSha256.toLowerCase()) throw new Error("Wikidata extract SHA-256 mismatch");
}

async function prepareOutputDir(path) {
  const resolved = resolve(path);
  if (resolved === resolve("/") || resolved === resolve(process.cwd())) throw new Error("refusing unsafe output directory");
  await mkdir(resolved, { recursive: true });
  if ((await readdir(resolved)).length) throw new Error("output directory must be empty");
}

async function writeTextFile(root, relativePath, text) {
  const path = resolve(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

function descriptor(role, path, text) {
  return { role, path, size: Buffer.byteLength(text), sha256: sha256Text(text), text };
}

function compareFile(a, b) {
  return compareText(a.path, b.path) || compareText(a.role, b.role);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareText);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertDataOnly(value, label) {
  const text = String(value || "");
  if (/<\/?[A-Za-z][^>]*>/u.test(text) || /<!--|<!DOCTYPE\b|<\?/iu.test(text) || /javascript\s*:/iu.test(text)) {
    throw new Error(label + " contains HTML-like markup or executable content");
  }
}

function requireText(value, label) {
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

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(text) {
  return sha256Bytes(Buffer.from(text, "utf8"));
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
  const result = await compileTflexTechnical({
    extractPath: args.extract,
    sourceLockPath: args["source-lock"],
    outDir: args.out,
    maxShardBytes: args["max-shard-bytes"] ? Number(args["max-shard-bytes"]) : DEFAULT_MAX_SHARD_BYTES
  });
  process.stdout.write(JSON.stringify({
    packId: result.manifest.packId,
    fingerprint: result.manifest.fingerprint,
    recordCount: result.manifest.recordCount,
    aliases: result.aliases.length
  }, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
