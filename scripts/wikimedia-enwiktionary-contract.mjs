export const WIKIMEDIA_SOURCE = Object.freeze({
  sourceId: "wikimedia-enwiktionary-20260901",
  role: "rich-en-zh-poc-raw-input",
  edition: "enwiktionary",
  dumpDate: "2026-09-01",
  directoryUrl:
    "https://dumps.wikimedia.org/enwiktionary/20260901/",
  artifactFilename:
    "enwiktionary-20260901-pages-articles.xml.bz2",
  format: "mediawiki-pages-articles-xml-bzip2"
});

export const WIKIMEDIA_ARTIFACT_URL =
  WIKIMEDIA_SOURCE.directoryUrl +
  WIKIMEDIA_SOURCE.artifactFilename;
export const WIKIMEDIA_SHA1SUMS_URL =
  WIKIMEDIA_SOURCE.directoryUrl + "sha1sums.txt";
export const WIKIMEDIA_MD5SUMS_URL =
  WIKIMEDIA_SOURCE.directoryUrl + "md5sums.txt";
export const WIKIMEDIA_DUMP_STATUS_URL =
  WIKIMEDIA_SOURCE.directoryUrl + "dumpstatus.json";

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
    candidate.sourceId !== WIKIMEDIA_SOURCE.sourceId ||
    candidate.role !== WIKIMEDIA_SOURCE.role ||
    candidate.edition !== WIKIMEDIA_SOURCE.edition ||
    candidate.dumpDate !== WIKIMEDIA_SOURCE.dumpDate
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
    lock.sourceId !== WIKIMEDIA_SOURCE.sourceId ||
    lock.role !== WIKIMEDIA_SOURCE.role ||
    lock.edition !== WIKIMEDIA_SOURCE.edition ||
    lock.dumpDate !== WIKIMEDIA_SOURCE.dumpDate
  ) {
    throw new Error(
      "Wikimedia source lock identity is incompatible"
    );
  }

  validateSource(lock.source);
  validateExtractor(lock.extractor);
  validateArtifact(lock.artifact);
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
    source.directoryUrl !==
      WIKIMEDIA_SOURCE.directoryUrl ||
    source.artifactUrl !== WIKIMEDIA_ARTIFACT_URL ||
    source.sha1sumsUrl !== WIKIMEDIA_SHA1SUMS_URL ||
    source.md5sumsUrl !== WIKIMEDIA_MD5SUMS_URL ||
    source.dumpStatusUrl !== WIKIMEDIA_DUMP_STATUS_URL ||
    source.format !== WIKIMEDIA_SOURCE.format ||
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
  requireHex(
    extractor.wiktextractCommit,
    40,
    "Wikimedia wiktextract commit"
  );
  requireHex(
    extractor.wikitextprocessorCommit,
    40,
    "Wikimedia wikitextprocessor commit"
  );
}

function validateArtifact(artifact) {
  requireObject(artifact, "Wikimedia locked artifact");
  assertAllowedFields(
    artifact,
    [
      "filename",
      "sizeBytes",
      "sha256",
      "publishedSha1",
      "publishedMd5"
    ],
    "Wikimedia locked artifact"
  );
  if (
    artifact.filename !==
      WIKIMEDIA_SOURCE.artifactFilename
  ) {
    throw new Error(
      "Wikimedia locked artifact filename is incompatible"
    );
  }
  if (
    !Number.isSafeInteger(artifact.sizeBytes) ||
    artifact.sizeBytes <= 0
  ) {
    throw new Error(
      "Wikimedia artifact size must be a positive integer"
    );
  }
  requireHex(
    artifact.sha256,
    64,
    "Wikimedia artifact SHA-256"
  );
  requireHex(
    artifact.publishedSha1,
    40,
    "Wikimedia published SHA-1"
  );
  requireHex(
    artifact.publishedMd5,
    32,
    "Wikimedia published MD5"
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
    packaging.downloadablePackDecision !== "pending-poc"
  ) {
    throw new Error(
      "Wikimedia packaging boundary is incompatible"
    );
  }
}

function assertAllowedFields(value, allowed, label) {
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

function requireHex(value, length, label) {
  if (
    typeof value !== "string" ||
    !new RegExp("^[a-f0-9]{" + length + "}$").test(
      value
    )
  ) {
    throw new Error(
      label + " must be a " + length +
      "-character hex digest"
    );
  }
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
