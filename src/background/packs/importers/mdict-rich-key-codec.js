import {
  MDICT_IMPORT_ERROR,
  MDictCursor,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import {
  decodeMdictText,
  validateMdictHeadword
} from "./mdict-metadata.js";
import { normalizeRichMdictLookupKey } from "./mdict-rich-metadata.js";

export function parseKeyBlockDescriptors(
  input,
  blockCount,
  entryCount,
  encoding,
  dataOffset,
  limits
) {
  const cursor = new MDictCursor(input);
  const descriptors = [];
  let countedEntries = 0;
  let compressedOffset = dataOffset;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const blockEntries = cursor.readSafeUint64Be("MDict key index entry count");
    requireMdictAtMost(blockEntries, limits.entryCount, "MDict key index entry count");
    if (!blockEntries) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key block declares zero entries.");
    }
    // Key-info endpoints can be normalized by StripKey and therefore be empty
    // even though the corresponding stored headword is non-empty. The decoded
    // key block below validates actual headwords and matches the endpoint pair.
    const firstKey = readSizedDescriptorKey(cursor, encoding, limits, "MDict first key");
    const lastKey = readSizedDescriptorKey(cursor, encoding, limits, "MDict last key");
    const compressedBytes = cursor.readSafeUint64Be("MDict key block compressed bytes");
    const decompressedBytes = cursor.readSafeUint64Be("MDict key block decompressed bytes");
    requireMdictAtMost(compressedBytes, limits.blockCompressedBytes, "MDict key block compressed bytes");
    requireMdictAtMost(decompressedBytes, limits.blockDecompressedBytes, "MDict key block decompressed bytes");
    if (compressedBytes < 8 || !decompressedBytes) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key block sizes are invalid.");
    }
    countedEntries = safeAdd(countedEntries, blockEntries, "key block entries");
    requireMdictAtMost(countedEntries, limits.entryCount, "MDict key index total entries");
    descriptors.push({
      entryCount: blockEntries,
      firstEntryIndex: countedEntries - blockEntries,
      firstKey,
      lastKey,
      compressedBytes,
      decompressedBytes,
      dataOffset: compressedOffset
    });
    compressedOffset = safeAdd(compressedOffset, compressedBytes, "key block offset");
  }
  if (cursor.remaining !== 0 || countedEntries !== entryCount) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key index size/count is inconsistent.");
  }
  return descriptors;
}

export function parseRecordBlockDescriptors(input, blockCount, dataOffset, limits) {
  const cursor = new MDictCursor(input);
  const descriptors = [];
  let compressedOffset = dataOffset;
  let uncompressedOffset = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const compressedBytes = cursor.readSafeUint64Be("MDict record block compressed bytes");
    const decompressedBytes = cursor.readSafeUint64Be("MDict record block decompressed bytes");
    requireMdictAtMost(compressedBytes, limits.blockCompressedBytes, "MDict record block compressed bytes");
    requireMdictAtMost(decompressedBytes, limits.blockDecompressedBytes, "MDict record block decompressed bytes");
    if (compressedBytes < 8 || !decompressedBytes) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record block sizes are invalid.");
    }
    descriptors.push({
      compressedBytes,
      decompressedBytes,
      dataOffset: compressedOffset,
      uncompressedOffset
    });
    compressedOffset = safeAdd(compressedOffset, compressedBytes, "record block offset");
    uncompressedOffset = safeAdd(uncompressedOffset, decompressedBytes, "record block offset");
  }
  return descriptors;
}

export function parseKeyBlock(input, descriptor, header, { signal } = {}) {
  throwIfAborted(signal);
  const encodingName = typeof header.encoding === "string"
    ? header.encoding
    : header.encoding?.name;
  const encoding = encodingForName(encodingName);
  const cursor = new MDictCursor(input);
  const keys = [];
  let previousRecordOffset = -1;
  for (let index = 0; index < descriptor.entryCount; index += 1) {
    if ((index & 0x3ff) === 0) throwIfAborted(signal);
    const recordOffset = cursor.readSafeUint64Be("MDict record offset");
    const displayForm = readNullTerminatedKey(cursor, encoding);
    validateMdictHeadword(displayForm);
    if (recordOffset < previousRecordOffset) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record offsets are not monotonic.");
    }
    previousRecordOffset = recordOffset;
    keys.push({ recordOffset, displayForm });
  }
  throwIfAborted(signal);
  const first = keys[0]?.displayForm || "";
  const last = keys.at(-1)?.displayForm || "";
  // MDict writers normally store raw display-form endpoints. Older TranslateFlow
  // indexes stored the normalized pair, so accept either complete representation.
  // Never normalize the descriptors or mix a raw match at one end with a normalized
  // match at the other.
  const rawPair = first === descriptor.firstKey && last === descriptor.lastKey;
  const legacyPair = normalizeRichMdictLookupKey(first, header) === descriptor.firstKey &&
    normalizeRichMdictLookupKey(last, header) === descriptor.lastKey;
  if (
    cursor.remaining !== 0 ||
    (!rawPair && !legacyPair)
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key block boundary does not match its index.", {
      check: cursor.remaining ? "key-block-length" : "key-block-boundary",
      trailingBytes: cursor.remaining
    });
  }
  return keys;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("MDict lookup cancelled.", "AbortError");
}

function readSizedDescriptorKey(cursor, encoding, limits, label) {
  const units = cursor.readUint16Be(label + " length");
  const byteLength = units * encoding.unitBytes;
  requireMdictAtMost(byteLength, limits.headwordBytes, label + " bytes");
  const raw = cursor.read(byteLength, label);
  const terminator = cursor.read(encoding.unitBytes, label + " terminator");
  if (!terminator.every((value) => value === 0)) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, label + " is missing its null terminator.");
  }
  return decodeMdictText(raw, encoding, label);
}

function readNullTerminatedKey(cursor, encoding) {
  const start = cursor.offset;
  let end = -1;
  for (
    let offset = start;
    offset + encoding.unitBytes <= cursor.bytes.byteLength;
    offset += encoding.unitBytes
  ) {
    if (
      cursor.bytes[offset] === 0 &&
      (encoding.unitBytes === 1 || cursor.bytes[offset + 1] === 0)
    ) {
      end = offset;
      break;
    }
    if (offset - start >= 1024) break;
  }
  if (end < 0) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict headword is unterminated or too long.");
  }
  const raw = cursor.read(end - start, "MDict headword");
  const terminator = cursor.read(encoding.unitBytes, "MDict headword terminator");
  if (!terminator.every((value) => value === 0)) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict headword terminator is invalid.");
  }
  return decodeMdictText(raw, encoding, "MDict headword");
}

function encodingForName(name) {
  if (name === "UTF-8") return { name, unitBytes: 1, decoder: new TextDecoder("utf-8", { fatal: true }) };
  if (name === "UTF-16") return { name, unitBytes: 2, decoder: new TextDecoder("utf-16le", { fatal: true }) };
  mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict index encoding is invalid.");
}


export function safeAdd(left, right, label) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    mdictFail(MDICT_IMPORT_ERROR.LIMIT, "MDict " + label + " exceeds safe integer range.");
  }
  return value;
}
