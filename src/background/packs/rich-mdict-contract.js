import {
  validateRichMdictIndex
} from "./importers/mdict-rich-validation.js";
import {
  CURATED_IMPORTER_TYPES,
  getCuratedDictionary
} from "../../shared/curated-dictionaries.js";
import {
  migrateCuratedRecipeV1State
} from "../../shared/dictionary-catalog-v2.js";

export const RICH_MDICT_STATE_KEY = "tfRichMdictStateV1";
export const RICH_MDICT_OPFS_ROOT = "rich-mdict-dictionaries";
export const RICH_MDICT_SOURCE_PATH = "source.mdx";
export const RICH_MDICT_INDEX_PATH = "index.json";
export const RICH_MDICT_MAX_SOURCE_BYTES = 128 * 1024 * 1024;
export const RICH_MDICT_MAX_INDEX_BYTES = 8 * 1024 * 1024;
export const RICH_MDICT_MAX_ENTRIES = 4_000_000;
export const RICH_MDICT_MAX_RECORD_BYTES = 512 * 1024;
export const RICH_MDICT_MAX_DISPLAY_CHARS = 6000;
export const RICH_MDICT_SOURCE_ID = "local-rich-mdict";

export function validateCommit({ packId, packVersion, metadata } = {}) {
  const id = normalizePackId(packId);
  const version = normalizeVersion(packVersion);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw richError("RICH_MDICT_CORRUPT", "Rich dictionary install metadata is invalid.");
  }
  const sourceSize = Number(metadata.sourceSize);
  const indexSize = Number(metadata.indexSize);
  const entryCount = Number(metadata.entryCount);
  const indexSha256 = String(metadata.indexSha256 || "").toLowerCase();
  if (!Number.isSafeInteger(sourceSize) || sourceSize <= 0 || sourceSize > RICH_MDICT_MAX_SOURCE_BYTES) {
    throw richError("RICH_MDICT_LIMIT", "MDX file exceeds the current 128 MiB safety limit.");
  }
  if (!Number.isSafeInteger(indexSize) || indexSize <= 0 || indexSize > RICH_MDICT_MAX_INDEX_BYTES) {
    throw richError("RICH_MDICT_LIMIT", "Rich dictionary index exceeds its safety limit.");
  }
  if (!Number.isSafeInteger(entryCount) || entryCount <= 0 || entryCount > RICH_MDICT_MAX_ENTRIES) {
    throw richError("RICH_MDICT_CORRUPT", "Rich dictionary entry count is invalid.");
  }
  if (!/^[a-f0-9]{64}$/u.test(indexSha256)) {
    throw richError("RICH_MDICT_CORRUPT", "Rich dictionary index checksum is invalid.");
  }
  const curated = metadata.curated === undefined
    ? null
    : validateCuratedRichMdictProvenance(metadata.curated, id);
  return {
    packId: id,
    packVersion: version,
    sourceSize,
    indexSize,
    indexSha256,
    entryCount,
    title: clampText(metadata.title || metadata.fileName || "MDict dictionary", 200),
    fileName: clampText(metadata.fileName || "dictionary.mdx", 200),
    format: clampText(metadata.format || "Html", 40),
    engineVersion: clampText(metadata.engineVersion || "", 40),
    encoding: clampText(metadata.encoding || "", 40),
    header: sanitizeHeaderSummary(metadata.header),
    ...(curated ? { curated } : {})
  };
}

export function makeCuratedRichMdictProvenance(recipe) {
  const source = typeof recipe === "string"
    ? getCuratedDictionary(recipe)
    : getCuratedDictionary(recipe?.id);
  if (
    !source ||
    source.importerType !== CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1 ||
    source.output?.packId !== "rich-mdict-18500000-0000-4000-8000-000000000028" ||
    source.output?.recipeId !== source.id
  ) {
    throw richError("RICH_MDICT_PROVENANCE", "Curated rich dictionary recipe is not declared by this extension.");
  }
  return {
    recipeId: source.id,
    trustClass: source.trustClass,
    publisher: source.publisher,
    upstreamRepository: source.upstreamRepository,
    upstreamRevision: source.upstreamRevision,
    sourceFormat: source.sourceFormat,
    languageDirection: source.languageDirection,
    sourceLicenseLabel: source.sourceLicenseLabel,
    sourceLicenseUrl: source.sourceLicenseUrl,
    sourceLicenseNotice: source.sourceLicenseNotice,
    downloadUrl: source.downloadUrl,
    downloadBytes: source.downloadBytes,
    archiveSha256: source.downloadSha256,
    mdxFileName: source.mdx.fileName,
    mdxBytes: source.mdx.bytes,
    mdxSha256: source.mdx.sha256,
    entryCount: source.mdx.entryCount,
    contentDate: source.mdx.descriptionDate,
    knownLimitations: [...source.knownLimitations]
  };
}

export function validateCuratedRichMdictProvenance(value, packId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw richError("RICH_MDICT_PROVENANCE", "Curated rich dictionary provenance is invalid.");
  }
  const expected = makeCuratedRichMdictProvenance(value.recipeId);
  if (
    packId !== "rich-mdict-18500000-0000-4000-8000-000000000028" ||
    !hasExactJsonShapeAndValues(value, expected)
  ) {
    throw richError("RICH_MDICT_PROVENANCE", "Curated rich dictionary provenance does not match its extension-declared recipe.");
  }
  return expected;
}

export function hasExactJsonShapeAndValues(actual, expected) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    const expectedKeys = expected.map((_, index) => String(index)).sort();
    const actualKeys = Object.keys(actual).sort();
    if (!sameStrings(actualKeys, expectedKeys)) return false;
    return expected.every((value, index) => hasExactJsonShapeAndValues(actual[index], value));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (!sameStrings(actualKeys, expectedKeys)) return false;
    return expectedKeys.every((key) => hasExactJsonShapeAndValues(actual[key], expected[key]));
  }
  return Object.is(actual, expected);
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateCuratedRichMdictReplacement(value, packId, curated) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw richError("RICH_MDICT_PROVENANCE", "Curated rich dictionary replacement request is invalid.");
  }
  const recipeId = String(value.recipeId || "");
  const source = getCuratedDictionary(recipeId);
  if (
    !source ||
    source.importerType !== CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1 ||
    source.output?.packId !== packId ||
    curated?.recipeId !== recipeId
  ) {
    throw richError("RICH_MDICT_PROVENANCE", "Only the declared curated recipe can replace its own rich dictionary.");
  }
  const expectedActiveVersion = String(value.expectedActiveVersion || "");
  if (expectedActiveVersion) normalizeVersion(expectedActiveVersion);
  return { recipeId, expectedActiveVersion };
}

export function parseIndex(bytes) {
  let index;
  try {
    index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw richError("RICH_MDICT_CORRUPT", "Rich dictionary index cannot be decoded.", { cause: error });
  }
  try {
    validateRichMdictIndex(index, { sourceSize: index?.sourceSize });
  } catch (cause) {
    throw richError("RICH_MDICT_CORRUPT", cause?.message || "Rich dictionary index metadata is malformed.", { cause });
  }
  return index;
}

export function assertIndexMatchesMetadata(index, metadata) {
  if (index.sourceSize !== metadata.sourceSize || index.entryCount !== metadata.entryCount) {
    throw richError("RICH_MDICT_CORRUPT", "Rich dictionary index does not match its install metadata.");
  }
}

export function isValidSnapshot(packId, snapshot) {
  const valid = Boolean(
    snapshot && typeof snapshot === "object" &&
    snapshot.packId === packId && normalizePackId(snapshot.packId) === packId &&
    normalizeVersion(snapshot.packVersion) === snapshot.packVersion &&
    Number.isSafeInteger(snapshot.sourceSize) && snapshot.sourceSize > 0 &&
    Number.isSafeInteger(snapshot.indexSize) && snapshot.indexSize > 0 &&
    /^[a-f0-9]{64}$/u.test(String(snapshot.indexSha256 || ""))
  );
  if (!valid || snapshot.curated === undefined) return valid;
  try {
    validateCuratedRichMdictProvenance(snapshot.curated, packId);
    return true;
  } catch {
    return false;
  }
}

export function publicRichDictionary(entry) {
  const active = entry?.active || {};
  const migratedCatalog = active.curated
    ? migrateCuratedRecipeV1State(active.curated, {
        recipeId: active.curated.recipeId,
        installedVersion: active.packVersion
      })
    : { migrated: false };
  const resourceSources = Array.isArray(active.resources?.sources) && active.resources.sources.length <= 16
    ? active.resources.sources
    : [];
  return {
    id: String(active.packId || ""),
    title: clampText(active.title || active.fileName || "Rich MDict", 200),
    fileName: clampText(active.fileName || "", 200),
    format: clampText(active.format || "", 40),
    packVersion: clampText(active.packVersion || "", 120),
    sourceSize: Number(active.sourceSize || 0),
    indexSize: Number(active.indexSize || 0),
    entryCount: Number(active.entryCount || 0),
    resourceCount: resourceSources.length,
    resourceBytes: resourceSources.reduce((sum, source) => sum + Math.max(0, Number(source?.sourceSize || 0)), 0),
    installedBytes: Number(active.sourceSize || 0) + Number(active.indexSize || 0) +
      resourceSources.reduce((sum, source) => sum + Math.max(0, Number(source?.sourceSize || 0)), 0),
    installedAt: Number(active.installedAt || 0),
    ...(active.curated ? { curated: active.curated } : {}),
    ...(migratedCatalog.migrated ? { catalog: migratedCatalog.catalog } : {}),
    status: entry?.status || "unknown"
  };
}

export function makeRichMdictSnapshot(metadata, index) {
  return {
    packId: metadata.packId,
    packVersion: metadata.packVersion,
    sourceSize: metadata.sourceSize,
    indexSize: metadata.indexSize,
    indexSha256: metadata.indexSha256,
    entryCount: index.entryCount,
    title: clampText(index.header.title || metadata.title, 200),
    fileName: metadata.fileName,
    format: index.header.format,
    engineVersion: index.header.generatedByEngineVersion,
    encoding: index.header.encoding,
    header: index.header,
    installedAt: Date.now(),
    ...(metadata.curated ? { curated: metadata.curated } : {})
  };
}

export function normalizeRequestId(value) {
  const id = String(value || "");
  if (!id || id.length > 160 || /[\u0000-\u001f\u007f]/u.test(id)) {
    throw richError("RICH_MDICT_INPUT", "Rich MDict request ID is invalid.");
  }
  return id;
}

export function sanitizeDebugMetrics(value) {
  const result = {};
  for (const key of ["keyBlockCountRead", "keyBytesRead", "recordBlockCountRead", "recordBytesRead", "lookupMs"]) {
    const number = Number(value?.[key]);
    if (Number.isFinite(number) && number >= 0) result[key] = number;
  }
  return result;
}

export function richMdictAbortError() {
  return new DOMException("Rich MDict operation cancelled.", "AbortError");
}

export function normalizeQuery(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 256 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw richError("RICH_MDICT_QUERY", "Rich dictionary lookup text is invalid.");
  }
  return text;
}

export function normalizePackId(value) {
  const text = String(value || "");
  if (!/^rich-mdict-[a-f0-9-]{36}$/u.test(text)) {
    throw richError("RICH_MDICT_CORRUPT", "Rich dictionary identifier is invalid.");
  }
  return text;
}

export function normalizeVersion(value) {
  const text = String(value || "");
  if (!/^import-[a-z0-9]+-[a-f0-9]{8}$/u.test(text)) {
    throw richError("RICH_MDICT_CORRUPT", "Rich dictionary version is invalid.");
  }
  return text;
}

export async function sha256(bytes, cryptoProvider) {
  if (!cryptoProvider?.subtle?.digest) {
    throw richError("RICH_MDICT_STORAGE", "WebCrypto is unavailable for rich dictionary index verification.");
  }
  const digest = new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function cacheKey(snapshot) {
  return `${snapshot.packId}@${snapshot.packVersion}@${snapshot.indexSha256}`;
}

export function clampText(value, limit) {
  return String(value ?? "").replace(/\u0000/gu, "").slice(0, limit);
}

export function compareText(left, right) {
  return String(left).localeCompare(String(right), "en");
}

export function richError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sanitizeHeaderSummary(header) {
  if (!header || typeof header !== "object" || Array.isArray(header)) return {};
  const summary = {};
  for (const key of ["title", "version", "encoding", "format", "encrypted", "compact", "compat", "styleSheetRules"]) {
    const value = header[key];
    if (typeof value === "string") summary[key] = clampText(value, 200);
    else if (typeof value === "number" && Number.isFinite(value)) summary[key] = value;
    else if (typeof value === "boolean") summary[key] = value;
    else if (key === "styleSheetRules" && Array.isArray(value)) summary[key] = value.length;
  }
  return summary;
}
