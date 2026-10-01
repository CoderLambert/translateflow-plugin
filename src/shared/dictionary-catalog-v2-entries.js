import { DICTIONARY_CATALOG_IMPORTER_ADAPTERS } from "./dictionary-catalog-v2-schema.js";
import { CURATED_IMPORTER_TYPES } from "./curated-dictionaries.js";

const REVIEWED_AT = "2026-10-01";
const MDX_CAPABILITIES = Object.freeze([
  "mdx.engine.v2",
  "mdx.encoding.utf8",
  "mdx.encryption.key-info-v2",
  "mdx.key-info.compression-zlib",
  "mdx.compression.zlib",
  "mdx.record.html",
  "mdx.style-sheet",
  "mdx.compact-records"
]);

export function makeEcdictCsvEntry(recipe) {
  if (!recipe || recipe.importerType !== CURATED_IMPORTER_TYPES.ECDICT_CSV_V1) {
    throw new Error("ECDICT CSV v2 catalog projection requires its extension-declared v1 recipe.");
  }
  const artifactId = "ecdict-csv-source";
  return {
    schemaVersion: 2,
    id: recipe.id,
    identity: { displayName: recipe.label, shortDescription: recipe.description, publisher: recipe.publisher },
    role: "bilingual-primary",
    language: { sourceLanguage: "en", targetLanguages: ["zh-CN"], directionLabel: "English → 简体中文", locale: "zh-CN", script: "Hans" },
    trustClass: "curated-upstream",
    source: {
      homepage: recipe.upstreamRepository,
      repository: recipe.upstreamRepository,
      licenseLabel: recipe.sourceLicenseLabel,
      licenseUrl: recipe.sourceLicenseUrl,
      attribution: recipe.publisher,
      redistributionMode: "direct-upstream-user-triggered",
      legalLimitations: ["词条来源范围按上游说明理解；TranslateFlow 不重新授权第三方词典内容。"]
    },
    version: {
      sourceVersion: recipe.upstreamRevision,
      releaseDate: null,
      contentDate: null,
      reviewedAt: REVIEWED_AT,
      compatibilityContractVersion: "tflex-local-import-v1",
      maintenanceStatus: "unknown"
    },
    artifacts: [{
      id: artifactId,
      kind: "source-data",
      downloadUrl: recipe.downloadUrl,
      allowedOrigins: [new URL(recipe.downloadUrl).origin],
      redirectOrigins: [],
      redirectPolicy: "none",
      expectedBytes: recipe.downloadBytes,
      maxBytes: recipe.selection.maxSourceBytes,
      integrity: null,
      filename: "ecdict.csv",
      archiveRules: null,
      associationRules: null
    }],
    importer: {
      adapterId: DICTIONARY_CATALOG_IMPORTER_ADAPTERS.ECDICT_CSV_V1,
      recipeId: recipe.id,
      options: { maxRecords: recipe.selection.maxRecords }
    },
    requiredCapabilities: [],
    compatibility: { status: "reviewed-compatible", reviewedAt: REVIEWED_AT, contractVersion: "tflex-local-import-v1" },
    knownLimitations: [
      { id: "content-date-not-published", description: "上游未给出可验证的词典内容日期，不能据审核日期推断词典新旧。" },
      { id: "curated-subset", description: "本地只保留固定筛选策略选出的高频/核心词条，不是完整源数据。" }
    ],
    updatePolicy: {
      mode: "reviewed-versions-only",
      currentSourceVersion: recipe.upstreamRevision,
      reviewedVersions: [{ sourceVersion: recipe.upstreamRevision, artifactIds: [artifactId] }],
      followLatest: false,
      allowReinstall: true
    }
  };
}

export function makeEcdictMdxEntry(recipe) {
  if (!recipe || recipe.importerType !== CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1) {
    throw new Error("ECDICT MDX v2 catalog projection requires its extension-declared v1 recipe.");
  }
  const artifactId = "ecdict-mdx-zip";
  const archiveLock = {
    format: "zip",
    fileCount: recipe.archive.fileCount,
    maxArchiveBytes: recipe.archive.maxArchiveBytes,
    maxExpandedBytes: recipe.archive.maxExpandedBytes,
    maxFileBytes: recipe.archive.maxFileBytes,
    maxCompressionRatio: recipe.archive.maxCompressionRatio,
    entryName: recipe.archive.entryName,
    entryNameBytesHex: recipe.archive.entryNameBytesHex,
    entryBytes: recipe.archive.entryBytes,
    entrySha256: recipe.archive.entrySha256,
    nestedArchives: recipe.archive.nestedArchives
  };
  const redirectOrigin = recipe.downloadRedirectOrigin;
  return {
    schemaVersion: 2,
    id: recipe.id,
    identity: { displayName: recipe.label, shortDescription: recipe.description, publisher: recipe.publisher },
    role: "bilingual-primary",
    language: { sourceLanguage: "en", targetLanguages: ["zh-CN"], directionLabel: "English → 简体中文", locale: "zh-CN", script: "Hans" },
    trustClass: "curated-upstream",
    source: {
      homepage: recipe.upstreamRepository,
      repository: recipe.upstreamRepository,
      licenseLabel: recipe.sourceLicenseLabel,
      licenseUrl: recipe.sourceLicenseUrl,
      attribution: recipe.publisher,
      redistributionMode: "direct-upstream-user-triggered",
      legalLimitations: [recipe.sourceLicenseNotice]
    },
    version: {
      sourceVersion: recipe.upstreamRevision,
      releaseDate: "2017-09-20",
      contentDate: recipe.mdx.descriptionDate,
      reviewedAt: REVIEWED_AT,
      compatibilityContractVersion: "rich-mdict-v1",
      maintenanceStatus: "unknown"
    },
    artifacts: [{
      id: artifactId,
      kind: "zip",
      downloadUrl: recipe.downloadUrl,
      allowedOrigins: [new URL(recipe.downloadUrl).origin, redirectOrigin],
      redirectOrigins: [redirectOrigin],
      redirectPolicy: "browser-limited-final-origin",
      expectedBytes: recipe.downloadBytes,
      maxBytes: recipe.archive.maxArchiveBytes,
      integrity: { sha256: recipe.downloadSha256, authority: recipe.downloadSha256Authority },
      filename: "ecdict-mdx-28.zip",
      archiveRules: archiveLock,
      associationRules: null
    }],
    importer: {
      adapterId: DICTIONARY_CATALOG_IMPORTER_ADAPTERS.REVIEWED_RICH_MDX_ZIP_V1,
      recipeId: recipe.id,
      options: { outputPackId: recipe.output.packId }
    },
    requiredCapabilities: [...MDX_CAPABILITIES],
    compatibility: { status: "reviewed-compatible", reviewedAt: REVIEWED_AT, contractVersion: "rich-mdict-v1" },
    knownLimitations: recipe.knownLimitations.map((description, index) => ({
      id: ["legacy-content-date", "no-mdd-resources", "active-content-sanitized"][index] || `limitation-${index + 1}`,
      description
    })),
    updatePolicy: {
      mode: "reviewed-versions-only",
      currentSourceVersion: recipe.upstreamRevision,
      reviewedVersions: [{ sourceVersion: recipe.upstreamRevision, artifactIds: [artifactId] }],
      followLatest: false,
      allowReinstall: true
    }
  };
}
