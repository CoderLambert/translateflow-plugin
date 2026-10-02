import {
  MDICT_IMPORT_ERROR,
  MDictImportError,
  MDictCursor,
  adler32,
  mdictFail,
  readMdictUint32Be,
  requireMdictAtMost
} from "./mdict-contract.js";
import {
  decodeMdictBlock,
  decryptMdictKeyInfoBlock
} from "./mdict-block-codec.js";
import {
  normalizeRichMdictLookupKey,
  parseRichMdictHeader
} from "./mdict-rich-metadata.js";
import {
  RICH_MDICT_INDEX_FORMAT,
  RICH_MDICT_INDEX_SCHEMA_VERSION,
  RICH_MDICT_IMPORT_LIMITS,
  validateRichMdictIndex
} from "./mdict-rich-validation.js";
import {
  parseKeyBlockDescriptors,
  parseRecordBlockDescriptors,
  parseKeyBlock,
  safeAdd
} from "./mdict-rich-key-codec.js";
import {
  readSourceRange,
  validateMdictSource,
  withMdictAbortSignal
} from "./mdict-rich-source.js";

export { readSourceRange } from "./mdict-rich-source.js";


const STYLE_SHEET_RULES_MAX = 255;

export async function buildRichMdictIndex(options = {}) {
  const diagnostic = { stage: "header" };
  try {
    return await buildIndex(options, diagnostic);
  } catch (error) {
    if (error instanceof MDictImportError) error.stage = diagnostic.stage;
    throw error;
  }
}

async function buildIndex({
  source,
  limits = RICH_MDICT_IMPORT_LIMITS,
  decompressionStreamFactory,
  signal
} = {}, diagnostic) {
  const rangeSource = withMdictAbortSignal(source, signal);
  throwIfAborted(signal);
  const sourceSize = validateMdictSource(rangeSource, limits);
  const headerSizeBytes = await readSourceRange(rangeSource, 0, 4);
  const headerBytesLength = readMdictUint32Be(headerSizeBytes, 0);
  requireMdictAtMost(
    headerBytesLength,
    limits.headerBytes,
    "MDict header bytes"
  );
  const headerAndLength = await readSourceRange(
    rangeSource,
    0,
    headerBytesLength + 8
  );
  const header = parseRichMdictHeader(
    headerAndLength,
    limits
  );
  diagnostic.stage = "key-index";
  const keyPreambleOffset = headerBytesLength + 8;
  const preambleBytes = await readSourceRange(
    rangeSource,
    keyPreambleOffset,
    44
  );
  const keyPreamble = preambleBytes.subarray(0, 40);
  if (
    adler32(keyPreamble) !==
    readMdictUint32Be(preambleBytes, 40)
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict keyword section preamble checksum mismatch."
    );
  }

  const preamble = new MDictCursor(keyPreamble);
  const keyBlockCount = preamble.readSafeUint64Be(
    "MDict key block count"
  );
  const entryCount = preamble.readSafeUint64Be(
    "MDict entry count"
  );
  const keyInfoDecompressedBytes = preamble.readSafeUint64Be(
    "MDict key index decompressed bytes"
  );
  const keyInfoCompressedBytes = preamble.readSafeUint64Be(
    "MDict key index compressed bytes"
  );
  const keyBlocksBytes = preamble.readSafeUint64Be(
    "MDict key blocks bytes"
  );

  requireMdictAtMost(keyBlockCount, limits.blockCount, "MDict key block count");
  requireMdictAtMost(entryCount, limits.entryCount, "MDict entry count");
  requireMdictAtMost(
    keyInfoDecompressedBytes,
    limits.keyIndexBytes,
    "MDict key index decompressed bytes"
  );
  requireMdictAtMost(
    keyInfoCompressedBytes,
    limits.blockCompressedBytes,
    "MDict key index compressed bytes"
  );
  requireMdictAtMost(keyBlocksBytes, sourceSize, "MDict key blocks bytes");
  if (!keyBlockCount || !entryCount || preamble.remaining !== 0) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict keyword section preamble is invalid."
    );
  }

  const keyInfoOffset = keyPreambleOffset + 44;
  const keyInfoBytes = await readSourceRange(
    rangeSource,
    keyInfoOffset,
    keyInfoCompressedBytes
  );
  const decodedKeyInfo = await decodeMdictKeyInfo({
    input: keyInfoBytes,
    encrypted: header.encrypted,
    expectedBytes: keyInfoDecompressedBytes,
    limits,
    decompressionStreamFactory,
    signal
  });
  const keyBlocksOffset = keyInfoOffset + keyInfoCompressedBytes;
  const keyBlocks = parseKeyBlockDescriptors(
    decodedKeyInfo.bytes,
    keyBlockCount,
    entryCount,
    header.encoding,
    keyBlocksOffset,
    limits
  );
  const compressedKeyBlocks = keyBlocks.reduce(
    (sum, descriptor) => safeAdd(sum, descriptor.compressedBytes, "key block bytes"),
    0
  );
  if (compressedKeyBlocks !== keyBlocksBytes) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict key block size total does not match keyword preamble."
    );
  }

  const recordSectionOffset = keyBlocksOffset + keyBlocksBytes;
  diagnostic.stage = "record-index";
  const recordHeader = new MDictCursor(
    await readSourceRange(rangeSource, recordSectionOffset, 32)
  );
  const recordBlockCount = recordHeader.readSafeUint64Be(
    "MDict record block count"
  );
  const recordEntryCount = recordHeader.readSafeUint64Be(
    "MDict record entry count"
  );
  const recordIndexBytes = recordHeader.readSafeUint64Be(
    "MDict record index bytes"
  );
  const recordBlocksBytes = recordHeader.readSafeUint64Be(
    "MDict record blocks bytes"
  );
  requireMdictAtMost(recordBlockCount, limits.blockCount, "MDict record block count");
  requireMdictAtMost(recordBlocksBytes, sourceSize, "MDict record blocks bytes");
  if (
    !recordBlockCount ||
    recordEntryCount !== entryCount ||
    recordIndexBytes !== recordBlockCount * 16
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict record section header is inconsistent."
    );
  }

  const recordDescriptorsOffset = recordSectionOffset + 32;
  const recordDescriptorBytes = await readSourceRange(
    rangeSource,
    recordDescriptorsOffset,
    recordBlockCount * 16
  );
  const recordBlocksOffset = recordDescriptorsOffset + recordBlockCount * 16;
  const recordBlocks = parseRecordBlockDescriptors(
    recordDescriptorBytes,
    recordBlockCount,
    recordBlocksOffset,
    limits
  );
  const compressedRecordBytes = recordBlocks.reduce(
    (sum, descriptor) => safeAdd(sum, descriptor.compressedBytes, "record block bytes"),
    0
  );
  const totalRecordBytes = recordBlocks.reduce(
    (sum, descriptor) => safeAdd(sum, descriptor.decompressedBytes, "record bytes"),
    0
  );
  requireMdictAtMost(totalRecordBytes, limits.totalRecordBytes, "MDict total record bytes");
  diagnostic.stage = "key-blocks";
  await addKeyBlockLookupBounds({
    source: rangeSource,
    keyBlocks,
    header,
    totalRecordBytes,
    limits,
    decompressionStreamFactory,
    signal
  });
  diagnostic.stage = "index-validation";
  if (
    compressedRecordBytes !== recordBlocksBytes ||
    recordBlocksOffset + recordBlocksBytes !== sourceSize
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict record block layout does not match the source size."
    );
  }

  const index = {
    schemaVersion: RICH_MDICT_INDEX_SCHEMA_VERSION,
    format: RICH_MDICT_INDEX_FORMAT,
    sourceSize,
    header: serializableHeader(header),
    entryCount,
    totalRecordBytes,
    keyInfoCompression: decodedKeyInfo.compression,
    keyInfoEncrypted: header.encrypted === 2,
    keyPreambleOffset,
    keyInfoOffset,
    keyInfoCompressedBytes,
    keyBlocksOffset,
    keyBlocksBytes,
    recordSectionOffset,
    recordBlocksOffset,
    recordBlocksBytes,
    keyBlocks,
    recordBlocks
  };
  const serializedBytes = new TextEncoder().encode(JSON.stringify(index)).byteLength;
  requireMdictAtMost(
    serializedBytes,
    limits.keyIndexBytes,
    "Rich MDict compact index bytes"
  );
  validateRichMdictIndex(index, { sourceSize, limits });
  return index;
}

export function assertRichMdictIndex(index, source) {
  validateRichMdictIndex(index, { sourceSize: source?.size });
  validateMdictSource(source, RICH_MDICT_IMPORT_LIMITS);
  return index;
}

export async function decodeRichKeyBlock({
  source,
  index,
  blockIndex,
  limits = RICH_MDICT_IMPORT_LIMITS,
  decompressionStreamFactory,
  budget,
  signal
}) {
  throwIfAborted(signal);
  const descriptor = index.keyBlocks[blockIndex];
  if (!descriptor) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "Rich MDict key block index is missing.");
  }
  budget?.consumeKeyBlock(descriptor);
  throwIfAborted(signal);
  const compressed = await readSourceRange(source, descriptor.dataOffset, descriptor.compressedBytes, signal);
  throwIfAborted(signal);
  const decoded = await decodeMdictBlock({
    input: compressed,
    expectedBytes: descriptor.decompressedBytes,
    limits,
    label: "MDict key block",
    decompressionStreamFactory,
    signal
  });
  throwIfAborted(signal);
  const entries = parseKeyBlock(decoded.bytes, descriptor, index.header, { signal });
  throwIfAborted(signal);
  if (
    Number.isSafeInteger(index.totalRecordBytes) &&
    entries.some((entry) => entry.recordOffset >= index.totalRecordBytes)
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key record offset is outside record stream.");
  }
  return entries;
}

async function decodeMdictKeyInfo({
  input,
  encrypted,
  expectedBytes,
  limits,
  decompressionStreamFactory,
  signal
}) {
  throwIfAborted(signal);
  const bytes = encrypted === 2
    ? decryptMdictKeyInfoBlock(input)
    : input;
  const decoded = await decodeMdictBlock({
    input: bytes,
    expectedBytes,
    limits,
    label: "MDict key index",
    decompressionStreamFactory,
    signal
  });
  if (decoded.compression !== "zlib") {
    mdictFail(MDICT_IMPORT_ERROR.UNSUPPORTED, "MDict v2 key block info must use zlib compression.");
  }
  return decoded;
}

function serializableHeader(header) {
  const styleSheetRules = header.styleSheetRules.slice(0, STYLE_SHEET_RULES_MAX);
  return {
    title: header.title,
    generatedByEngineVersion: header.generatedByEngineVersion,
    requiredEngineVersion: header.requiredEngineVersion,
    encoding: header.encoding.name,
    format: header.format,
    encrypted: header.encrypted,
    keyCaseSensitive: header.keyCaseSensitive,
    stripKey: header.stripKey,
    compact: header.compact,
    compat: header.compat,
    styleSheet: header.styleSheet,
    styleSheetRules
  };
}

async function addKeyBlockLookupBounds({
  source,
  keyBlocks,
  header,
  totalRecordBytes,
  limits,
  decompressionStreamFactory,
  signal
}) {
  let previousRecordOffset = -1;
  for (let blockIndex = 0; blockIndex < keyBlocks.length; blockIndex += 1) {
    throwIfAborted(signal);
    const descriptor = keyBlocks[blockIndex];
    const entries = await decodeRichKeyBlock({
      source,
      index: {
        keyBlocks,
      header,
        keyBlocksOffset: keyBlocks[0]?.dataOffset,
        recordSectionOffset: keyBlocks.at(-1)?.dataOffset + keyBlocks.at(-1)?.compressedBytes,
        totalRecordBytes
      },
      blockIndex,
      limits,
      decompressionStreamFactory,
      signal
    });
    if (!entries.length) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key block is empty.");
    }
    if (
      entries.some((entry) => entry.recordOffset >= totalRecordBytes) ||
      entries[0].recordOffset < previousRecordOffset
    ) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict key record offset is outside record stream.");
    }
    let minimum = normalizeRichMdictLookupKey(entries[0].displayForm, header);
    let maximum = minimum;
    for (const entry of entries) {
      const key = normalizeRichMdictLookupKey(entry.displayForm, header);
      if (key < minimum) minimum = key;
      if (key > maximum) maximum = key;
    }
    descriptor.lookupMinKey = minimum;
    descriptor.lookupMaxKey = maximum;
    descriptor.firstRecordOffset = entries[0].recordOffset;
    descriptor.lastRecordOffset = entries.at(-1).recordOffset;
    previousRecordOffset = descriptor.lastRecordOffset;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("MDict lookup cancelled.", "AbortError");
}

export function lookupSortKey(value, header) {
  return normalizeRichMdictLookupKey(value, header);
}
