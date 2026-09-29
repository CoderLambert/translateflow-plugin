#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ID = "kaikki-enwiktionary-raw";
const SOURCE_URL = "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz";
const SOURCE_FORMAT = "wiktextract-jsonl-gzip";
const SOURCE_ROLE = "rich-en-zh-poc-input";
const POC_REUSE_LICENSE = "CC-BY-SA-4.0";
const SOURCE_LICENSES = Object.freeze(["CC-BY-SA-4.0", "GFDL-1.1-or-later"]);

export function validateKaikkiCandidate(candidate) {
  requireObject(candidate, "Kaikki candidate");
  assertAllowedFields(candidate, [
    "schemaVersion", "status", "sourceId", "role", "edition", "dumpDate",
    "extractedAt", "rawDataUrl", "rawDataUrlMutable", "format",
    "advertisedSize", "extractor", "evidence", "license", "packaging"
  ], "Kaikki candidate");

  if (candidate.schemaVersion !== 1) throw new Error("Kaikki candidate schemaVersion must be 1");
  if (candidate.status !== "candidate-unlocked") {
    throw new Error("Kaikki candidate must remain explicitly unlocked");
  }
  if (candidate.sourceId !== SOURCE_ID || candidate.role !== SOURCE_ROLE) {
    throw new Error("Kaikki candidate source identity is incompatible");
  }
  if (candidate.edition !== "enwiktionary") throw new Error("Kaikki candidate edition must be enwiktionary");
  requireDate(candidate.dumpDate, "Kaikki dumpDate");
  requireDate(candidate.extractedAt, "Kaikki extractedAt");
  if (candidate.rawDataUrl !== SOURCE_URL || candidate.rawDataUrlMutable !== true) {
    throw new Error("Kaikki candidate must identify the reviewed mutable raw-data URL");
  }
  requireHttpsUrl(candidate.rawDataUrl, "Kaikki rawDataUrl");
  if (candidate.format !== SOURCE_FORMAT) throw new Error("Kaikki candidate format is incompatible");

  requireObject(candidate.advertisedSize, "Kaikki advertisedSize");
  assertAllowedFields(candidate.advertisedSize, ["compressed", "uncompressed"], "Kaikki advertisedSize");
  requireText(candidate.advertisedSize.compressed, "Kaikki advertised compressed size");
  requireText(candidate.advertisedSize.uncompressed, "Kaikki advertised uncompressed size");

  validateExtractor(candidate.extractor);
  validateEvidence(candidate.evidence);
  validateLicense(candidate.license);
  validatePackaging(candidate.packaging);
  return candidate;
}

export async function deriveKaikkiSourceLock({ candidate, sourcePath }) {
  const reviewed = validateKaikkiCandidate(candidate);
  const artifact = await digestFile(requiredPath(sourcePath, "sourcePath"));
  return validateKaikkiSourceLock({
    schemaVersion: 1,
    status: "locked",
    sourceId: reviewed.sourceId,
    role: reviewed.role,
    edition: reviewed.edition,
    dumpDate: reviewed.dumpDate,
    extractedAt: reviewed.extractedAt,
    source: {
      url: reviewed.rawDataUrl,
      urlMutable: reviewed.rawDataUrlMutable,
      format: reviewed.format,
      extractor: structuredClone(reviewed.extractor)
    },
    artifact: {
      filename: basename(new URL(reviewed.rawDataUrl).pathname),
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes
    },
    evidence: structuredClone(reviewed.evidence),
    license: structuredClone(reviewed.license),
    packaging: structuredClone(reviewed.packaging)
  });
}

export function validateKaikkiSourceLock(lock) {
  requireObject(lock, "Kaikki source lock");
  assertAllowedFields(lock, [
    "schemaVersion", "status", "sourceId", "role", "edition", "dumpDate",
    "extractedAt", "source", "artifact", "evidence", "license", "packaging"
  ], "Kaikki source lock");

  if (lock.schemaVersion !== 1) throw new Error("Kaikki source lock schemaVersion must be 1");
  if (lock.status !== "locked") throw new Error("Kaikki source lock status must be locked");
  if (lock.sourceId !== SOURCE_ID || lock.role !== SOURCE_ROLE) {
    throw new Error("Kaikki source lock identity is incompatible");
  }
  if (lock.edition !== "enwiktionary") throw new Error("Kaikki source lock edition must be enwiktionary");
  requireDate(lock.dumpDate, "Kaikki source lock dumpDate");
  requireDate(lock.extractedAt, "Kaikki source lock extractedAt");

  requireObject(lock.source, "Kaikki locked source");
  assertAllowedFields(lock.source, ["url", "urlMutable", "format", "extractor"], "Kaikki locked source");
  if (lock.source.url !== SOURCE_URL || lock.source.urlMutable !== true) {
    throw new Error("Kaikki source lock must retain the reviewed mutable source URL warning");
  }
  if (lock.source.format !== SOURCE_FORMAT) throw new Error("Kaikki locked source format is incompatible");
  validateExtractor(lock.source.extractor);

  requireObject(lock.artifact, "Kaikki locked artifact");
  assertAllowedFields(lock.artifact, ["filename", "sha256", "sizeBytes"], "Kaikki locked artifact");
  if (lock.artifact.filename !== "raw-wiktextract-data.jsonl.gz") {
    throw new Error("Kaikki locked artifact filename is incompatible");
  }
  requireSha256(lock.artifact.sha256, "Kaikki artifact SHA-256");
  requirePositiveInteger(lock.artifact.sizeBytes, "Kaikki artifact size");

  validateEvidence(lock.evidence);
  validateLicense(lock.license);
  validatePackaging(lock.packaging);

  if ("approvedForOfficialPack" in lock || "qualityDecision" in lock || "goNoGo" in lock) {
    throw new Error("Kaikki source lock must not imply a product approval decision");
  }
  return lock;
}

export async function verifyKaikkiSourceBytes(lock, sourcePath) {
  const reviewed = validateKaikkiSourceLock(lock);
  const actual = await digestFile(requiredPath(sourcePath, "sourcePath"));
  if (actual.sizeBytes !== reviewed.artifact.sizeBytes) {
    throw new Error(
      "Kaikki source size mismatch: expected " + reviewed.artifact.sizeBytes +
      ", got " + actual.sizeBytes
    );
  }
  if (actual.sha256 !== reviewed.artifact.sha256.toLowerCase()) {
    throw new Error("Kaikki source SHA-256 mismatch");
  }
  return actual;
}

async function digestFile(path) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    sizeBytes += chunk.byteLength;
    hash.update(chunk);
  }
  if (!sizeBytes) throw new Error("Kaikki source artifact must not be empty");
  return { sha256: hash.digest("hex"), sizeBytes };
}

function validateExtractor(extractor) {
  requireObject(extractor, "Kaikki extractor");
  assertAllowedFields(extractor, [
    "wiktextractRepository", "wiktextractCommit",
    "wikitextprocessorRepository", "wikitextprocessorCommit"
  ], "Kaikki extractor");
  if (extractor.wiktextractRepository !== "https://github.com/tatuylonen/wiktextract") {
    throw new Error("Kaikki wiktextract repository is incompatible");
  }
  if (extractor.wikitextprocessorRepository !== "https://github.com/tatuylonen/wikitextprocessor") {
    throw new Error("Kaikki wikitextprocessor repository is incompatible");
  }
  requireGitSha(extractor.wiktextractCommit, "Kaikki wiktextract commit");
  requireGitSha(extractor.wikitextprocessorCommit, "Kaikki wikitextprocessor commit");
}

function validateEvidence(evidence) {
  requireObject(evidence, "Kaikki evidence");
  assertAllowedFields(evidence, ["snapshotMetadata", "wiktionaryCopyright"], "Kaikki evidence");
  if (evidence.snapshotMetadata !== "https://kaikki.org/dictionary/rawdata.html") {
    throw new Error("Kaikki snapshot metadata evidence URL is incompatible");
  }
  if (evidence.wiktionaryCopyright !== "https://en.wiktionary.org/wiki/Wiktionary:Copyrights") {
    throw new Error("Wiktionary copyright evidence URL is incompatible");
  }
}

function validateLicense(license) {
  requireObject(license, "Kaikki license");
  assertAllowedFields(license, [
    "sourceLicenses", "pocReuseLicense", "attributionRequired",
    "shareAlikeRequired", "legalReviewStatus"
  ], "Kaikki license");
  if (JSON.stringify(license.sourceLicenses) !== JSON.stringify(SOURCE_LICENSES)) {
    throw new Error("Kaikki source license set is incompatible");
  }
  if (
    license.pocReuseLicense !== POC_REUSE_LICENSE ||
    license.attributionRequired !== true ||
    license.shareAlikeRequired !== true ||
    license.legalReviewStatus !== "pending-field-projection-audit"
  ) {
    throw new Error("Kaikki POC license gate is incomplete or overclaims approval");
  }
}

function validatePackaging(packaging) {
  requireObject(packaging, "Kaikki packaging");
  assertAllowedFields(packaging, [
    "rawInputRole", "productionExtensionEligible", "downloadablePackDecision"
  ], "Kaikki packaging");
  if (
    packaging.rawInputRole !== "build-only" ||
    packaging.productionExtensionEligible !== false ||
    packaging.downloadablePackDecision !== "pending-poc"
  ) {
    throw new Error("Kaikki source packaging boundary is incompatible");
  }
}

function assertAllowedFields(value, allowed, label) {
  const permitted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) throw new Error("unsupported " + label + " field: " + key);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object");
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required");
}

function requireDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(label + " must be YYYY-MM-DD");
  }
}

function requireGitSha(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(label + " must be a full Git commit SHA");
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(label + " must be a SHA-256 hex digest");
  }
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(label + " must be a positive integer");
  }
}

function requireHttpsUrl(value, label) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(label + " must be a credential-free HTTPS URL");
  }
}

function requiredPath(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required");
  return resolve(value);
}

function parseCliArgs(argv) {
  const mode = argv[0];
  if (!["--generate-lock", "--verify-lock"].includes(mode)) {
    throw new Error(
      "usage: lock-kaikki-source.mjs (--generate-lock|--verify-lock) " +
      "--source PATH --source-lock PATH [--candidate PATH]"
    );
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("invalid Kaikki source-lock CLI arguments");
    }
    values[key.slice(2)] = value;
  }
  return {
    mode,
    sourcePath: values.source,
    sourceLockPath: values["source-lock"],
    candidatePath: values.candidate
  };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const sourcePath = requiredPath(args.sourcePath, "--source");
  const sourceLockPath = requiredPath(args.sourceLockPath, "--source-lock");

  if (args.mode === "--verify-lock") {
    const lock = JSON.parse(await readFile(sourceLockPath, "utf8"));
    const verified = await verifyKaikkiSourceBytes(lock, sourcePath);
    process.stdout.write(
      "Kaikki source lock verified: " + verified.sizeBytes + " bytes, sha256:" +
      verified.sha256 + "\n"
    );
    return;
  }

  const candidatePath = requiredPath(args.candidatePath, "--candidate");
  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  const lock = await deriveKaikkiSourceLock({ candidate, sourcePath });
  await writeFile(sourceLockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
  process.stdout.write(
    "Kaikki source lock generated: " + lock.artifact.sizeBytes + " bytes, sha256:" +
    lock.artifact.sha256 + "\n"
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
