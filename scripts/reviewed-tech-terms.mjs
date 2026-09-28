#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TFLEX_FORMAT_VERSION,
  TFLEX_NORMALIZATION_VERSION,
  TFLEX_READER_MIN_VERSION,
  normalizeExactLookupKey,
  normalizeLookupKey
} from "./build-tflex-core.mjs";

export const REVIEWED_TECH_SOURCE_ID = "translateflow-reviewed-technical-terms";

const REVIEWED_LICENSE_ID = "LicenseRef-TranslateFlow-Reviewed-Terms";
const REVIEWED_SOURCE_NAME = "TranslateFlow reviewed technical terminology";
const NORMALIZATION_POLICY = Object.freeze({
  unicode: "NFKC",
  whitespace: "trim-collapse",
  lookupCase: "lowercase"
});

export async function loadReviewedTechnicalTerms({ extractPath, sourceLockPath }) {
  const [extractBytes, lockText] = await Promise.all([
    readFile(resolveRequiredPath(extractPath, "reviewed extractPath")),
    readFile(resolveRequiredPath(sourceLockPath, "reviewed sourceLockPath"), "utf8")
  ]);
  const lock = validateReviewedTechnicalSourceLock(JSON.parse(lockText));
  verifyReviewedLockedExtract(lock, extractBytes);
  const extract = validateReviewedTechnicalExtract(
    JSON.parse(extractBytes.toString("utf8")),
    lock
  );
  return { lock, extract, records: buildReviewedTechnicalRecords(extract, lock) };
}

export function deriveReviewedTechnicalSourceLock(extractBytes, templateLock) {
  const bytes = toBytes(extractBytes);
  let extract;
  try {
    extract = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error("reviewed technical extract must be valid JSON", { cause: error });
  }
  if (!templateLock || typeof templateLock !== "object" || Array.isArray(templateLock)) {
    throw new Error("reviewed technical source lock template must be an object");
  }
  if (!templateLock.source || typeof templateLock.source !== "object") {
    throw new Error("reviewed technical source lock template source is required");
  }
  if (!Array.isArray(extract?.terms)) {
    throw new Error("reviewed technical extract terms are required");
  }

  const derived = structuredClone(templateLock);
  derived.source.extractSha256 = sha256Bytes(bytes);
  derived.source.extractSize = bytes.byteLength;
  derived.source.snapshot = structuredClone(extract.snapshot);
  derived.termIds = extract.terms.map((term) => term?.id);
  validateReviewedTechnicalSourceLock(derived);
  validateReviewedTechnicalExtract(extract, derived);
  return derived;
}

export function verifyReviewedTechnicalSourceLockBytes(lock, extractBytes) {
  const expected = deriveReviewedTechnicalSourceLock(extractBytes, lock);
  if (stableJson(expected) !== stableJson(lock)) {
    throw new Error("reviewed technical source lock does not match extract bytes");
  }
  return true;
}

export function validateReviewedTechnicalSourceLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
    throw new Error("reviewed technical source lock must be an object");
  }
  assertAllowedFields(lock, [
    "schemaVersion", "formatVersion", "readerMinVersion", "normalizationVersion",
    "source", "policy", "termIds"
  ], "reviewed technical source lock");
  if (lock.schemaVersion !== 1) throw new Error("reviewed technical source lock schemaVersion must be 1");
  if (lock.formatVersion !== TFLEX_FORMAT_VERSION) throw new Error("reviewed technical source lock formatVersion is incompatible");
  if (lock.readerMinVersion !== TFLEX_READER_MIN_VERSION) throw new Error("reviewed technical source lock readerMinVersion is incompatible");
  if (lock.normalizationVersion !== TFLEX_NORMALIZATION_VERSION) throw new Error("reviewed technical source lock normalizationVersion is incompatible");

  const source = lock.source;
  if (!source || source.id !== REVIEWED_TECH_SOURCE_ID) {
    throw new Error("reviewed technical source lock source id is incompatible");
  }
  assertAllowedFields(source, [
    "id", "version", "extractPath", "extractSha256", "extractSize", "snapshot", "license"
  ], "reviewed technical source");
  for (const key of ["version", "extractPath"]) requireText(source[key], "reviewed source " + key);
  requireSha256(source.extractSha256, "reviewed source extractSha256");
  assertPositiveInteger(source.extractSize, "reviewed source extractSize");
  validateSnapshot(source.snapshot, "reviewed source snapshot");

  if (source.license?.id !== REVIEWED_LICENSE_ID) {
    throw new Error("reviewed technical source license id is incompatible");
  }
  assertAllowedFields(source.license, ["id", "name", "source", "notice"], "reviewed source license");
  for (const key of ["name", "source", "notice"]) {
    requireText(source.license[key], "reviewed source license " + key);
  }

  validateReviewedPolicy(lock.policy);
  validateTermIds(lock.termIds);
  return lock;
}

export function validateReviewedTechnicalExtract(extract, lock) {
  if (!extract || typeof extract !== "object" || Array.isArray(extract)) {
    throw new Error("reviewed technical extract must be an object");
  }
  assertAllowedFields(extract, ["schemaVersion", "source", "license", "snapshot", "terms"], "reviewed technical extract");
  if (extract.schemaVersion !== 1) throw new Error("reviewed technical extract schemaVersion must be 1");
  if (extract.source !== REVIEWED_SOURCE_NAME) {
    throw new Error("reviewed technical extract source is incompatible");
  }
  if (extract.license !== REVIEWED_LICENSE_ID) {
    throw new Error("reviewed technical extract license is incompatible");
  }
  validateSnapshot(extract.snapshot, "reviewed technical extract snapshot");
  for (const key of ["kind", "version", "lockedAt", "extractRuleVersion"]) {
    if (extract.snapshot[key] !== lock.source.snapshot[key]) {
      throw new Error("reviewed technical snapshot mismatch: " + key);
    }
  }

  if (!Array.isArray(extract.terms) || extract.terms.length !== lock.termIds.length) {
    throw new Error("reviewed technical term set does not match source lock");
  }
  const actualIds = [];
  for (const term of extract.terms) {
    validateReviewedTerm(term, lock.policy);
    actualIds.push(term.id);
  }
  if (JSON.stringify(actualIds) !== JSON.stringify(lock.termIds)) {
    throw new Error("reviewed technical term ids do not match source lock");
  }
  validateReviewedTermCollisions(extract.terms, lock.policy);
  return extract;
}

export function buildReviewedTechnicalRecords(extract, lock) {
  validateReviewedTechnicalExtract(extract, lock);
  const blocked = new Set(lock.policy.blockedAliases.map(normalizeLookupKey));
  const records = extract.terms.map((term) => {
    const displayForm = normalizeExactLookupKey(term.headword);
    const lookupKey = normalizeLookupKey(displayForm);
    const exactLookupKeys = new Set([displayForm]);
    const aliases = [];
    for (const value of term.aliases) {
      const alias = normalizeExactLookupKey(value);
      const aliasKey = normalizeLookupKey(alias);
      if (!alias || blocked.has(aliasKey)) continue;
      if (aliasKey === lookupKey) exactLookupKeys.add(alias);
      else aliases.push(alias);
    }
    return {
      lookupKey,
      exactLookupKeys: uniqueSorted([...exactLookupKeys]),
      displayForm,
      kind: "technical-concept",
      aliases: uniqueSorted(aliases),
      entityId: "reviewed:" + term.id,
      translations: uniqueSorted(term.translations.map(normalizeExactLookupKey).filter(Boolean)),
      typeLabels: uniqueSorted(term.typeLabels.map(normalizeExactLookupKey).filter(Boolean)),
      domains: uniqueSorted(term.domains.map(normalizeLookupKey).filter(Boolean)),
      sourceRefs: [{ sourceId: REVIEWED_TECH_SOURCE_ID, recordId: term.id }]
    };
  });
  return records.sort((a, b) => compareText(a.lookupKey, b.lookupKey));
}

export function mergeReviewedTechnicalRecords(baseRecords, reviewedRecords, reviewedPolicy) {
  validateReviewedPolicy(reviewedPolicy);
  const allowed = new Map(reviewedPolicy.collisionPolicy.allowedHeadwordCollisions
    .map((entry) => [entry.lookupKey, entry]));
  const usedAllowlist = new Set();
  const merged = new Map();
  for (const record of baseRecords) {
    if (merged.has(record.lookupKey)) throw new Error("duplicate base technical lookupKey: " + record.lookupKey);
    merged.set(record.lookupKey, cloneRecord(record));
  }

  for (const reviewed of reviewedRecords) {
    const current = merged.get(reviewed.lookupKey);
    if (!current) {
      merged.set(reviewed.lookupKey, cloneRecord(reviewed));
      continue;
    }
    const rule = allowed.get(reviewed.lookupKey);
    if (!rule || rule.strategy !== "attach-reviewed-sense") {
      throw new Error("unapproved reviewed technical headword collision: " + reviewed.lookupKey);
    }
    if (current.entityId !== rule.baseRecordId ||
        !current.sourceRefs?.some((ref) => ref.sourceId === rule.baseSourceId)) {
      throw new Error("reviewed technical collision base identity drift: " + reviewed.lookupKey);
    }
    if (current.displayForm !== reviewed.displayForm ||
        stableJson(uniqueSorted(current.exactLookupKeys || [])) !== stableJson(reviewed.exactLookupKeys) ||
        stableJson(uniqueSorted(current.aliases || [])) !== stableJson(reviewed.aliases)) {
      throw new Error("reviewed technical collision lookup metadata drift: " + reviewed.lookupKey);
    }
    current.senses = [...(current.senses || []), reviewedSense(reviewed)];
    usedAllowlist.add(reviewed.lookupKey);
  }

  for (const key of allowed.keys()) {
    if (!usedAllowlist.has(key)) {
      throw new Error("unused reviewed technical headword collision allowlist entry: " + key);
    }
  }
  return [...merged.values()].sort((a, b) => compareText(a.lookupKey, b.lookupKey));
}

export function isReviewedTechnicalRecord(record) {
  return String(record?.entityId || "").startsWith("reviewed:") &&
    record?.sourceRefs?.some((ref) => ref.sourceId === REVIEWED_TECH_SOURCE_ID);
}

export function reviewedTechnicalManifestSource(lock) {
  return {
    id: REVIEWED_TECH_SOURCE_ID,
    version: lock.source.version,
    provenance: "TranslateFlow project-reviewed factual terminology",
    dataSha256: lock.source.extractSha256,
    dataUrl: lock.source.extractPath,
    snapshot: { ...lock.source.snapshot },
    license: {
      id: lock.source.license.id,
      name: lock.source.license.name,
      source: lock.source.license.source
    }
  };
}

export function reviewedTechnicalNotice(lock) {
  return [
    "=== TranslateFlow reviewed technical terminology ===",
    "Source extract: " + lock.source.extractPath,
    "Snapshot: " + lock.source.snapshot.kind + " / " + lock.source.snapshot.version,
    "Review rule version: " + lock.source.snapshot.extractRuleVersion,
    "License: " + lock.source.license.name + " [" + lock.source.license.id + "]",
    "License source: " + lock.source.license.source,
    "",
    lock.source.license.notice.trim(),
    ""
  ].join("\n");
}

export function verifyReviewedLockedExtract(lock, bytes) {
  const value = toBytes(bytes);
  if (value.byteLength !== lock.source.extractSize) {
    throw new Error("reviewed technical extract size mismatch");
  }
  const actual = sha256Bytes(value);
  if (actual !== lock.source.extractSha256.toLowerCase()) {
    throw new Error("reviewed technical extract SHA-256 mismatch");
  }
  return actual;
}

function validateReviewedPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("reviewed technical policy is required");
  }
  assertAllowedFields(policy, [
    "normalization", "blockedAliases", "caseSensitiveAliases", "collisionPolicy",
    "maxAliasesPerTerm", "maxTranslationsPerTerm", "maxDomainsPerTerm",
    "maxTypeLabelsPerTerm", "maxEvidenceUrlsPerTerm"
  ], "reviewed technical policy");
  if (stableJson(policy.normalization) !== stableJson(NORMALIZATION_POLICY)) {
    throw new Error("reviewed technical normalization policy is incompatible");
  }
  validatePolicyList(policy.blockedAliases, "reviewed blockedAliases", normalizeLookupKey);
  validatePolicyList(policy.caseSensitiveAliases, "reviewed caseSensitiveAliases", normalizeExactLookupKey);
  const blocked = new Set(policy.blockedAliases.map(normalizeLookupKey));
  for (const alias of policy.caseSensitiveAliases) {
    if (blocked.has(normalizeLookupKey(alias))) {
      throw new Error("reviewed alias cannot be both blocked and case-sensitive: " + alias);
    }
  }
  validateCollisionPolicy(policy.collisionPolicy);
  for (const key of [
    "maxAliasesPerTerm", "maxTranslationsPerTerm", "maxDomainsPerTerm",
    "maxTypeLabelsPerTerm", "maxEvidenceUrlsPerTerm"
  ]) assertPositiveInteger(policy[key], "reviewed policy " + key);
}

function validateCollisionPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("reviewed technical collision policy is required");
  }
  assertAllowedFields(policy, [
    "aliasToHeadword", "aliasToAlias", "headwordToHeadword", "allowedHeadwordCollisions"
  ], "reviewed technical collision policy");
  if (policy.aliasToHeadword !== "reject" || policy.aliasToAlias !== "reject" ||
      policy.headwordToHeadword !== "reject-unless-allowlisted") {
    throw new Error("reviewed technical collision policy is incompatible");
  }
  if (!Array.isArray(policy.allowedHeadwordCollisions)) {
    throw new Error("reviewed allowedHeadwordCollisions are required");
  }
  let previous = "";
  for (const entry of policy.allowedHeadwordCollisions) {
    assertAllowedFields(entry, [
      "lookupKey", "baseSourceId", "baseRecordId", "strategy"
    ], "reviewed headword collision entry");
    for (const key of ["lookupKey", "baseSourceId", "baseRecordId"]) {
      requireText(entry[key], "reviewed collision " + key);
    }
    if (normalizeLookupKey(entry.lookupKey) !== entry.lookupKey) {
      throw new Error("reviewed collision lookupKey is not normalized");
    }
    if (entry.strategy !== "attach-reviewed-sense") {
      throw new Error("reviewed collision strategy is incompatible");
    }
    if (previous && previous >= entry.lookupKey) {
      throw new Error("reviewed headword collision allowlist must be sorted and unique");
    }
    previous = entry.lookupKey;
  }
}

function validateTermIds(termIds) {
  if (!Array.isArray(termIds) || !termIds.length) {
    throw new Error("reviewed technical termIds are required");
  }
  let previous = "";
  for (const id of termIds) {
    requireTermId(id);
    if (previous && previous >= id) {
      throw new Error("reviewed technical termIds must be sorted and unique");
    }
    previous = id;
  }
}

function validateReviewedTerm(term, policy) {
  if (!term || typeof term !== "object" || Array.isArray(term)) {
    throw new Error("malformed reviewed technical term");
  }
  assertAllowedFields(term, [
    "id", "headword", "aliases", "translations", "domains", "typeLabels", "evidenceUrls"
  ], "reviewed technical term");
  requireTermId(term.id);
  requireText(term.headword, "reviewed term headword");
  assertDataOnly(term.headword, "reviewed term headword");
  if (!normalizeLookupKey(term.headword)) throw new Error("reviewed term headword normalizes to empty");
  validateStringArray(term.aliases, "reviewed term aliases", policy.maxAliasesPerTerm, false);
  validateStringArray(term.translations, "reviewed term translations", policy.maxTranslationsPerTerm, true);
  validateStringArray(term.domains, "reviewed term domains", policy.maxDomainsPerTerm, true);
  validateStringArray(term.typeLabels, "reviewed term typeLabels", policy.maxTypeLabelsPerTerm, true);
  validateEvidenceUrls(term.evidenceUrls, policy.maxEvidenceUrlsPerTerm);
}

function validateReviewedTermCollisions(terms, policy) {
  const headwords = new Map();
  const aliases = new Map();
  const blocked = new Set(policy.blockedAliases.map(normalizeLookupKey));
  for (const term of terms) {
    const headword = normalizeLookupKey(term.headword);
    if (headwords.has(headword)) throw new Error("duplicate reviewed technical headword: " + headword);
    headwords.set(headword, term.id);
    for (const value of term.aliases) {
      const alias = normalizeLookupKey(value);
      if (!alias || blocked.has(alias) || alias === headword) continue;
      if (!aliases.has(alias)) aliases.set(alias, new Set());
      aliases.get(alias).add(term.id);
    }
  }
  for (const [alias, ids] of aliases) {
    if (headwords.has(alias)) throw new Error("reviewed alias collides with a headword: " + alias);
    if (ids.size > 1) throw new Error("reviewed alias collides across terms: " + alias);
  }
}

function reviewedSense(record) {
  return {
    id: record.entityId,
    translations: [...record.translations],
    domains: [...record.domains],
    typeLabels: [...record.typeLabels],
    sourceRefs: record.sourceRefs.map((ref) => ({ ...ref }))
  };
}

function cloneRecord(record) {
  return {
    ...record,
    exactLookupKeys: [...(record.exactLookupKeys || [])],
    aliases: [...(record.aliases || [])],
    translations: [...(record.translations || [])],
    domains: [...(record.domains || [])],
    typeLabels: [...(record.typeLabels || [])],
    sourceRefs: (record.sourceRefs || []).map((ref) => ({ ...ref })),
    ...(Array.isArray(record.senses) ? {
      senses: record.senses.map((sense) => ({
        ...sense,
        translations: [...(sense.translations || [])],
        domains: [...(sense.domains || [])],
        typeLabels: [...(sense.typeLabels || [])],
        sourceRefs: (sense.sourceRefs || []).map((ref) => ({ ...ref }))
      }))
    } : {})
  };
}

function validateStringArray(values, label, max, requireNonEmpty) {
  if (!Array.isArray(values) || (requireNonEmpty && !values.length) || values.length > max) {
    throw new Error(label + " are invalid");
  }
  const seen = new Set();
  for (const value of values) {
    requireText(value, label + " value");
    assertDataOnly(value, label + " value");
    if (seen.has(value)) throw new Error("duplicate " + label + " value: " + value);
    seen.add(value);
  }
}

function validateEvidenceUrls(values, max) {
  if (!Array.isArray(values) || !values.length || values.length > max) {
    throw new Error("reviewed term evidenceUrls are invalid");
  }
  for (const value of values) {
    requireText(value, "reviewed term evidence URL");
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("reviewed term evidence URL must use HTTPS");
    if (url.username || url.password) throw new Error("reviewed term evidence URL must not contain credentials");
  }
}

function validateSnapshot(snapshot, label) {
  if (!snapshot || snapshot.kind !== "reviewed-term-set") throw new Error(label + " kind is incompatible");
  assertAllowedFields(snapshot, ["kind", "version", "lockedAt", "extractRuleVersion"], label);
  for (const key of ["version", "lockedAt"]) requireText(snapshot[key], label + " " + key);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(snapshot.lockedAt)) {
    throw new Error(label + " lockedAt must be an exact UTC timestamp");
  }
  assertPositiveInteger(snapshot.extractRuleVersion, label + " extractRuleVersion");
}

function validatePolicyList(values, label, normalize) {
  if (!Array.isArray(values)) throw new Error(label + " must be an array");
  let previous = "";
  for (const value of values) {
    requireText(value, label + " value");
    const normalized = normalize(value);
    if (!normalized || normalized !== value) throw new Error(label + " must contain normalized values");
    if (previous && previous >= value) throw new Error(label + " must be sorted and unique");
    previous = value;
  }
}

function assertAllowedFields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " must be an object");
  const names = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!names.has(key)) throw new Error("unsupported " + label + " field: " + key);
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareText);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function requireTermId(value) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value)) {
    throw new Error("invalid reviewed technical term id");
  }
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
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(label + " must be a SHA-256 hex digest");
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(label + " must be a positive integer");
}

function resolveRequiredPath(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required");
  return resolve(value);
}

function toBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(value);
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return "{" + Object.keys(value).sort(compareText)
    .map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
}

function parseCliArgs(argv) {
  const mode = argv[0];
  if (!["--generate-lock", "--verify-lock"].includes(mode)) {
    throw new Error("usage: reviewed-tech-terms.mjs (--generate-lock|--verify-lock) --extract PATH --source-lock PATH");
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("invalid reviewed source-lock CLI arguments");
    }
    values[key.slice(2)] = value;
  }
  return { mode, extractPath: values.extract, sourceLockPath: values["source-lock"] };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const extractPath = resolveRequiredPath(args.extractPath, "--extract");
  const sourceLockPath = resolveRequiredPath(args.sourceLockPath, "--source-lock");
  const [bytes, lockText] = await Promise.all([
    readFile(extractPath),
    readFile(sourceLockPath, "utf8")
  ]);
  const lock = JSON.parse(lockText);
  if (args.mode === "--verify-lock") {
    verifyReviewedTechnicalSourceLockBytes(lock, bytes);
    process.stdout.write("reviewed technical source lock verified\n");
    return;
  }
  const generated = deriveReviewedTechnicalSourceLock(bytes, lock);
  await writeFile(sourceLockPath, JSON.stringify(generated, null, 2) + "\n", "utf8");
  process.stdout.write("reviewed technical source lock generated\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
