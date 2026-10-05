import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import { safeAdd } from "./mdict-rich-key-codec.js";

export const RICH_MDICT_INDEX_SCHEMA_VERSION = 1;
export const RICH_MDICT_INDEX_FORMAT = "mdx-v2-rich";
export const RICH_MDICT_IMPORT_LIMITS = Object.freeze({
  ...MDICT_IMPORT_LIMITS,
  // ECDICT 1.0.28 has 3,402,564 entries and 246,598,512 uncompressed
  // record bytes. These limits cover that reviewed corpus with headroom.
  entryCount: 4_000_000,
  totalRecordBytes: 512 * 1024 * 1024,
  entryBytes: 1024 * 1024,
  expandedTextBytes: 2 * 1024 * 1024,
  // The reviewed corpus peaks at a 64 KiB record block. Keep each individual
  // compressed range and inflate bounded for key info, keys and record data.
  blockCompressedBytes: 4 * 1024 * 1024,
  blockDecompressedBytes: 4 * 1024 * 1024
});

const STYLE_SHEET_RULES_MAX = 255;

export function validateRichMdictIndex(index, {
  sourceSize = index?.sourceSize,
  limits = RICH_MDICT_IMPORT_LIMITS
} = {}) {
  if (
    !index ||
    index.schemaVersion !== RICH_MDICT_INDEX_SCHEMA_VERSION ||
    index.format !== RICH_MDICT_INDEX_FORMAT ||
    !Number.isSafeInteger(index.sourceSize) ||
    index.sourceSize !== sourceSize ||
    !Number.isSafeInteger(index.entryCount) ||
    index.entryCount <= 0 ||
    !Number.isSafeInteger(index.totalRecordBytes) ||
    index.totalRecordBytes <= 0 ||
    !Array.isArray(index.keyBlocks) ||
    !Array.isArray(index.recordBlocks) ||
    !validHeader(index.header) ||
    index.keyInfoCompression !== "zlib" ||
    index.keyInfoEncrypted !== (index.header.encrypted === 2)
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict index metadata is invalid.");
  }
  requireMdictAtMost(index.sourceSize, limits.fileBytes, "MDX bytes");
  requireMdictAtMost(index.entryCount, limits.entryCount, "MDict entry count");
  requireMdictAtMost(index.totalRecordBytes, limits.totalRecordBytes, "MDict total record bytes");

  const offsets = [
    "keyPreambleOffset",
    "keyInfoOffset",
    "keyInfoCompressedBytes",
    "keyBlocksOffset",
    "keyBlocksBytes",
    "recordSectionOffset",
    "recordBlocksOffset",
    "recordBlocksBytes"
  ];
  if (offsets.some((field) => !Number.isSafeInteger(index[field]) || index[field] < 0)) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict section offset is invalid.");
  }
  if (
    index.keyInfoOffset !== index.keyPreambleOffset + 44 ||
    index.keyBlocksOffset !== index.keyInfoOffset + index.keyInfoCompressedBytes ||
    index.recordSectionOffset !== index.keyBlocksOffset + index.keyBlocksBytes ||
    index.recordBlocksOffset < index.recordSectionOffset + 32 ||
    index.recordBlocksOffset > index.sourceSize
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict section layout is inconsistent.");
  }
  requireMdictAtMost(index.keyInfoCompressedBytes, limits.blockCompressedBytes, "MDict key info compressed bytes");
  requireMdictAtMost(index.keyBlocksBytes, index.sourceSize, "MDict key blocks bytes");
  requireMdictAtMost(index.recordBlocksBytes, index.sourceSize, "MDict record blocks bytes");
  validateKeys(index, limits);
  validateRecords(index, limits);
  return index;
}

function validHeader(header) {
  const seenRuleIds = new Set();
  const validRules = Array.isArray(header?.styleSheetRules) &&
    header.styleSheetRules.length <= STYLE_SHEET_RULES_MAX &&
    header.styleSheetRules.every((rule) => {
      if (
        !rule ||
        !Number.isInteger(rule.id) ||
        rule.id < 1 ||
        rule.id > 255 ||
        seenRuleIds.has(rule.id) ||
        typeof rule.begin !== "string" ||
        typeof rule.end !== "string" ||
        new TextEncoder().encode(rule.begin).byteLength > 4096 ||
        new TextEncoder().encode(rule.end).byteLength > 4096
      ) return false;
      seenRuleIds.add(rule.id);
      return true;
    });
  return Boolean(
    header &&
    header.generatedByEngineVersion === "2.0" &&
    supportedRequiredEngineVersion(header.requiredEngineVersion) &&
    ["UTF-8", "UTF-16"].includes(header.encoding) &&
    ["HTML", "TEXT"].includes(String(header.format).toUpperCase()) &&
    [0, 2].includes(header.encrypted) &&
    typeof header.keyCaseSensitive === "boolean" &&
    typeof header.stripKey === "boolean" &&
    typeof header.compact === "string" &&
    typeof header.compat === "string" &&
    /^(?:yes|no)$/iu.test(header.compact) &&
    /^(?:yes|no)$/iu.test(header.compat) &&
    typeof header.styleSheet === "string" &&
    new TextEncoder().encode(header.styleSheet).byteLength <= 64 * 1024 &&
    validRules
  );
}

function supportedRequiredEngineVersion(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    return false;
  }
  const version = Number(value);
  return Number.isFinite(version) && version > 0 && version <= 2;
}

function validateKeys(index, limits) {
  if (
    index.keyBlocks.length === 0 ||
    index.keyBlocks.length > limits.blockCount
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict key block count is invalid.");
  }
  let byteOffset = index.keyBlocksOffset;
  let ordinal = 0;
  let previousRecordOffset = -1;
  for (const block of index.keyBlocks) {
    if (
      !block ||
      !Number.isSafeInteger(block.dataOffset) ||
      !Number.isSafeInteger(block.compressedBytes) ||
      !Number.isSafeInteger(block.decompressedBytes) ||
      !Number.isSafeInteger(block.entryCount) ||
      !Number.isSafeInteger(block.firstEntryIndex) ||
      !Number.isSafeInteger(block.firstRecordOffset) ||
      !Number.isSafeInteger(block.lastRecordOffset) ||
      block.firstRecordOffset < 0 ||
      block.lastRecordOffset < 0 ||
      block.dataOffset !== byteOffset ||
      block.firstEntryIndex !== ordinal ||
      block.compressedBytes < 8 ||
      block.decompressedBytes <= 0 ||
      block.entryCount <= 0 ||
      block.firstRecordOffset > block.lastRecordOffset ||
      block.firstRecordOffset < previousRecordOffset ||
      block.lastRecordOffset >= index.totalRecordBytes ||
      !validHeadword(block.firstKey, limits.headwordBytes) ||
      !validHeadword(block.lastKey, limits.headwordBytes) ||
      !validSortKey(block.lookupMinKey, limits.headwordBytes) ||
      !validSortKey(block.lookupMaxKey, limits.headwordBytes) ||
      block.lookupMinKey > block.lookupMaxKey
    ) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict key block index is invalid.");
    }
    requireMdictAtMost(block.compressedBytes, limits.blockCompressedBytes, "MDict key block compressed bytes");
    requireMdictAtMost(block.decompressedBytes, limits.blockDecompressedBytes, "MDict key block decompressed bytes");
    requireMdictAtMost(block.entryCount, limits.entryCount, "MDict key block entries");
    byteOffset = safeAdd(byteOffset, block.compressedBytes, "key block offset");
    ordinal = safeAdd(ordinal, block.entryCount, "key block entries");
    previousRecordOffset = block.lastRecordOffset;
  }
  if (ordinal !== index.entryCount || byteOffset !== index.recordSectionOffset) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict key block totals are inconsistent.");
  }
}

function validateRecords(index, limits) {
  if (
    index.recordBlocks.length === 0 ||
    index.recordBlocks.length > limits.blockCount
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict record block count is invalid.");
  }
  let byteOffset = index.recordBlocksOffset;
  let recordOffset = 0;
  for (const block of index.recordBlocks) {
    if (
      !block ||
      !Number.isSafeInteger(block.dataOffset) ||
      !Number.isSafeInteger(block.uncompressedOffset) ||
      !Number.isSafeInteger(block.compressedBytes) ||
      !Number.isSafeInteger(block.decompressedBytes) ||
      block.dataOffset !== byteOffset ||
      block.uncompressedOffset !== recordOffset ||
      block.compressedBytes < 8 ||
      block.decompressedBytes <= 0
    ) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict record block index is invalid.");
    }
    requireMdictAtMost(block.compressedBytes, limits.blockCompressedBytes, "MDict record block compressed bytes");
    requireMdictAtMost(block.decompressedBytes, limits.blockDecompressedBytes, "MDict record block decompressed bytes");
    byteOffset = safeAdd(byteOffset, block.compressedBytes, "record block offset");
    recordOffset = safeAdd(recordOffset, block.decompressedBytes, "record offset");
  }
  if (
    byteOffset !== index.sourceSize ||
    byteOffset - index.recordBlocksOffset !== index.recordBlocksBytes ||
    recordOffset !== index.totalRecordBytes
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict record block totals are inconsistent.");
  }
}

function validHeadword(value, maximumBytes) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maximumBytes &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

function validSortKey(value, maximumBytes) {
  return (
    typeof value === "string" &&
    new TextEncoder().encode(value).byteLength <= maximumBytes &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}
