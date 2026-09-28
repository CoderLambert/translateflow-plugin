import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  TFLEX_FORMAT_VERSION,
  TFLEX_NORMALIZATION_VERSION,
  TFLEX_READER_MIN_VERSION,
  normalizeExactLookupKey,
  normalizeLookupKey
} from "./build-tflex-core.mjs";

export const REVIEWED_TECH_SOURCE_ID = "translateflow-reviewed-technical-terms";

export async function loadReviewedTechnicalTerms({
  extractPath,
  sourceLockPath
}) {
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
  return {
    lock,
    extract,
    records: buildReviewedTechnicalRecords(extract, lock)
  };
}

export function validateReviewedTechnicalSourceLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
    throw new Error("reviewed technical source lock must be an object");
  }
  if (lock.schemaVersion !== 1) throw new Error("reviewed technical source lock schemaVersion must be 1");
  if (lock.formatVersion !== TFLEX_FORMAT_VERSION) throw new Error("reviewed technical source lock formatVersion is incompatible");
  if (lock.readerMinVersion !== TFLEX_READER_MIN_VERSION) throw new Error("reviewed technical source lock readerMinVersion is incompatible");
  if (lock.normalizationVersion !== TFLEX_NORMALIZATION_VERSION) throw new Error("reviewed technical source lock normalizationVersion is incompatible");

  const source = lock.source;
  if (!source || source.id !== REVIEWED_TECH_SOURCE_ID) {
    throw new Error("reviewed technical source lock source id is incompatible");
  }
  for (const key of ["version", "extractPath"]) requireText(source[key], "reviewed source " + key);
  requireSha256(source.extractSha256, "reviewed source extractSha256");
  assertPositiveInteger(source.extractSize, "reviewed source extractSize");
  validateSnapshot(source.snapshot, "reviewed source snapshot");

  if (source.license?.id !== "LicenseRef-TranslateFlow-Reviewed-Terms") {
    throw new Error("reviewed technical source license id is incompatible");
  }
  for (const key of ["name", "source", "notice"]) {
    requireText(source.license?.[key], "reviewed source license " + key);
  }

  const policy = lock.policy;
  if (!policy || typeof policy !== "object") throw new Error("reviewed technical policy is required");
  for (const key of [
    "maxAliasesPerTerm",
    "maxTranslationsPerTerm",
    "maxDomainsPerTerm",
    "maxTypeLabelsPerTerm",
    "maxEvidenceUrlsPerTerm"
  ]) {
    assertPositiveInteger(policy[key], "reviewed policy " + key);
  }

  if (!Array.isArray(lock.termIds) || !lock.termIds.length) {
    throw new Error("reviewed technical termIds are required");
  }
  let previous = "";
  const seen = new Set();
  for (const id of lock.termIds) {
    requireTermId(id);
    if (seen.has(id)) throw new Error("duplicate reviewed technical term id: " + id);
    if (previous && previous >= id) throw new Error("reviewed technical termIds must be sorted");
    seen.add(id);
    previous = id;
  }
  return lock;
}

export function validateReviewedTechnicalExtract(extract, lock) {
  if (!extract || typeof extract !== "object" || Array.isArray(extract)) {
    throw new Error("reviewed technical extract must be an object");
  }
  if (extract.schemaVersion !== 1) throw new Error("reviewed technical extract schemaVersion must be 1");
  if (extract.source !== "TranslateFlow reviewed technical terminology") {
    throw new Error("reviewed technical extract source is incompatible");
  }
  if (extract.license !== "LicenseRef-TranslateFlow-Reviewed-Terms") {
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
  return extract;
}

export function buildReviewedTechnicalRecords(extract, lock) {
  validateReviewedTechnicalExtract(extract, lock);
  return extract.terms.map((term) => {
    const displayForm = normalizeExactLookupKey(term.headword);
    const lookupKey = normalizeLookupKey(displayForm);
    return {
      lookupKey,
      exactLookupKeys: [displayForm],
      displayForm,
      kind: "technical-concept",
      aliases: uniqueSorted(term.aliases.map(normalizeExactLookupKey).filter(Boolean)),
      entityId: "reviewed:" + term.id,
      translations: uniqueSorted(term.translations.map(normalizeExactLookupKey).filter(Boolean)),
      typeLabels: uniqueSorted(term.typeLabels.map(normalizeExactLookupKey).filter(Boolean)),
      domains: uniqueSorted(term.domains.map(normalizeLookupKey).filter(Boolean)),
      sourceRefs: [{ sourceId: REVIEWED_TECH_SOURCE_ID, recordId: term.id }]
    };
  }).sort((a, b) => compareText(a.lookupKey, b.lookupKey));
}

export function mergeReviewedTechnicalRecords(baseRecords, reviewedRecords) {
  const merged = new Map();
  for (const record of baseRecords) merged.set(record.lookupKey, cloneRecord(record));

  for (const reviewed of reviewedRecords) {
    const current = merged.get(reviewed.lookupKey);
    if (!current) {
      merged.set(reviewed.lookupKey, cloneRecord(reviewed));
      continue;
    }
    current.exactLookupKeys = uniqueSorted([
      ...(current.exactLookupKeys || []),
      ...(reviewed.exactLookupKeys || [])
    ]);
    current.aliases = uniqueSorted([...(current.aliases || []), ...(reviewed.aliases || [])]);
    current.translations = uniqueSorted([
      ...(current.translations || []),
      ...(reviewed.translations || [])
    ]);
    current.domains = uniqueSorted([...(current.domains || []), ...(reviewed.domains || [])]);
    current.typeLabels = uniqueSorted([
      ...(current.typeLabels || []),
      ...(reviewed.typeLabels || [])
    ]);
    current.sourceRefs = dedupeSourceRefs([
      ...(current.sourceRefs || []),
      ...(reviewed.sourceRefs || [])
    ]);
  }

  return [...merged.values()].sort((a, b) => compareText(a.lookupKey, b.lookupKey));
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
    "",
    lock.source.license.notice.trim(),
    ""
  ].join("\n");
}

function validateReviewedTerm(term, policy) {
  if (!term || typeof term !== "object" || Array.isArray(term)) {
    throw new Error("malformed reviewed technical term");
  }
  const allowed = new Set([
    "id", "headword", "aliases", "translations", "domains", "typeLabels", "evidenceUrls"
  ]);
  for (const key of Object.keys(term)) {
    if (!allowed.has(key)) throw new Error("unsupported reviewed technical term field: " + key);
  }

  requireTermId(term.id);
  requireText(term.headword, "reviewed term headword");
  assertDataOnly(term.headword, "reviewed term headword");
  validateStringArray(term.aliases, "reviewed term aliases", policy.maxAliasesPerTerm, false);
  validateStringArray(term.translations, "reviewed term translations", policy.maxTranslationsPerTerm, true);
  validateStringArray(term.domains, "reviewed term domains", policy.maxDomainsPerTerm, true);
  validateStringArray(term.typeLabels, "reviewed term typeLabels", policy.maxTypeLabelsPerTerm, true);
  validateEvidenceUrls(term.evidenceUrls, policy.maxEvidenceUrlsPerTerm);
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
  for (const key of ["version", "lockedAt"]) requireText(snapshot[key], label + " " + key);
  assertPositiveInteger(snapshot.extractRuleVersion, label + " extractRuleVersion");
}

function verifyReviewedLockedExtract(lock, bytes) {
  if (bytes.byteLength !== lock.source.extractSize) {
    throw new Error("reviewed technical extract size mismatch");
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== lock.source.extractSha256.toLowerCase()) {
    throw new Error("reviewed technical extract SHA-256 mismatch");
  }
}

function cloneRecord(record) {
  return {
    ...record,
    exactLookupKeys: [...(record.exactLookupKeys || [])],
    aliases: [...(record.aliases || [])],
    translations: [...(record.translations || [])],
    domains: [...(record.domains || [])],
    typeLabels: [...(record.typeLabels || [])],
    sourceRefs: (record.sourceRefs || []).map((ref) => ({ ...ref }))
  };
}

function dedupeSourceRefs(values) {
  const seen = new Set();
  const result = [];
  for (const ref of values) {
    const key = String(ref?.sourceId || "") + "\u0000" + String(ref?.recordId || "");
    if (!ref?.sourceId || !ref?.recordId || seen.has(key)) continue;
    seen.add(key);
    result.push({ sourceId: ref.sourceId, recordId: ref.recordId });
  }
  return result.sort((a, b) =>
    compareText(a.sourceId, b.sourceId) || compareText(a.recordId, b.recordId)
  );
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
