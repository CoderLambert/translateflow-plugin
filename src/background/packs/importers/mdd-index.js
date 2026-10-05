import {
  MDICT_IMPORT_ERROR,
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
import { parseMddHeader } from "./mdd-metadata.js";
import {
  addMddKeyBlockBounds,
  parseMddKeyBlock,
  parseMddKeyBlockDescriptors,
  mddResourceOrderMode
} from "./mdd-key-codec.js";
import { parseRecordBlockDescriptors, safeAdd } from "./mdict-rich-key-codec.js";
import {
  readSourceRange,
  validateMdictSource,
  withMdictAbortSignal
} from "./mdict-rich-source.js";
import {
  MDD_IMPORT_LIMITS,
  MDD_INDEX_FORMAT,
  MDD_INDEX_SCHEMA_VERSION,
  validateMddIndex
} from "./mdd-validation.js";

export { MDD_IMPORT_LIMITS, MDD_INDEX_FORMAT, MDD_INDEX_SCHEMA_VERSION, validateMddIndex };
export { readSourceRange };

export async function buildMddIndex({
  source,
  limits = MDD_IMPORT_LIMITS,
  decompressionStreamFactory,
  signal
} = {}) {
  const rangeSource = withMdictAbortSignal(source, signal);
  const sourceSize = validateMdictSource(rangeSource, limits);
  const prefix = await readSourceRange(rangeSource, 0, 4);
  const headerBytesLength = readMdictUint32Be(prefix, 0);
  requireMdictAtMost(headerBytesLength, limits.headerBytes, "MDD header bytes");
  const header = parseMddHeader(
    await readSourceRange(rangeSource, 0, headerBytesLength + 8),
    limits
  );
  const keyPreambleOffset = headerBytesLength + 8;
  const keyPreambleBytes = await readSourceRange(rangeSource, keyPreambleOffset, 44);
  const keyPreamble = keyPreambleBytes.subarray(0, 40);
  if (adler32(keyPreamble) !== readMdictUint32Be(keyPreambleBytes, 40)) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD keyword preamble checksum mismatch.");
  }
  const preamble = new MDictCursor(keyPreamble);
  const keyBlockCount = preamble.readSafeUint64Be("MDD key block count");
  const keyCount = preamble.readSafeUint64Be("MDD resource count");
  const keyInfoDecompressedBytes = preamble.readSafeUint64Be("MDD key index inflated bytes");
  const keyInfoCompressedBytes = preamble.readSafeUint64Be("MDD key index compressed bytes");
  const keyBlocksBytes = preamble.readSafeUint64Be("MDD key blocks bytes");
  requireMdictAtMost(keyBlockCount, limits.blockCount, "MDD key block count");
  requireMdictAtMost(keyCount, limits.entryCount, "MDD resource count");
  requireMdictAtMost(keyInfoDecompressedBytes, limits.keyIndexBytes, "MDD key index bytes");
  requireMdictAtMost(keyInfoCompressedBytes, limits.blockCompressedBytes, "MDD key index compressed bytes");
  requireMdictAtMost(keyInfoDecompressedBytes, keyInfoCompressedBytes * limits.compressionRatio, "MDD key index compression ratio");
  requireMdictAtMost(keyBlocksBytes, sourceSize, "MDD key blocks bytes");
  if (!keyBlockCount || !keyCount || preamble.remaining !== 0) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD keyword section preamble is invalid.");
  }

  const keyInfoOffset = keyPreambleOffset + 44;
  const rawKeyInfo = await readSourceRange(rangeSource, keyInfoOffset, keyInfoCompressedBytes);
  const keyInfoInput = header.encrypted === 2 ? decryptMdictKeyInfoBlock(rawKeyInfo) : rawKeyInfo;
  const decodedKeyInfo = await decodeMdictBlock({
    input: keyInfoInput,
    expectedBytes: keyInfoDecompressedBytes,
    limits,
    label: "MDD key index",
    decompressionStreamFactory
  });
  if (header.encrypted === 2 && decodedKeyInfo.compression !== "zlib") {
    mdictFail(MDICT_IMPORT_ERROR.UNSUPPORTED, "Encrypted MDD key indexes must use zlib.");
  }
  const keyBlocksOffset = keyInfoOffset + keyInfoCompressedBytes;
  const keyBlocks = parseMddKeyBlockDescriptors(
    decodedKeyInfo.bytes,
    keyBlockCount,
    keyCount,
    keyBlocksOffset,
    limits
  );
  const compressedKeyBytes = keyBlocks.reduce(
    (sum, block) => safeAdd(sum, block.compressedBytes, "MDD key block bytes"),
    0
  );
  if (compressedKeyBytes !== keyBlocksBytes) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key block total differs from its preamble.");
  }

  const recordSectionOffset = keyBlocksOffset + keyBlocksBytes;
  const recordHeader = new MDictCursor(await readSourceRange(rangeSource, recordSectionOffset, 32));
  const recordBlockCount = recordHeader.readSafeUint64Be("MDD record block count");
  const recordEntryCount = recordHeader.readSafeUint64Be("MDD record entry count");
  const recordIndexBytes = recordHeader.readSafeUint64Be("MDD record index bytes");
  const recordBlocksBytes = recordHeader.readSafeUint64Be("MDD record blocks bytes");
  requireMdictAtMost(recordBlockCount, limits.blockCount, "MDD record block count");
  requireMdictAtMost(recordBlocksBytes, sourceSize, "MDD record block bytes");
  if (!recordBlockCount || recordEntryCount !== keyCount || recordIndexBytes !== recordBlockCount * 16) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD record section header is inconsistent.");
  }
  const descriptorOffset = recordSectionOffset + 32;
  const recordDescriptors = await readSourceRange(rangeSource, descriptorOffset, recordBlockCount * 16);
  const recordBlocksOffset = descriptorOffset + recordBlockCount * 16;
  const recordBlocks = parseRecordBlockDescriptors(recordDescriptors, recordBlockCount, recordBlocksOffset, limits);
  let compressedRecords = 0;
  let totalRecordBytes = 0;
  for (const block of recordBlocks) {
    requireMdictAtMost(block.decompressedBytes, block.compressedBytes * limits.compressionRatio, "MDD record block compression ratio");
    compressedRecords = safeAdd(compressedRecords, block.compressedBytes, "MDD compressed record bytes");
    totalRecordBytes = safeAdd(totalRecordBytes, block.decompressedBytes, "MDD decompressed record bytes");
  }
  requireMdictAtMost(totalRecordBytes, limits.totalRecordBytes, "MDD total resource bytes");
  if (!totalRecordBytes || compressedRecords !== recordBlocksBytes || recordBlocksOffset + recordBlocksBytes !== sourceSize) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD record block layout does not match the source.");
  }

  const index = {
    schemaVersion: MDD_INDEX_SCHEMA_VERSION,
    format: MDD_INDEX_FORMAT,
    sourceSize,
    // The observed on-disk order is detected while bounded key blocks are read.
    keyOrder: "case-sensitive",
    header: serializableHeader(header),
    keyCount,
    totalKeyBlockBytes: 0,
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
  index.totalKeyBlockBytes = await addMddKeyBlockBounds(keyBlocks, {
    source: rangeSource,
    index,
    limits,
    decode: async ({ source: blockSource, blockIndex }) => {
      const descriptor = keyBlocks[blockIndex];
      const input = await readSourceRange(blockSource, descriptor.dataOffset, descriptor.compressedBytes);
      return decodeMdictBlock({
        input,
        expectedBytes: descriptor.decompressedBytes,
        limits,
        label: "MDD key block",
        decompressionStreamFactory
      });
    }
  });
  requireMdictAtMost(index.totalKeyBlockBytes, limits.totalKeyBlockBytes, "MDD total key block bytes");
  validateMddIndex(index, { sourceSize, limits });
  return index;
}

export async function decodeMddKeyBlock({
  source,
  index,
  blockIndex,
  limits = MDD_IMPORT_LIMITS,
  decompressionStreamFactory,
  budget,
  signal
}) {
  const descriptor = index?.keyBlocks?.[blockIndex];
  if (!descriptor) mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key block index is missing.");
  budget?.consumeKeyBlock(descriptor);
  const input = await readSourceRange(source, descriptor.dataOffset, descriptor.compressedBytes, signal);
  const decoded = await decodeMdictBlock({
    input,
    expectedBytes: descriptor.decompressedBytes,
    limits,
    label: "MDD key block",
    decompressionStreamFactory,
    signal
  });
  const parsed = parseMddKeyBlock(
    decoded.bytes,
    { ...descriptor, expectedFirstKey: descriptor.firstKey, expectedLastKey: descriptor.lastKey },
    index.totalRecordBytes,
    { orderMode: mddResourceOrderMode(index) }
  );
  if (
    parsed.firstRecordOffset !== descriptor.firstRecordOffset ||
    parsed.lastRecordOffset !== descriptor.lastRecordOffset
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD key block offsets differ from the compact index.");
  }
  return parsed.entries;
}

/** Decode every staged record block once before an attachment can replace a healthy resource set. */
export async function verifyMddRecordBlocks({
  source,
  index,
  limits = MDD_IMPORT_LIMITS,
  decompressionStreamFactory,
  signal
} = {}) {
  const rangeSource = withMdictAbortSignal(source, signal);
  const sourceSize = validateMdictSource(rangeSource, limits);
  validateMddIndex(index, { sourceSize, limits });
  let sourceBytesRead = 0;
  for (const descriptor of index.recordBlocks) {
    const input = await readSourceRange(rangeSource, descriptor.dataOffset, descriptor.compressedBytes);
    sourceBytesRead = safeAdd(sourceBytesRead, input.byteLength, "MDD verification bytes");
    await decodeMdictBlock({
      input,
      expectedBytes: descriptor.decompressedBytes,
      limits,
      label: "MDD staged record block",
      decompressionStreamFactory
    });
  }
  return { recordBlocksVerified: index.recordBlocks.length, sourceBytesRead };
}

function serializableHeader(header) {
  return {
    title: header.title,
    generatedByEngineVersion: header.generatedByEngineVersion,
    requiredEngineVersion: header.requiredEngineVersion,
    encrypted: header.encrypted,
    keyCaseSensitive: header.keyCaseSensitive
  };
}
