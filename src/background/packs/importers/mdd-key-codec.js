import {
  MDICT_IMPORT_ERROR,
  MDictCursor,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import { compareMddResourcePaths, normalizeMddResourcePath } from "./mdd-resource-path.js";
import { safeAdd } from "./mdict-rich-key-codec.js";

const UTF16LE = new TextDecoder("utf-16le", { fatal: true });

export function parseMddKeyBlock(input, descriptor, totalRecordBytes, {
  orderMode = "case-sensitive",
  orderValidator = null
} = {}) {
  const cursor = new MDictCursor(input);
  const entries = [];
  const validateOrder = orderValidator || createMddResourceOrderValidator(orderMode);
  let firstRecordOffset = -1;
  let lastRecordOffset = -1;
  for (let index = 0; index < descriptor.entryCount; index += 1) {
    const recordOffset = cursor.readSafeUint64Be("MDD resource record offset");
    const rawPath = readNullTerminatedPath(cursor);
    const path = normalizeMddResourcePath(rawPath);
    if (recordOffset >= totalRecordBytes || recordOffset < lastRecordOffset) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD resource record offset is invalid.");
    }
    validateOrder(path);
    if (firstRecordOffset < 0) firstRecordOffset = recordOffset;
    lastRecordOffset = recordOffset;
    entries.push({ path, recordOffset });
  }
  if (
    cursor.remaining !== 0 ||
    compareMddResourcePaths(entries[0]?.path || "", descriptor.expectedFirstKey || "", orderMode, false) !== 0 ||
    compareMddResourcePaths(entries.at(-1)?.path || "", descriptor.expectedLastKey || "", orderMode, false) !== 0
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key block does not match its descriptor.", {
      trailingBytes: cursor.remaining
    });
  }
  return {
    entries,
    firstRecordOffset,
    lastRecordOffset,
    firstKey: entries[0].path,
    lastKey: entries.at(-1).path
  };
}

export function createMddResourceOrderValidator(orderMode) {
  let previousPath = null;
  return (path) => {
    if (previousPath && compareMddResourcePaths(path, previousPath, orderMode) <= 0) {
      mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDD resource keys are duplicated or unsorted.");
    }
    previousPath = path;
  };
}

export function mddResourceOrderMode(index) {
  return index?.schemaVersion === 1 ? "case-sensitive" : index?.keyOrder;
}

export function parseMddKeyBlockDescriptors(
  input,
  blockCount,
  entryCount,
  dataOffset,
  limits
) {
  const cursor = new MDictCursor(input);
  const descriptors = [];
  let countedEntries = 0;
  let compressedOffset = dataOffset;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const blockEntries = cursor.readSafeUint64Be("MDD key block entry count");
    requireMdictAtMost(blockEntries, limits.entryCount, "MDD key block entries");
    if (!blockEntries) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key block declares no paths.");
    }
    const firstKey = readSizedPath(cursor, limits, "MDD first resource path");
    const lastKey = readSizedPath(cursor, limits, "MDD last resource path");
    const compressedBytes = cursor.readSafeUint64Be("MDD key block compressed bytes");
    const decompressedBytes = cursor.readSafeUint64Be("MDD key block decompressed bytes");
    requireMdictAtMost(compressedBytes, limits.blockCompressedBytes, "MDD key block compressed bytes");
    requireMdictAtMost(decompressedBytes, limits.blockDecompressedBytes, "MDD key block decompressed bytes");
    if (compressedBytes < 8 || !decompressedBytes) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key block sizes are invalid.");
    }
    if (blockEntries > Math.floor(decompressedBytes / 12)) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key count cannot fit in its declared block size.");
    }
    requireMdictAtMost(decompressedBytes, compressedBytes * limits.compressionRatio, "MDD key block compression ratio");
    countedEntries = safeAdd(countedEntries, blockEntries, "MDD key block entries");
    requireMdictAtMost(countedEntries, limits.entryCount, "MDD total key count");
    descriptors.push({
      entryCount: blockEntries,
      firstEntryIndex: countedEntries - blockEntries,
      firstKey,
      lastKey,
      lookupMinKey: firstKey,
      lookupMaxKey: lastKey,
      compressedBytes,
      decompressedBytes,
      dataOffset: compressedOffset
    });
    compressedOffset = safeAdd(compressedOffset, compressedBytes, "MDD key block offset");
  }
  if (cursor.remaining !== 0 || countedEntries !== entryCount) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key index size or count is inconsistent.");
  }
  return descriptors;
}

function readNullTerminatedPath(cursor) {
  const start = cursor.offset;
  let end = -1;
  for (
    let offset = start;
    offset + 2 <= cursor.bytes.byteLength;
    offset += 2
  ) {
    if (cursor.bytes[offset] === 0 && cursor.bytes[offset + 1] === 0) {
      end = offset;
      break;
    }
    if (offset - start >= 4096) break;
  }
  if (end < 0 || end === start) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD resource key is empty, too long, or unterminated.");
  }
  const raw = cursor.read(end - start, "MDD resource key");
  const terminator = cursor.read(2, "MDD resource key terminator");
  if (terminator[0] !== 0 || terminator[1] !== 0) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD resource key terminator is invalid.");
  }
  try {
    return UTF16LE.decode(raw);
  } catch (cause) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD resource key is not valid UTF-16LE.", { cause });
  }
}

export async function addMddKeyBlockBounds(keyBlocks, { source, index, decode, limits }) {
  let previousRecordOffset = -1;
  let previousPath = "";
  const orderMode = mddResourceOrderMode(index);
  const orderValidator = createMddResourceOrderValidator(orderMode);
  let totalKeyBlockBytes = 0;
  for (let blockIndex = 0; blockIndex < keyBlocks.length; blockIndex += 1) {
    const descriptor = keyBlocks[blockIndex];
    totalKeyBlockBytes = safeAdd(totalKeyBlockBytes, descriptor.decompressedBytes, "MDD key block bytes");
    requireMdictAtMost(totalKeyBlockBytes, limits.totalKeyBlockBytes, "MDD total key block bytes");
    const decoded = await decode({ source, index, blockIndex });
    const parsed = parseMddKeyBlock(
      decoded.bytes,
      {
        ...descriptor,
        expectedFirstKey: descriptor.firstKey,
        expectedLastKey: descriptor.lastKey
      },
      index.totalRecordBytes,
      { orderMode, orderValidator }
    );
    if (
      parsed.firstRecordOffset < previousRecordOffset ||
      (previousPath && compareMddResourcePaths(parsed.firstKey, previousPath, orderMode) <= 0)
    ) {
      mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDD resource keys or offsets are duplicated or unsorted.");
    }
    descriptor.firstKey = parsed.firstKey;
    descriptor.lastKey = parsed.lastKey;
    descriptor.lookupMinKey = parsed.firstKey;
    descriptor.lookupMaxKey = parsed.lastKey;
    descriptor.firstRecordOffset = parsed.firstRecordOffset;
    descriptor.lastRecordOffset = parsed.lastRecordOffset;
    previousPath = parsed.lastKey;
    previousRecordOffset = parsed.lastRecordOffset;
  }
  return totalKeyBlockBytes;
}

function readSizedPath(cursor, limits, label) {
  const units = cursor.readUint16Be(label + " length");
  const byteLength = units * 2;
  requireMdictAtMost(byteLength, limits.headwordBytes, label + " bytes");
  const raw = cursor.read(byteLength, label);
  const terminator = cursor.read(2, label + " terminator");
  if (terminator[0] !== 0 || terminator[1] !== 0) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, label + " has no UTF-16LE terminator.");
  }
  let path;
  try {
    path = UTF16LE.decode(raw);
  } catch (cause) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, label + " is not valid UTF-16LE.", { cause });
  }
  return normalizeMddResourcePath(path);
}
