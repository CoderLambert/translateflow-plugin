#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readFile,
  writeFile
} from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ID =
  "wikimedia-enwiktionary-20260901";
const SOURCE_ROLE = "rich-en-zh-poc-raw-input";
const DUMP_DATE = "2026-09-01";
const DUMP_ROOT =
  "https://dumps.wikimedia.org/enwiktionary/20260901/";
const ARTIFACT_FILENAME =
  "enwiktionary-20260901-pages-articles.xml.bz2";
const ARTIFACT_URL =
  DUMP_ROOT + ARTIFACT_FILENAME;
const SHA1SUMS_URL = DUMP_ROOT + "sha1sums.txt";
const MD5SUMS_URL = DUMP_ROOT + "md5sums.txt";
const DUMP_STATUS_URL = DUMP_ROOT + "dumpstatus.json";
const SOURCE_FORMAT =
  "mediawiki-pages-articles-xml-bzip2";
const SOURCE_LICENSES = Object.freeze([
  "CC-BY-SA-4.0",
  "GFDL-1.1-or-later"
]);

export function validateWikimediaCandidate(candidate) {
  requireObject(candidate, "Wikimedia candidate");
  assertAllowedFields(
    candidate,
    [
      "schemaVersion",
      "status",
      "sourceId",
      "role",
      "edition",
      "dumpDate",
      "source",
      "extractor",
      "evidence",
      "license",
      "packaging"
    ],
    "Wikimedia candidate"
  );

  if (candidate.schemaVersion !== 1) {
    throw new Error(
      "Wikimedia candidate schemaVersion must be 1"
    );
  }
  if (candidate.status !== "candidate-unlocked") {
    throw new Error(
      "Wikimedia candidate must remain explicitly unlocked"
    );
  }
  if (
    candidate.sourceId !== SOURCE_ID ||
    candidate.role !== SOURCE_ROLE ||
    candidate.edition !== "enwiktionary" ||
    candidate.dumpDate !== DUMP_DATE
  ) {
    throw new Error(
      "Wikimedia candidate source identity is incompatible"
    );
  }

  validateSource(candidate.source);
  validateExtractor(candidate.extractor);
  validateEvidence(candidate.evidence);
  validateLicense(candidate.license);
  validatePackaging(candidate.packaging);
  return candidate;
}

export async function deriveWikimediaSourceLock({
  candidate,
  sourcePath,
  sha1sumsPath,
  md5sumsPath
}) {
  const reviewed =
    validateWikimediaCandidate(candidate);
  const [actual, sha1Text, md5Text] =
    await Promise.all([
      digestFile(requiredPath(sourcePath, "sourcePath")),
      readFile(
        requiredPath(sha1sumsPath, "sha1sumsPath"),
        "utf8"
      ),
      readFile(
        requiredPath(md5sumsPath, "md5sumsPath"),
        "utf8"
      )
    ]);

  const publishedSha1 = checksumForFile(
    sha1Text,
    ARTIFACT_FILENAME,
    40,
    "SHA-1"
  );
  const publishedMd5 = checksumForFile(
    md5Text,
    ARTIFACT_FILENAME,
    32,
    "MD5"
  );
  assertPublishedChecksums(
    actual,
    publishedSha1,
    publishedMd5
  );

  return validateWikimediaSourceLock({
    schemaVersion: 1,
    status: "locked",
    sourceId: reviewed.sourceId,
    role: reviewed.role,
    edition: reviewed.edition,
    dumpDate: reviewed.dumpDate,
    source: structuredClone(reviewed.source),
    extractor: structuredClone(reviewed.extractor),
    artifact: {
      filename: ARTIFACT_FILENAME,
      sizeBytes: actual.sizeBytes,
      sha256: actual.sha256,
      publishedSha1,
      publishedMd5
    },
    evidence: structuredClone(reviewed.evidence),
    license: structuredClone(reviewed.license),
    packaging: structuredClone(reviewed.packaging)
  });
}

export function validateWikimediaSourceLock(lock) {
  requireObject(lock, "Wikimedia source lock");
  assertAllowedFields(
    lock,
    [
      "schemaVersion",
      "status",
      "sourceId",
      "role",
      "edition",
      "dumpDate",
      "source",
      "extractor",
      "artifact",
      "evidence",
      "license",
      "packaging"
    ],
    "Wikimedia source lock"
  );

  if (lock.schemaVersion !== 1) {
    throw new Error(
      "Wikimedia source lock schemaVersion must be 1"
    );
  }
  if (lock.status !== "locked") {
    throw new Error(
      "Wikimedia source lock status must be locked"
    );
  }
  if (
    lock.sourceId !== SOURCE_ID ||
    lock.role !== SOURCE_ROLE ||
    lock.edition !== "enwiktionary" ||
    lock.dumpDate !== DUMP_DATE
  ) {
    throw new Error(
      "Wikimedia source lock identity is incompatible"
    );
  }

  validateSource(lock.source);
  validateExtractor(lock.extractor);

  requireObject(
    lock.artifact,
    "Wikimedia locked artifact"
  );
  assertAllowedFields(
    lock.artifact,
    [
      "filename",
      "sizeBytes",
      "sha256",
      "publishedSha1",
      "publishedMd5"
    ],
    "Wikimedia locked artifact"
  );
  if (lock.artifact.filename !== ARTIFACT_FILENAME) {
    throw new Error(
      "Wikimedia locked artifact filename is incompatible"
    );
  }
  requirePositiveInteger(
    lock.artifact.sizeBytes,
    "Wikimedia artifact size"
  );
  requireHex(
    lock.artifact.sha256,
    64,
    "Wikimedia artifact SHA-256"
  );
  requireHex(
    lock.artifact.publishedSha1,
    40,
    "Wikimedia published SHA-1"
  );
  requireHex(
    lock.artifact.publishedMd5,
    32,
    "Wikimedia published MD5"
  );

  validateEvidence(lock.evidence);
  validateLicense(lock.license);
  validatePackaging(lock.packaging);

  for (const forbidden of [
    "approvedForOfficialPack",
    "qualityDecision",
    "goNoGo",
    "projectionMetrics"
  ]) {
    if (forbidden in lock) {
      throw new Error(
        "Wikimedia source lock must not imply a product decision"
      );
    }
  }
  return lock;
}

export async function verifyWikimediaSourceBytes({
  lock,
  sourcePath,
  sha1sumsPath,
  md5sumsPath
}) {
  const reviewed =
    validateWikimediaSourceLock(lock);
  const [actual, sha1Text, md5Text] =
    await Promise.all([
      digestFile(requiredPath(sourcePath, "sourcePath")),
      readFile(
        requiredPath(sha1sumsPath, "sha1sumsPath"),
        "utf8"
      ),
      readFile(
        requiredPath(md5sumsPath, "md5sumsPath"),
        "utf8"
      )
    ]);

  const publishedSha1 = checksumForFile(
    sha1Text,
    ARTIFACT_FILENAME,
    40,
    "SHA-1"
  );
  const publishedMd5 = checksumForFile(
    md5Text,
    ARTIFACT_FILENAME,
    32,
    "MD5"
  );
  assertPublishedChecksums(
    actual,
    publishedSha1,
    publishedMd5
  );

  if (
    actual.sizeBytes !== reviewed.artifact.sizeBytes
  ) {
    throw new Error(
      "Wikimedia source size mismatch: expected " +
      reviewed.artifact.sizeBytes +
      ", got " +
      actual.sizeBytes
    );
  }
  if (
    actual.sha256 !==
    reviewed.artifact.sha256.toLowerCase()
  ) {
    throw new Error(
      "Wikimedia source SHA-256 mismatch"
    );
  }
  if (
    publishedSha1 !==
      reviewed.artifact.publishedSha1.toLowerCase() ||
    publishedMd5 !==
      reviewed.artifact.publishedMd5.toLowerCase()
  ) {
    throw new Error(
      "Wikimedia published checksum metadata drifted"
    );
  }
  return {
    ...actual,
    publishedSha1,
    publishedMd5
  };
}

function validateSource(source) {
  requireObject(source, "Wikimedia source");
  assertAllowedFields(
    source,
    [
      "directoryUrl",
      "artifactUrl",
      "sha1sumsUrl",
      "md5sumsUrl",
      "dumpStatusUrl",
      "format",
      "datedPath"
    ],
    "Wikimedia source"
  );
  if (
    source.directoryUrl !== DUMP_ROOT ||
    source.artifactUrl !== ARTIFACT_URL ||
    source.sha1sumsUrl !== SHA1SUMS_URL ||
    source.md5sumsUrl !== MD5SUMS_URL ||
    source.dumpStatusUrl !== DUMP_STATUS_URL ||
    source.format !== SOURCE_FORMAT ||
    source.datedPath !== true
  ) {
    throw new Error(
      "Wikimedia dated source configuration is incompatible"
    );
  }
  for (const [label, value] of [
    ["directory URL", source.directoryUrl],
    ["artifact URL", source.artifactUrl],
    ["SHA-1 manifest URL", source.sha1sumsUrl],
    ["MD5 manifest URL", source.md5sumsUrl],
    ["dump-status URL", source.dumpStatusUrl]
  ]) {
    requireHttpsUrl(value, "Wikimedia " + label);
  }
  if (
    basename(new URL(source.artifactUrl).pathname) !==
    ARTIFACT_FILENAME
  ) {
    throw new Error(
      "Wikimedia artifact URL filename is incompatible"
    );
  }
}

function validateExtractor(extractor) {
  requireObject(extractor, "Wikimedia extractor");
  assertAllowedFields(
    extractor,
    [
      "wiktextractRepository",
      "wiktextractCommit",
      "wikitextprocessorRepository",
      "wikitextprocessorCommit"
    ],
    "Wikimedia extractor"
  );
  if (
    extractor.wiktextractRepository !==
      "https://github.com/tatuylonen/wiktextract" ||
    extractor.wikitextprocessorRepository !==
      "https://github.com/tatuylonen/wikitextprocessor"
  ) {
    throw new Error(
      "Wikimedia extractor repositories are incompatible"
    );
  }
  requireGitSha(
    extractor.wiktextractCommit,
    "Wikimedia wiktextract commit"
  );
  requireGitSha(
    extractor.wikitextprocessorCommit,
    "Wikimedia wikitextprocessor commit"
  );
}

function validateEvidence(evidence) {
  requireObject(evidence, "Wikimedia evidence");
  assertAllowedFields(
    evidence,
    [
      "dumpIndex",
      "dumpDocumentation",
      "wiktionaryCopyright"
    ],
    "Wikimedia evidence"
  );
  if (
    evidence.dumpIndex !==
      "https://dumps.wikimedia.org/enwiktionary/" ||
    evidence.dumpDocumentation !==
      "https://meta.wikimedia.org/wiki/Data_dumps" ||
    evidence.wiktionaryCopyright !==
      "https://en.wiktionary.org/wiki/Wiktionary:Copyrights"
  ) {
    throw new Error(
      "Wikimedia source evidence URLs are incompatible"
    );
  }
}

function validateLicense(license) {
  requireObject(license, "Wikimedia license");
  assertAllowedFields(
    license,
    [
      "sourceLicenses",
      "pocReuseLicense",
      "attributionRequired",
      "shareAlikeRequired",
      "legalReviewStatus"
    ],
    "Wikimedia license"
  );
  if (
    JSON.stringify(license.sourceLicenses) !==
      JSON.stringify(SOURCE_LICENSES) ||
    license.pocReuseLicense !== "CC-BY-SA-4.0" ||
    license.attributionRequired !== true ||
    license.shareAlikeRequired !== true ||
    license.legalReviewStatus !==
      "pending-field-projection-audit"
  ) {
    throw new Error(
      "Wikimedia license gate is incomplete or overclaims approval"
    );
  }
}

function validatePackaging(packaging) {
  requireObject(packaging, "Wikimedia packaging");
  assertAllowedFields(
    packaging,
    [
      "rawInputRole",
      "productionExtensionEligible",
      "downloadablePackDecision"
    ],
    "Wikimedia packaging"
  );
  if (
    packaging.rawInputRole !== "build-only" ||
    packaging.productionExtensionEligible !== false ||
    packaging.downloadablePackDecision !==
      "pending-poc"
  ) {
    throw new Error(
      "Wikimedia packaging boundary is incompatible"
    );
  }
}

async function digestFile(path) {
  const hashes = {
    md5: createHash("md5"),
    sha1: createHash("sha1"),
    sha256: createHash("sha256")
  };
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    sizeBytes += chunk.byteLength;
    for (const hash of Object.values(hashes)) {
      hash.update(chunk);
    }
  }
  if (!sizeBytes) {
    throw new Error(
      "Wikimedia source artifact must not be empty"
    );
  }
  return {
    sizeBytes,
    md5: hashes.md5.digest("hex"),
    sha1: hashes.sha1.digest("hex"),
    sha256: hashes.sha256.digest("hex")
  };
}

function checksumForFile(
  text,
  filename,
  hexLength,
  label
) {
  const pattern = new RegExp(
    "^([a-f0-9]{" +
      hexLength +
      "})\\s+[*]?" +
      escapeRegex(filename) +
      "$",
    "imu"
  );
  const match = pattern.exec(String(text || ""));
  if (!match) {
    throw new Error(
      "Wikimedia " +
      label +
      " manifest does not contain the locked artifact"
    );
  }
  return match[1].toLowerCase();
}

function assertPublishedChecksums(
  actual,
  publishedSha1,
  publishedMd5
) {
  if (actual.sha1 !== publishedSha1) {
    throw new Error(
      "Wikimedia source does not match published SHA-1"
    );
  }
  if (actual.md5 !== publishedMd5) {
    throw new Error(
      "Wikimedia source does not match published MD5"
    );
  }
}

function assertAllowedFields(
  value,
  allowed,
  label
) {
  const permitted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) {
      throw new Error(
        "unsupported " + label + " field: " + key
      );
    }
  }
}

function requireObject(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(label + " must be an object");
  }
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      label + " must be a positive integer"
    );
  }
}

function requireHex(value, length, label) {
  if (
    typeof value !== "string" ||
    !new RegExp("^[a-f0-9]{" + length + "}$").test(
      value
    )
  ) {
    throw new Error(
      label + " must be a " + length + "-character hex digest"
    );
  }
}

function requireGitSha(value, label) {
  requireHex(value, 40, label);
}

function requireHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error(label + " must be a valid URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      label + " must be a credential-free HTTPS URL"
    );
  }
}

function requiredPath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is required");
  }
  return resolve(value);
}

function escapeRegex(value) {
  return String(value).replace(
    /[-/\\^$*+?.()|[\]{}]/gu,
    "\\$&"
  );
}

function parseCliArgs(argv) {
  const mode = argv[0];
  if (
    !["--derive-lock", "--verify-lock"].includes(mode)
  ) {
    throw new Error(
      "usage: audit-wikimedia-enwiktionary-source.mjs " +
      "(--derive-lock|--verify-lock) --candidate PATH " +
      "--source PATH --sha1sums PATH --md5sums PATH " +
      "(--out PATH|--lock PATH)"
    );
  }
  const values = {};
  for (
    let index = 1;
    index < argv.length;
    index += 2
  ) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key?.startsWith("--") ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error(
        "invalid Wikimedia source-audit CLI arguments"
      );
    }
    values[key.slice(2)] = value;
  }
  return { mode, values };
}

async function main() {
  const { mode, values } =
    parseCliArgs(process.argv.slice(2));
  const candidate = JSON.parse(
    await readFile(
      requiredPath(values.candidate, "--candidate"),
      "utf8"
    )
  );
  const common = {
    sourcePath: values.source,
    sha1sumsPath: values.sha1sums,
    md5sumsPath: values.md5sums
  };

  if (mode === "--derive-lock") {
    const lock = await deriveWikimediaSourceLock({
      candidate,
      ...common
    });
    const outPath = requiredPath(
      values.out,
      "--out"
    );
    await writeFile(
      outPath,
      JSON.stringify(lock, null, 2) + "\n",
      "utf8"
    );
    process.stdout.write(
      "[WIKIMEDIA_SOURCE_LOCK] " +
      JSON.stringify(lock) +
      "\n"
    );
    return;
  }

  const lock = JSON.parse(
    await readFile(
      requiredPath(values.lock, "--lock"),
      "utf8"
    )
  );
  const verified =
    await verifyWikimediaSourceBytes({
      lock,
      ...common
    });
  process.stdout.write(
    "Wikimedia source lock verified: " +
      verified.sizeBytes +
      " bytes, sha256:" +
      verified.sha256 +
      "\n"
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) ===
    resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
