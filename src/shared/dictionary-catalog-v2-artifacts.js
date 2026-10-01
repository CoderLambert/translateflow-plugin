import {
  catalogError,
  normalizeOriginList,
  requireExactKeys,
  requireHttpsUrl,
  requireIdentifier,
  requireObject,
  requireText
} from "./dictionary-catalog-v2-utils.js";

export function validateArtifact(artifact, artifactKinds) {
  requireObject(artifact, "catalog artifact");
  const allowedKeys = [
    "id", "kind", "downloadUrl", "allowedOrigins", "redirectOrigins",
    "redirectPolicy", "expectedBytes", "maxBytes", "integrity", "filename",
    "archiveRules", "associationRules"
  ];
  requireExactKeys(artifact, allowedKeys, "catalog artifact");
  requireIdentifier(artifact.id, "artifact id");
  if (!artifactKinds.includes(artifact.kind)) {
    throw catalogError("CATALOG_ARTIFACT", "Dictionary artifact kind is unsupported.");
  }
  const downloadUrl = requireHttpsUrl(artifact.downloadUrl, "artifact URL");
  const allowedOrigins = normalizeOriginList(artifact.allowedOrigins, "artifact origin allowlist");
  const redirectOrigins = normalizeOriginList(artifact.redirectOrigins, "artifact redirect origin list", { allowEmpty: true });
  if (!allowedOrigins.includes(downloadUrl.origin) || redirectOrigins.some((origin) => !allowedOrigins.includes(origin))) {
    throw catalogError("CATALOG_ORIGIN", "Dictionary artifact URL and redirects must use declared exact HTTPS origins.");
  }
  if (!["none", "browser-limited-final-origin"].includes(artifact.redirectPolicy) ||
      (artifact.redirectPolicy === "none" && redirectOrigins.length) ||
      (artifact.redirectPolicy === "browser-limited-final-origin" && !redirectOrigins.length)) {
    throw catalogError("CATALOG_REDIRECT_LIMIT", "Dictionary artifact redirect policy is invalid.");
  }
  if (!Number.isSafeInteger(artifact.expectedBytes) || artifact.expectedBytes <= 0 ||
      artifact.expectedBytes > 512 * 1024 * 1024 ||
      !Number.isSafeInteger(artifact.maxBytes) || artifact.maxBytes < artifact.expectedBytes ||
      artifact.maxBytes > 512 * 1024 * 1024) {
    throw catalogError("CATALOG_SIZE", "Dictionary artifact byte limits are invalid.");
  }
  if (artifact.integrity !== null) {
    requireExactKeys(artifact.integrity, ["sha256", "authority"], "artifact integrity");
    if (!/^[a-f0-9]{64}$/iu.test(String(artifact.integrity.sha256 || "")) ||
        !["upstream-published", "extension-locked", "observed-post-download"].includes(artifact.integrity.authority)) {
      throw catalogError("CATALOG_HASH", "Dictionary artifact integrity lock is invalid.");
    }
  }
  requireText(artifact.filename, 180, "artifact filename");
  if (/[\\/\u0000-\u001f]/u.test(artifact.filename) || artifact.filename === "." || artifact.filename === "..") {
    throw catalogError("CATALOG_ARTIFACT", "Dictionary artifact filename must be a plain filename.");
  }
  if (artifact.archiveRules !== null) validateArchiveRules(artifact.archiveRules, artifact);
  if (artifact.associationRules !== null) validateAssociationRules(artifact.associationRules, artifact);
  return {
    ...artifact,
    downloadUrl: downloadUrl.href,
    allowedOrigins,
    redirectOrigins,
    integrity: artifact.integrity ? { ...artifact.integrity, sha256: artifact.integrity.sha256.toLowerCase() } : null,
    archiveRules: artifact.archiveRules ? { ...artifact.archiveRules } : null,
    associationRules: artifact.associationRules ? { ...artifact.associationRules } : null
  };
}

function validateAssociationRules(value, artifact) {
  requireExactKeys(value, ["companionArtifactId", "required", "filenameRule"], "artifact association rules");
  requireIdentifier(value.companionArtifactId, "companion artifact id");
  if (!value.companionArtifactId || typeof value.required !== "boolean" ||
      !["same-stem", "catalog-declared-name"].includes(value.filenameRule) ||
      !["mdx", "mdd"].includes(artifact.kind)) {
    throw catalogError("CATALOG_ARTIFACT", "Dictionary artifact association rules are invalid.");
  }
}

function validateArchiveRules(value, artifact) {
  requireExactKeys(value, [
    "format", "fileCount", "maxArchiveBytes", "maxExpandedBytes", "maxFileBytes",
    "maxCompressionRatio", "entryName", "entryNameBytesHex", "entryBytes", "entrySha256", "nestedArchives"
  ], "archive rules");
  if (artifact.kind !== "zip" || value.format !== "zip" || value.fileCount < 1 || value.fileCount > 64 ||
      value.maxArchiveBytes < artifact.expectedBytes || value.maxArchiveBytes > artifact.maxBytes ||
      !Number.isSafeInteger(value.maxExpandedBytes) || value.maxExpandedBytes <= 0 ||
      !Number.isSafeInteger(value.maxFileBytes) || value.maxFileBytes <= 0 ||
      !Number.isFinite(value.maxCompressionRatio) || value.maxCompressionRatio < 1 || value.maxCompressionRatio > 100 ||
      value.nestedArchives !== 0) {
    throw catalogError("CATALOG_ARCHIVE", "Dictionary artifact archive limits are invalid.");
  }
  requireText(value.entryName, 180, "archive entry name");
  if (/[\\/\u0000-\u001f]/u.test(value.entryName) || value.entryName.startsWith(".")) {
    throw catalogError("CATALOG_ARCHIVE", "Dictionary archive entry name must be a plain filename.");
  }
  if (!/^(?:[a-f0-9]{2})+$/iu.test(String(value.entryNameBytesHex || "")) ||
      !Number.isSafeInteger(value.entryBytes) || value.entryBytes <= 0 ||
      value.entryBytes > value.maxFileBytes || value.entryBytes > value.maxExpandedBytes ||
      !/^[a-f0-9]{64}$/iu.test(String(value.entrySha256 || ""))) {
    throw catalogError("CATALOG_ARCHIVE", "Dictionary archive member identity is invalid.");
  }
}

export function validateCapabilities(value, runtimeCapabilities) {
  if (!Array.isArray(value) || value.length > 32) {
    throw catalogError("CATALOG_CAPABILITY", "Dictionary required capability list is invalid.");
  }
  const seen = new Set();
  for (const capability of value) {
    if (!runtimeCapabilities.includes(capability) || seen.has(capability)) {
      throw catalogError("CATALOG_CAPABILITY", "Dictionary requires an unknown or duplicate runtime capability.");
    }
    seen.add(capability);
  }
}
