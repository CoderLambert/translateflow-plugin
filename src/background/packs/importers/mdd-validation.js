import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import { compareMddResourcePaths, normalizeMddResourcePath } from "./mdd-resource-path.js";
import { LOCAL_DICTIONARY_MAX_PACKAGE_SOURCE_BYTES } from "../../../shared/local-dictionary-limits.js";

export const MDD_INDEX_SCHEMA_VERSION = 1;
export const MDD_INDEX_FORMAT = "mdd-v2";
export const MDD_IMPORT_LIMITS = Object.freeze({
  ...MDICT_IMPORT_LIMITS,
  fileBytes: LOCAL_DICTIONARY_MAX_PACKAGE_SOURCE_BYTES,
  entryCount: 1_000_000,
  keyIndexBytes: 16 * 1024 * 1024,
  blockCompressedBytes: 4 * 1024 * 1024,
  blockDecompressedBytes: 4 * 1024 * 1024,
  headwordBytes: 4096,
  totalKeyBlockBytes: 64 * 1024 * 1024,
  totalRecordBytes: 2 * 1024 * 1024 * 1024,
  resourceBytes: 8 * 1024 * 1024,
  compressionRatio: 100
});

export function validateMddIndex(index, {
  sourceSize = index?.sourceSize,
  limits = MDD_IMPORT_LIMITS,
  checkSerializedSize = true
} = {}) {
  if (
    !index ||
    !hasOnlyFields(index, [
      "schemaVersion", "format", "sourceSize", "header", "keyCount", "totalKeyBlockBytes",
      "totalRecordBytes", "keyInfoCompression", "keyInfoEncrypted", "keyPreambleOffset",
      "keyInfoOffset", "keyInfoCompressedBytes", "keyBlocksOffset", "keyBlocksBytes",
      "recordSectionOffset", "recordBlocksOffset", "recordBlocksBytes", "keyBlocks", "recordBlocks"
    ]) ||
    index.schemaVersion !== MDD_INDEX_SCHEMA_VERSION ||
    index.format !== MDD_INDEX_FORMAT ||
    !Number.isSafeInteger(index.sourceSize) ||
    index.sourceSize !== sourceSize ||
    !Number.isSafeInteger(index.keyCount) ||
    index.keyCount <= 0 ||
    !Number.isSafeInteger(index.totalKeyBlockBytes) ||
    !Number.isSafeInteger(index.totalRecordBytes) ||
    !Array.isArray(index.keyBlocks) ||
    !Array.isArray(index.recordBlocks) ||
    !validHeader(index.header) ||
    !["none", "zlib"].includes(index.keyInfoCompression) ||
    index.keyInfoEncrypted !== (index.header.encrypted === 2)
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD index metadata is invalid.");
  }
  requireMdictAtMost(index.sourceSize, limits.fileBytes, "MDD bytes");
  requireMdictAtMost(index.keyCount, limits.entryCount, "MDD resource count");
  requireMdictAtMost(index.totalKeyBlockBytes, limits.totalKeyBlockBytes, "MDD key bytes");
  requireMdictAtMost(index.totalRecordBytes, limits.totalRecordBytes, "MDD record bytes");
  if (
    !Number.isSafeInteger(index.keyPreambleOffset) ||
    !Number.isSafeInteger(index.keyInfoOffset) ||
    !Number.isSafeInteger(index.keyInfoCompressedBytes) ||
    !Number.isSafeInteger(index.keyBlocksOffset) ||
    !Number.isSafeInteger(index.keyBlocksBytes) ||
    !Number.isSafeInteger(index.recordSectionOffset) ||
    !Number.isSafeInteger(index.recordBlocksOffset) ||
    !Number.isSafeInteger(index.recordBlocksBytes) ||
    index.keyPreambleOffset < 4 ||
    index.keyInfoOffset < 0 ||
    index.keyInfoCompressedBytes < 8 ||
    index.keyBlocksOffset < 0 ||
    index.keyBlocksBytes <= 0 ||
    index.recordSectionOffset < 0 ||
    index.recordBlocksOffset < 0 ||
    index.recordBlocksBytes <= 0 ||
    index.keyInfoOffset !== index.keyPreambleOffset + 44 ||
    index.keyBlocksOffset !== index.keyInfoOffset + index.keyInfoCompressedBytes ||
    index.recordSectionOffset !== index.keyBlocksOffset + index.keyBlocksBytes ||
    index.recordBlocksOffset !== index.recordSectionOffset + 32 + index.recordBlocks.length * 16 ||
    index.recordBlocksOffset > index.sourceSize
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD section offsets are inconsistent.");
  }
  requireMdictAtMost(index.keyInfoCompressedBytes, limits.blockCompressedBytes, "MDD key info bytes");
  requireMdictAtMost(index.keyBlocksBytes, index.sourceSize, "MDD key block bytes");
  requireMdictAtMost(index.recordBlocksBytes, index.sourceSize, "MDD record block bytes");
  validateKeys(index, limits);
  validateRecords(index, limits);
  if (checkSerializedSize) {
    requireMdictAtMost(
      new TextEncoder().encode(JSON.stringify(index)).byteLength,
      limits.keyIndexBytes,
      "MDD compact index bytes"
    );
  }
  return index;
}

function validHeader(header) {
  return Boolean(
    header &&
    hasOnlyFields(header, ["title", "generatedByEngineVersion", "requiredEngineVersion", "encrypted"]) &&
    header.generatedByEngineVersion === "2.0" &&
    supportedRequiredVersion(header.requiredEngineVersion) &&
    [0, 2].includes(header.encrypted) &&
    typeof header.title === "string" &&
    header.title.length <= 4096 &&
    !/[\u0000-\u001F\u007F]/u.test(header.title)
  );
}

function supportedRequiredVersion(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return false;
  const version = Number(value);
  return Number.isFinite(version) && version > 0 && version <= 2;
}

function validateKeys(index, limits) {
  if (!index.keyBlocks.length || index.keyBlocks.length > limits.blockCount) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key block count is invalid.");
  }
  let byteOffset = index.keyBlocksOffset;
  let keyCount = 0;
  let keyBytes = 0;
  let previousKey = "";
  let previousRecordOffset = -1;
  for (const block of index.keyBlocks) {
    if (
      !block ||
      !hasOnlyFields(block, [
        "entryCount", "firstEntryIndex", "firstKey", "lastKey", "lookupMinKey", "lookupMaxKey",
        "compressedBytes", "decompressedBytes", "dataOffset", "firstRecordOffset", "lastRecordOffset"
      ]) ||
      !Number.isSafeInteger(block.dataOffset) ||
      !Number.isSafeInteger(block.compressedBytes) ||
      !Number.isSafeInteger(block.decompressedBytes) ||
      !Number.isSafeInteger(block.entryCount) ||
      !Number.isSafeInteger(block.firstEntryIndex) ||
      !Number.isSafeInteger(block.firstRecordOffset) ||
      !Number.isSafeInteger(block.lastRecordOffset) ||
      block.dataOffset !== byteOffset ||
      block.firstEntryIndex !== keyCount ||
      block.compressedBytes < 8 ||
      block.decompressedBytes <= 0 ||
      block.entryCount <= 0 ||
      block.entryCount > Math.floor(block.decompressedBytes / 12) ||
      block.firstRecordOffset < 0 ||
      block.firstRecordOffset > block.lastRecordOffset ||
      block.firstRecordOffset < previousRecordOffset ||
      block.lastRecordOffset >= index.totalRecordBytes ||
      !validCanonicalPath(block.firstKey) ||
      !validCanonicalPath(block.lastKey) ||
      !validCanonicalPath(block.lookupMinKey) ||
      !validCanonicalPath(block.lookupMaxKey) ||
      block.firstKey !== block.lookupMinKey ||
      block.lastKey !== block.lookupMaxKey ||
      compareMddResourcePaths(block.lookupMinKey, block.lookupMaxKey) > 0 ||
      (previousKey && compareMddResourcePaths(block.lookupMinKey, previousKey) <= 0)
    ) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key block descriptor is invalid.");
    }
    requireMdictAtMost(block.compressedBytes, limits.blockCompressedBytes, "MDD key block bytes");
    requireMdictAtMost(block.decompressedBytes, limits.blockDecompressedBytes, "MDD key block inflated bytes");
    requireMdictAtMost(block.decompressedBytes, block.compressedBytes * limits.compressionRatio, "MDD key block compression ratio");
    byteOffset += block.compressedBytes;
    keyCount += block.entryCount;
    keyBytes += block.decompressedBytes;
    previousKey = block.lookupMaxKey;
    previousRecordOffset = block.lastRecordOffset;
  }
  if (
    keyCount !== index.keyCount ||
    keyBytes !== index.totalKeyBlockBytes ||
    byteOffset !== index.recordSectionOffset
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key block totals are inconsistent.");
  }
}

function validateRecords(index, limits) {
  if (!index.recordBlocks.length || index.recordBlocks.length > limits.blockCount) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD record block count is invalid.");
  }
  let byteOffset = index.recordBlocksOffset;
  let recordOffset = 0;
  for (const block of index.recordBlocks) {
    if (
      !block ||
      !hasOnlyFields(block, ["compressedBytes", "decompressedBytes", "dataOffset", "uncompressedOffset"]) ||
      !Number.isSafeInteger(block.dataOffset) ||
      !Number.isSafeInteger(block.uncompressedOffset) ||
      !Number.isSafeInteger(block.compressedBytes) ||
      !Number.isSafeInteger(block.decompressedBytes) ||
      block.dataOffset !== byteOffset ||
      block.uncompressedOffset !== recordOffset ||
      block.compressedBytes < 8 ||
      block.decompressedBytes <= 0
    ) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD record block descriptor is invalid.");
    }
    requireMdictAtMost(block.compressedBytes, limits.blockCompressedBytes, "MDD record block bytes");
    requireMdictAtMost(block.decompressedBytes, limits.blockDecompressedBytes, "MDD record inflated bytes");
    requireMdictAtMost(block.decompressedBytes, block.compressedBytes * limits.compressionRatio, "MDD record compression ratio");
    byteOffset += block.compressedBytes;
    recordOffset += block.decompressedBytes;
  }
  if (
    byteOffset !== index.sourceSize ||
    byteOffset - index.recordBlocksOffset !== index.recordBlocksBytes ||
    recordOffset !== index.totalRecordBytes
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD record block totals are inconsistent.");
  }
}

function validCanonicalPath(value) {
  try {
    return typeof value === "string" && normalizeMddResourcePath(value) === value;
  } catch {
    return false;
  }
}

function hasOnlyFields(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
