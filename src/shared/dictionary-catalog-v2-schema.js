import { validateArtifact, validateCapabilities } from "./dictionary-catalog-v2-artifacts.js";
import {
  catalogError,
  deepFreeze,
  requireDate,
  requireExactKeys,
  requireHttpsUrl,
  requireIdentifier,
  requireLanguageCode,
  requireNullableDate,
  requireNullableText,
  requireObject,
  requireText,
  validateTextList
} from "./dictionary-catalog-v2-utils.js";

export const DICTIONARY_CATALOG_SCHEMA_VERSION = 2;

export const DICTIONARY_CATALOG_TRUST_CLASSES = Object.freeze([
  "curated-upstream",
  "official"
]);

export const DICTIONARY_CATALOG_ROLES = Object.freeze([
  "bilingual-primary",
  "monolingual-definition",
  "semantic-supplement",
  "zh-en",
  "technical-supplement"
]);

export const DICTIONARY_CATALOG_ARTIFACT_KINDS = Object.freeze([
  "mdx",
  "mdd",
  "zip",
  "stardict",
  "tflex",
  "source-data"
]);

// These are closed, extension-owned adapters. A catalog entry can select one
// of these identifiers but cannot provide code or executable options.
export const DICTIONARY_CATALOG_IMPORTER_ADAPTERS = Object.freeze({
  ECDICT_CSV_V1: "ecdict-csv-v1",
  REVIEWED_RICH_MDX_ZIP_V1: "reviewed-rich-mdx-zip-v1"
});

export const DICTIONARY_RUNTIME_CAPABILITIES = Object.freeze([
  "mdx.engine.v2",
  "mdx.required-engine-version",
  "mdx.encoding.utf8",
  "mdx.encoding.utf16le",
  "mdx.encoding.gbk",
  "mdx.encoding.big5",
  "mdx.encoding.gb18030",
  "mdx.encoding.other",
  "mdx.encryption.key-info-v2",
  "mdx.key-info.compression-zlib",
  "mdx.encryption.password-protected",
  "mdx.encryption.record",
  "mdx.compression.none",
  "mdx.compression.zlib",
  "mdx.compression.lzo",
  "mdx.compression.unknown",
  "mdx.record.html",
  "mdx.record.text",
  "mdx.record-format.other",
  "mdx.style-sheet",
  "mdx.compact-records",
  "mdx.alias-link",
  "mdd.engine.v2",
  "mdd.required-engine-version",
  "mdd.encoding.utf8",
  "mdd.encoding.utf16le",
  "mdd.encoding.gbk",
  "mdd.encoding.big5",
  "mdd.encoding.gb18030",
  "mdd.encoding.other",
  "mdd.encryption.key-info-v2",
  "mdd.encryption.password-protected",
  "mdd.encryption.record",
  "mdd.compression.none",
  "mdd.compression.zlib",
  "mdd.compression.lzo",
  "mdd.compression.unknown",
  "mdd.resource.path-normalization",
  "mdd.resource.format-other",
  "rich.html-structure",
  "rich.inline-style",
  "rich.style-sheet-reference",
  "rich.compact-style-marker",
  "rich.relative-resource-path",
  "rich.other-uri-scheme",
  "rich.unusual-resource-extension",
  "rich.entry-reference",
  "rich.sound-reference",
  "rich.local-anchor",
  "rich.remote-url",
  "rich.image-reference",
  "rich.audio-reference"
]);

export const SHIPPED_DICTIONARY_RUNTIME_CAPABILITIES = Object.freeze([
  "mdx.engine.v2",
  "mdx.encoding.utf8",
  "mdx.encoding.utf16le",
  "mdx.encryption.key-info-v2",
  "mdx.key-info.compression-zlib",
  "mdx.compression.none",
  "mdx.compression.zlib",
  "mdx.record.html",
  "mdx.record.text",
  "mdx.style-sheet",
  "mdx.compact-records",
  "mdd.engine.v2",
  "mdd.encoding.utf16le",
  "mdd.encryption.key-info-v2",
  "mdd.compression.none",
  "mdd.compression.zlib"
]);
export function validateDictionaryCatalogEntry(entry) {
  requireObject(entry, "catalog entry");
  requireExactKeys(entry, [
    "schemaVersion", "id", "identity", "role", "language", "trustClass",
    "source", "version", "artifacts", "importer", "requiredCapabilities",
    "compatibility", "knownLimitations", "updatePolicy"
  ], "catalog entry");
  if (entry.schemaVersion !== DICTIONARY_CATALOG_SCHEMA_VERSION) {
    throw catalogError("CATALOG_SCHEMA", "Dictionary catalog schema version is unsupported.");
  }
  requireIdentifier(entry.id, "catalog id");

  requireExactKeys(entry.identity, ["displayName", "shortDescription", "publisher"], "identity");
  requireText(entry.identity.displayName, 160, "catalog display name");
  requireText(entry.identity.shortDescription, 600, "catalog description");
  requireText(entry.identity.publisher, 160, "catalog publisher");

  if (!DICTIONARY_CATALOG_ROLES.includes(entry.role)) {
    throw catalogError("CATALOG_SCHEMA", "Dictionary catalog role is unsupported.");
  }
  requireExactKeys(entry.language, ["sourceLanguage", "targetLanguages", "directionLabel", "locale", "script"], "language");
  requireLanguageCode(entry.language.sourceLanguage, "source language");
  if (!Array.isArray(entry.language.targetLanguages) ||
      entry.language.targetLanguages.length < 1 || entry.language.targetLanguages.length > 8) {
    throw catalogError("CATALOG_SCHEMA", "Dictionary catalog target languages are invalid.");
  }
  entry.language.targetLanguages.forEach((value) => requireLanguageCode(value, "target language"));
  if (new Set(entry.language.targetLanguages).size !== entry.language.targetLanguages.length) {
    throw catalogError("CATALOG_SCHEMA", "Dictionary catalog target languages contain duplicates.");
  }
  requireText(entry.language.directionLabel, 80, "language direction label");
  requireNullableText(entry.language.locale, 40, "language locale");
  requireNullableText(entry.language.script, 40, "language script");

  if (!DICTIONARY_CATALOG_TRUST_CLASSES.includes(entry.trustClass)) {
    throw catalogError("CATALOG_TRUST", "Dictionary catalog trust class is unsupported.");
  }
  requireExactKeys(entry.source, [
    "homepage", "repository", "licenseLabel", "licenseUrl", "attribution",
    "redistributionMode", "legalLimitations"
  ], "source");
  requireHttpsUrl(entry.source.homepage, "upstream homepage");
  requireHttpsUrl(entry.source.repository, "upstream repository");
  requireText(entry.source.licenseLabel, 240, "license label");
  requireHttpsUrl(entry.source.licenseUrl, "license URL");
  requireText(entry.source.attribution, 400, "attribution");
  if (!["direct-upstream-user-triggered", "official-redistributed"].includes(entry.source.redistributionMode)) {
    throw catalogError("CATALOG_SCHEMA", "Dictionary redistribution mode is unsupported.");
  }
  if (entry.trustClass === "official" && entry.source.redistributionMode !== "official-redistributed") {
    throw catalogError("CATALOG_TRUST", "Official dictionary entries require the approved redistribution mode.");
  }
  validateTextList(entry.source.legalLimitations, 8, 600, "source legal limitations");

  requireExactKeys(entry.version, [
    "sourceVersion", "releaseDate", "contentDate", "reviewedAt",
    "compatibilityContractVersion", "maintenanceStatus"
  ], "version");
  requireText(entry.version.sourceVersion, 160, "source version");
  requireNullableDate(entry.version.releaseDate, "release date");
  requireNullableDate(entry.version.contentDate, "content date");
  requireDate(entry.version.reviewedAt, "review date");
  requireIdentifier(entry.version.compatibilityContractVersion, "compatibility contract version");
  if (![null, "maintained", "unmaintained", "unknown"].includes(entry.version.maintenanceStatus)) {
    throw catalogError("CATALOG_SCHEMA", "Dictionary maintenance status is unsupported.");
  }

  if (!Array.isArray(entry.artifacts) || !entry.artifacts.length || entry.artifacts.length > 16) {
    throw catalogError("CATALOG_ARTIFACT", "Dictionary artifact list is invalid.");
  }
  const artifactIds = new Set();
  const normalizedArtifacts = entry.artifacts.map((artifact) => {
    const normalized = validateArtifact(artifact, DICTIONARY_CATALOG_ARTIFACT_KINDS);
    if (artifactIds.has(normalized.id)) {
      throw catalogError("CATALOG_ARTIFACT", "Dictionary catalog has duplicate artifact ids.");
    }
    artifactIds.add(normalized.id);
    return normalized;
  });
  for (const artifact of normalizedArtifacts) {
    if (!artifact.associationRules) continue;
    const companion = normalizedArtifacts.find((item) => item.id === artifact.associationRules.companionArtifactId);
    if (!companion || artifact.kind !== "mdx" || companion.kind !== "mdd") {
      throw catalogError("CATALOG_ARTIFACT", "MDX companion association must reference a declared MDD artifact.");
    }
  }

  requireExactKeys(entry.importer, ["adapterId", "recipeId", "options"], "importer");
  const allowedAdapters = Object.values(DICTIONARY_CATALOG_IMPORTER_ADAPTERS);
  if (!allowedAdapters.includes(entry.importer.adapterId)) {
    throw catalogError("CATALOG_IMPORTER", "Dictionary importer adapter is not extension-owned.");
  }
  requireIdentifier(entry.importer.recipeId, "importer recipe id");
  if (!entry.importer.options || typeof entry.importer.options !== "object" || Array.isArray(entry.importer.options) ||
      Object.keys(entry.importer.options).length > 12) {
    throw catalogError("CATALOG_IMPORTER", "Dictionary importer options are invalid.");
  }
  for (const [key, value] of Object.entries(entry.importer.options)) {
    if (!/^[a-z][a-zA-Z0-9]{0,39}$/u.test(key) ||
        !(typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      throw catalogError("CATALOG_IMPORTER", "Dictionary importer options must be bounded scalar data.");
    }
  }

  validateCapabilities(entry.requiredCapabilities, DICTIONARY_RUNTIME_CAPABILITIES);
  requireExactKeys(entry.compatibility, ["status", "reviewedAt", "contractVersion"], "compatibility");
  if (![
    "reviewed-compatible", "reviewed-partial", "reviewed-incompatible", "not-reviewed"
  ].includes(entry.compatibility.status)) {
    throw catalogError("CATALOG_SCHEMA", "Dictionary compatibility status is unsupported.");
  }
  requireDate(entry.compatibility.reviewedAt, "compatibility review date");
  requireIdentifier(entry.compatibility.contractVersion, "compatibility contract version");
  if (entry.compatibility.reviewedAt !== entry.version.reviewedAt ||
      entry.compatibility.contractVersion !== entry.version.compatibilityContractVersion) {
    throw catalogError("CATALOG_SCHEMA", "Dictionary review metadata does not match its compatibility contract.");
  }

  if (!Array.isArray(entry.knownLimitations) || entry.knownLimitations.length > 24) {
    throw catalogError("CATALOG_SCHEMA", "Dictionary known limitations are invalid.");
  }
  const limitationIds = new Set();
  const limitations = entry.knownLimitations.map((item) => {
    requireExactKeys(item, ["id", "description"], "known limitation");
    requireIdentifier(item.id, "limitation id");
    requireText(item.description, 400, "limitation description");
    if (limitationIds.has(item.id)) throw catalogError("CATALOG_SCHEMA", "Dictionary limitations contain duplicate ids.");
    limitationIds.add(item.id);
    return item;
  });

  requireExactKeys(entry.updatePolicy, ["mode", "currentSourceVersion", "reviewedVersions", "followLatest", "allowReinstall"], "update policy");
  if (entry.updatePolicy.mode !== "reviewed-versions-only" ||
      entry.updatePolicy.currentSourceVersion !== entry.version.sourceVersion ||
      entry.updatePolicy.followLatest !== false ||
      entry.updatePolicy.allowReinstall !== true) {
    throw catalogError("CATALOG_UPDATE_POLICY", "Dictionary update policy must target reviewed versions only.");
  }
  if (!Array.isArray(entry.updatePolicy.reviewedVersions) || !entry.updatePolicy.reviewedVersions.length ||
      entry.updatePolicy.reviewedVersions.length > 32) {
    throw catalogError("CATALOG_UPDATE_POLICY", "Dictionary reviewed version list is invalid.");
  }
  const reviewedVersions = new Set();
  for (const reviewed of entry.updatePolicy.reviewedVersions) {
    requireExactKeys(reviewed, ["sourceVersion", "artifactIds"], "reviewed version");
    requireText(reviewed.sourceVersion, 160, "reviewed source version");
    if (reviewedVersions.has(reviewed.sourceVersion)) throw catalogError("CATALOG_UPDATE_POLICY", "Reviewed source versions contain duplicates.");
    reviewedVersions.add(reviewed.sourceVersion);
    if (!Array.isArray(reviewed.artifactIds) || !reviewed.artifactIds.length ||
        reviewed.artifactIds.some((id) => !artifactIds.has(id))) {
      throw catalogError("CATALOG_UPDATE_POLICY", "Reviewed version refers to an undeclared artifact.");
    }
  }
  const reviewedArtifactIds = new Set(entry.updatePolicy.reviewedVersions.flatMap((item) => item.artifactIds));
  if (normalizedArtifacts.some((artifact) => !reviewedArtifactIds.has(artifact.id))) {
    throw catalogError("CATALOG_UPDATE_POLICY", "Every catalog artifact must belong to a reviewed version target.");
  }
  if (!reviewedVersions.has(entry.version.sourceVersion)) {
    throw catalogError("CATALOG_UPDATE_POLICY", "Current source version is not a reviewed install target.");
  }

  return deepFreeze({
    ...entry,
    language: { ...entry.language, targetLanguages: [...entry.language.targetLanguages] },
    source: { ...entry.source, legalLimitations: [...entry.source.legalLimitations] },
    version: { ...entry.version },
    artifacts: normalizedArtifacts,
    importer: { ...entry.importer, options: { ...entry.importer.options } },
    requiredCapabilities: [...entry.requiredCapabilities],
    compatibility: { ...entry.compatibility },
    knownLimitations: limitations,
    updatePolicy: {
      ...entry.updatePolicy,
      reviewedVersions: entry.updatePolicy.reviewedVersions.map((item) => ({
        ...item,
        artifactIds: [...item.artifactIds]
      }))
    }
  });
}
