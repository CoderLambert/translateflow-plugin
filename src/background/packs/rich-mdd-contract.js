import { normalizeMddResourcePath } from "./importers/mdd-resource-path.js";
import { richError, normalizePackId, normalizeVersion, clampText } from "./rich-mdict-contract.js";

export const RICH_MDD_MAX_SOURCE_BYTES = 128 * 1024 * 1024;
export const RICH_MDD_MAX_TOTAL_SOURCE_BYTES = 512 * 1024 * 1024;
export const RICH_MDD_MAX_INDEX_BYTES = 16 * 1024 * 1024;
export const RICH_MDD_MAX_TOTAL_INDEX_BYTES = 32 * 1024 * 1024;
export const RICH_MDD_MAX_COMPANIONS = 16;
export const RICH_MDD_MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const RICH_MDD_MAX_QUERY_BYTES = 32 * 1024 * 1024;
export const RICH_MDD_RESOURCE_SCHEMA = 1;

const encoder = new TextEncoder();

export function validateMddCompanions(fileNames, mdxFileName) {
  if (!Array.isArray(fileNames) || !fileNames.length || fileNames.length > RICH_MDD_MAX_COMPANIONS) {
    throw richError("RICH_MDD_INPUT", "Select one MDD file and its numbered companions (up to 16 files).");
  }
  const mdxName = safeFileName(mdxFileName);
  const base = mdxName.replace(/\.mdx$/iu, "");
  const escape = base.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matcher = new RegExp(`^${escape}(?:\\.([1-9][0-9]{0,1}))?\\.mdd$`, "iu");
  const numbered = new Map();
  let hasBase = false;
  const result = fileNames.map((rawName) => {
    const fileName = safeFileName(rawName);
    const match = matcher.exec(fileName);
    if (!match) throw richError("RICH_MDD_INPUT", "MDD filename must match the installed MDX basename and numbered companions.");
    const number = match[1] ? Number(match[1]) : 0;
    if (!Number.isSafeInteger(number) || number >= RICH_MDD_MAX_COMPANIONS) {
      throw richError("RICH_MDD_INPUT", "MDD numbered companion is outside the supported range.");
    }
    const key = fileName.toLocaleLowerCase("en-US");
    if (numbered.has(number) || [...numbered.values()].includes(key)) {
      throw richError("RICH_MDD_INPUT", "Duplicate MDD companion filenames are not allowed.");
    }
    numbered.set(number, key);
    if (number === 0) hasBase = true;
    return { fileName, number };
  });
  if (!hasBase) throw richError("RICH_MDD_INPUT", "Select the base .mdd file together with any numbered companions.");
  for (let number = 1; number < numbered.size; number += 1) {
    if (!numbered.has(number)) throw richError("RICH_MDD_INPUT", "Numbered MDD companions must be consecutive from .1.mdd.");
  }
  return result.sort((a, b) => a.number - b.number);
}

export function resourceFilePaths(index) {
  const slot = String(index).padStart(3, "0");
  return Object.freeze({
    sourcePath: `resources/${slot}.mdd`,
    indexPath: `resources/${slot}.index.json`
  });
}

export function validateResourceSnapshot(packId, value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== RICH_MDD_RESOURCE_SCHEMA) return false;
  try {
    if (normalizePackId(value.packId) !== packId || normalizeVersion(value.packVersion) !== value.packVersion) return false;
  } catch { return false; }
  const sources = value.sources;
  if (!Array.isArray(sources) || !sources.length || sources.length > RICH_MDD_MAX_COMPANIONS) return false;
  let total = 0;
  let totalIndex = 0;
  const names = new Set();
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!source || typeof source !== "object") return false;
    let fileName;
    try { fileName = safeFileName(source.fileName); } catch { return false; }
    const key = fileName.toLocaleLowerCase("en-US");
    if (names.has(key)) return false;
    names.add(key);
    const expectedPaths = resourceFilePaths(index);
    if (source.sourcePath !== expectedPaths.sourcePath || source.indexPath !== expectedPaths.indexPath) return false;
    if (!Number.isSafeInteger(source.sourceSize) || source.sourceSize <= 0 || source.sourceSize > RICH_MDD_MAX_SOURCE_BYTES) return false;
    if (!Number.isSafeInteger(source.indexSize) || source.indexSize <= 0 || source.indexSize > RICH_MDD_MAX_INDEX_BYTES) return false;
    if (!Number.isSafeInteger(source.keyCount) || source.keyCount <= 0) return false;
    if (!/^[a-f0-9]{64}$/u.test(String(source.indexSha256 || ""))) return false;
    total += source.sourceSize;
    totalIndex += source.indexSize;
    if (total > RICH_MDD_MAX_TOTAL_SOURCE_BYTES) return false;
    if (totalIndex > RICH_MDD_MAX_TOTAL_INDEX_BYTES) return false;
  }
  try {
    const ordered = validateMddCompanions(sources.map((source) => source.fileName), value.mdxFileName);
    return ordered.every((item, index) => item.fileName === sources[index].fileName);
  } catch { return false; }
}

export function makeResourceSnapshot({ packId, packVersion, mdxFileName, resources }) {
  const snapshot = {
    schemaVersion: RICH_MDD_RESOURCE_SCHEMA,
    packId,
    packVersion,
    mdxFileName: safeFileName(mdxFileName),
    sources: resources.map((resource, index) => ({
      ...resourceFilePaths(index),
      fileName: safeFileName(resource.fileName),
      sourceSize: Number(resource.sourceSize),
      indexSize: Number(resource.indexSize),
      indexSha256: String(resource.indexSha256 || "").toLowerCase(),
      keyCount: Number(resource.keyCount)
    })),
    installedAt: Date.now()
  };
  if (!validateResourceSnapshot(packId, snapshot)) throw richError("RICH_MDD_CORRUPT", "MDD resource metadata is invalid.");
  return snapshot;
}

export function validateResourceRequest({ dictionaryId, path } = {}) {
  const packId = normalizePackId(dictionaryId);
  const normalizedPath = normalizeMddResourcePath(path);
  if (!normalizedPath || normalizedPath.length > 1024) {
    throw richError("RICH_MDD_QUERY", "MDD resource path is invalid.");
  }
  return { packId, path: normalizedPath };
}

export function normalizeResourceImportMetadata(input, mdxFileName) {
  if (!input || typeof input !== "object" || !Array.isArray(input.resources)) {
    throw richError("RICH_MDD_CORRUPT", "MDD resource import metadata is invalid.");
  }
  const order = validateMddCompanions(input.resources.map((item) => item?.fileName), mdxFileName);
  if (order.length !== input.resources.length) throw richError("RICH_MDD_CORRUPT", "MDD resource file count is inconsistent.");
  let totalBytes = 0;
  let totalIndexBytes = 0;
  const resources = input.resources.map((item, index) => {
    const expected = order[index];
    const fileName = safeFileName(item.fileName);
    const sourceSize = Number(item.sourceSize);
    const indexSize = Number(item.indexSize);
    const keyCount = Number(item.keyCount);
    const indexSha256 = String(item.indexSha256 || "").toLowerCase();
    const paths = resourceFilePaths(index);
    if (fileName !== expected.fileName || item.sourcePath !== paths.sourcePath || item.indexPath !== paths.indexPath) {
      throw richError("RICH_MDD_CORRUPT", "MDD resource paths or order are inconsistent.");
    }
    if (!Number.isSafeInteger(sourceSize) || sourceSize <= 0 || sourceSize > RICH_MDD_MAX_SOURCE_BYTES) {
      throw richError("RICH_MDD_LIMIT", "An MDD file exceeds the 128 MiB safety limit.");
    }
    if (!Number.isSafeInteger(indexSize) || indexSize <= 0 || indexSize > RICH_MDD_MAX_INDEX_BYTES) {
      throw richError("RICH_MDD_LIMIT", "An MDD index exceeds the 16 MiB safety limit.");
    }
    if (!Number.isSafeInteger(keyCount) || keyCount <= 0 || !/^[a-f0-9]{64}$/u.test(indexSha256)) {
      throw richError("RICH_MDD_CORRUPT", "MDD index metadata is invalid.");
    }
    totalBytes += sourceSize;
    totalIndexBytes += indexSize;
    if (totalBytes > RICH_MDD_MAX_TOTAL_SOURCE_BYTES) throw richError("RICH_MDD_LIMIT", "MDD companions exceed the 512 MiB total safety limit.");
    if (totalIndexBytes > RICH_MDD_MAX_TOTAL_INDEX_BYTES) throw richError("RICH_MDD_LIMIT", "MDD indexes exceed the 32 MiB total safety limit.");
    return { ...paths, fileName, sourceSize, indexSize, indexSha256, keyCount };
  });
  return { resources, totalBytes };
}

export function parseMddIndex(bytes, sourceSize, validateMddIndex) {
  let index;
  try { index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch (cause) { throw richError("RICH_MDD_CORRUPT", "MDD resource index cannot be decoded.", { cause }); }
  try { validateMddIndex(index, { sourceSize }); }
  catch (cause) { throw richError("RICH_MDD_CORRUPT", cause?.message || "MDD resource index is invalid.", { cause }); }
  return index;
}

export function isResourceSnapshotForDictionary(snapshot, dictionary) {
  return validateResourceSnapshot(dictionary?.active?.packId, snapshot)
    && snapshot.mdxFileName === dictionary?.active?.fileName;
}

export function summarizeResources(snapshot) {
  return {
    resourceCount: Array.isArray(snapshot?.sources) ? snapshot.sources.length : 0,
    resourceBytes: Array.isArray(snapshot?.sources)
      ? snapshot.sources.reduce((sum, source) => sum + Number(source?.sourceSize || 0), 0)
      : 0
  };
}

export function safeFileName(value) {
  const text = String(value || "");
  if (!text || text.length > 240 || /[\\/\u0000-\u001f\u007f]/u.test(text) || text === "." || text === "..") {
    throw richError("RICH_MDD_INPUT", "MDD filename is invalid.");
  }
  return clampText(text, 240);
}

export function utf8Bytes(value) { return encoder.encode(String(value)).byteLength; }
