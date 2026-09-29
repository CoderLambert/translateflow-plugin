import {
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../../../shared/lexical.js";
import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS,
  MDictCursor,
  adler32,
  decodeMdictText,
  mdictBytes,
  mdictFail,
  parseMdictHeader,
  readMdictUint32Be,
  requireMdictAtMost,
  requireMdictSafeSourceId,
  requireMdictText,
  sanitizeMdictRecord,
  validateMdictHeadword
} from "./mdict-contract.js";

export {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS
} from "./mdict-contract.js";

export async function projectMdictV2PlainText({
  mdxBytes,
  sourceId = "user-mdict",
  sourceVersion = "local-import",
  limits = MDICT_IMPORT_LIMITS,
  decompressionStreamFactory = defaultDecompressionStream
} = {}) {
  requireMdictSafeSourceId(sourceId);
  requireMdictText(sourceVersion, "sourceVersion");
  const file = mdictBytes(mdxBytes, "MDX");
  requireMdictAtMost(
    file.byteLength,
    limits.fileBytes,
    "MDX bytes"
  );
  const cursor = new MDictCursor(file);
  const header = parseMdictHeader(cursor, limits);

  const preambleBytes =
    cursor.read(40, "MDict keyword section preamble");
  const preambleChecksum =
    cursor.readUint32Be("MDict keyword preamble checksum");
  if (adler32(preambleBytes) !== preambleChecksum) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict keyword section preamble checksum mismatch."
    );
  }

  const preamble = new MDictCursor(preambleBytes);
  const numKeyBlocks =
    preamble.readSafeUint64Be("MDict key block count");
  const numEntries =
    preamble.readSafeUint64Be("MDict entry count");
  const keyIndexDecompressedBytes =
    preamble.readSafeUint64Be(
      "MDict key index decompressed bytes"
    );
  const keyIndexCompressedBytes =
    preamble.readSafeUint64Be(
      "MDict key index compressed bytes"
    );
  const keyBlocksBytes =
    preamble.readSafeUint64Be("MDict key blocks bytes");
  requireMdictAtMost(
    numKeyBlocks,
    limits.blockCount,
    "MDict key block count"
  );
  requireMdictAtMost(
    numEntries,
    limits.entryCount,
    "MDict entry count"
  );
  requireMdictAtMost(
    keyIndexDecompressedBytes,
    limits.keyIndexBytes,
    "MDict key index decompressed bytes"
  );
  requireMdictAtMost(
    keyIndexCompressedBytes,
    limits.blockCompressedBytes,
    "MDict key index compressed bytes"
  );
  requireMdictAtMost(
    keyBlocksBytes,
    limits.fileBytes,
    "MDict key blocks bytes"
  );
  if (!numKeyBlocks || !numEntries || preamble.remaining !== 0) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict keyword section preamble is invalid."
    );
  }

  const keyIndexCompressed =
    cursor.read(keyIndexCompressedBytes, "MDict key index");
  const keyIndexDecoded = await decodeMdictBlock({
    input: keyIndexCompressed,
    expectedBytes: keyIndexDecompressedBytes,
    limits,
    label: "MDict key index",
    decompressionStreamFactory
  });
  if (keyIndexDecoded.compression !== "zlib") {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "MDict v2 key block info must use zlib compression."
    );
  }

  const keyDescriptors = parseKeyBlockIndex(
    keyIndexDecoded.bytes,
    numKeyBlocks,
    numEntries,
    header.encoding,
    limits
  );
  if (
    keyDescriptors.reduce(
      (sum, item) => sum + item.compressedBytes,
      0
    ) !== keyBlocksBytes
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict key block size total does not match the keyword preamble."
    );
  }

  const keys = [];
  const keyCompression = new Set([
    keyIndexDecoded.compression
  ]);
  let previousRecordOffset = -1;
  for (const descriptor of keyDescriptors) {
    const decoded = await decodeMdictBlock({
      input: cursor.read(
        descriptor.compressedBytes,
        "MDict key block"
      ),
      expectedBytes: descriptor.decompressedBytes,
      limits,
      label: "MDict key block",
      decompressionStreamFactory
    });
    keyCompression.add(decoded.compression);
    const blockKeys = splitKeyBlock(
      decoded.bytes,
      descriptor.entryCount,
      header.encoding,
      limits
    );
    if (
      !blockKeys.length ||
      blockKeys[0].displayForm !== descriptor.firstKey ||
      blockKeys.at(-1).displayForm !== descriptor.lastKey
    ) {
      mdictFail(
        MDICT_IMPORT_ERROR.CORRUPT,
        "MDict key block boundary does not match its index."
      );
    }
    for (const item of blockKeys) {
      if (item.recordOffset < previousRecordOffset) {
        mdictFail(
          MDICT_IMPORT_ERROR.CORRUPT,
          "MDict record offsets are not monotonic."
        );
      }
      previousRecordOffset = item.recordOffset;
      keys.push(item);
    }
  }
  if (keys.length !== numEntries) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict parsed key count does not match declared entries.",
      { expected: numEntries, actual: keys.length }
    );
  }

  const numRecordBlocks =
    cursor.readSafeUint64Be("MDict record block count");
  const recordEntryCount =
    cursor.readSafeUint64Be("MDict record entry count");
  const recordIndexBytes =
    cursor.readSafeUint64Be("MDict record index bytes");
  const recordBlocksBytes =
    cursor.readSafeUint64Be("MDict record blocks bytes");
  requireMdictAtMost(
    numRecordBlocks,
    limits.blockCount,
    "MDict record block count"
  );
  requireMdictAtMost(
    recordBlocksBytes,
    limits.fileBytes,
    "MDict record blocks bytes"
  );
  if (
    !numRecordBlocks ||
    recordEntryCount !== numEntries ||
    recordIndexBytes !== numRecordBlocks * 16
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict record section header is inconsistent."
    );
  }

  const recordDescriptors = [];
  let compressedTotal = 0;
  let decompressedTotal = 0;
  for (let index = 0; index < numRecordBlocks; index += 1) {
    const compressedBytes =
      cursor.readSafeUint64Be(
        "MDict record block compressed bytes"
      );
    const decompressedBytes =
      cursor.readSafeUint64Be(
        "MDict record block decompressed bytes"
      );
    requireMdictAtMost(
      compressedBytes,
      limits.blockCompressedBytes,
      "MDict record block compressed bytes"
    );
    requireMdictAtMost(
      decompressedBytes,
      limits.blockDecompressedBytes,
      "MDict record block decompressed bytes"
    );
    if (compressedBytes < 8 || !decompressedBytes) {
      mdictFail(
        MDICT_IMPORT_ERROR.CORRUPT,
        "MDict record block sizes are invalid."
      );
    }
    compressedTotal += compressedBytes;
    decompressedTotal += decompressedBytes;
    requireMdictAtMost(
      decompressedTotal,
      limits.totalRecordBytes,
      "MDict total record bytes"
    );
    recordDescriptors.push({
      compressedBytes,
      decompressedBytes
    });
  }
  if (compressedTotal !== recordBlocksBytes) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict record block size total does not match the record header."
    );
  }

  const recordChunks = [];
  const recordCompression = new Set();
  let actualRecordBytes = 0;
  for (const descriptor of recordDescriptors) {
    const decoded = await decodeMdictBlock({
      input: cursor.read(
        descriptor.compressedBytes,
        "MDict record block"
      ),
      expectedBytes: descriptor.decompressedBytes,
      limits,
      label: "MDict record block",
      decompressionStreamFactory
    });
    recordCompression.add(decoded.compression);
    actualRecordBytes += decoded.bytes.byteLength;
    requireMdictAtMost(
      actualRecordBytes,
      limits.totalRecordBytes,
      "MDict total record bytes"
    );
    recordChunks.push(decoded.bytes);
  }
  if (cursor.remaining !== 0) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict file contains unexpected trailing bytes."
    );
  }
  const recordBytes =
    concatBytes(recordChunks, actualRecordBytes);

  const entries = keys.map((item, index) => {
    const start = item.recordOffset;
    const end = index + 1 < keys.length
      ? keys[index + 1].recordOffset
      : recordBytes.byteLength;
    if (
      start < 0 ||
      start > end ||
      end > recordBytes.byteLength
    ) {
      mdictFail(
        MDICT_IMPORT_ERROR.CORRUPT,
        "MDict key points outside the record stream.",
        {
          headword: item.displayForm,
          start,
          end,
          recordBytes: recordBytes.byteLength
        }
      );
    }
    requireMdictAtMost(
      end - start,
      limits.entryBytes,
      "MDict record bytes"
    );
    const plainText = sanitizeMdictRecord(
      decodeMdictRecord(
        recordBytes.subarray(start, end),
        header.encoding
      ),
      item.displayForm,
      limits
    );
    return {
      lookupKey: normalizeLexicalKey(item.displayForm),
      exactLookupKey:
        normalizeLexicalExactKey(item.displayForm),
      displayForm: item.displayForm,
      plainText,
      sourceRef: {
        sourceId,
        recordId: "entry:" + (index + 1)
      }
    };
  });

  return {
    dictionary: {
      title: header.title,
      generatedByEngineVersion:
        header.generatedByEngineVersion,
      requiredEngineVersion:
        header.requiredEngineVersion,
      encoding: header.encoding.name,
      format: header.format,
      entryCount: numEntries
    },
    entries,
    blocks: {
      keyBlocks: numKeyBlocks,
      recordBlocks: numRecordBlocks,
      keyCompression: [...keyCompression].sort(),
      recordCompression: [...recordCompression].sort(),
      decompressedRecordBytes: recordBytes.byteLength
    },
    policy: {
      semanticStatus: "unclassified-plain-text",
      runtimeStatus: "local-import-candidate",
      contentMode: "text-only",
      htmlRendering: "rejected",
      compactStyles: "rejected",
      mddResources: "not-loaded",
      networkResources: "never-rendered",
      tflexMapping: "explicit-recipe-only"
    },
    unsupportedFeatures: [
      "MDX 1.x and 3.x",
      "encrypted MDX",
      "LZO-compressed blocks",
      "GBK/Big5 text encodings",
      "Compact/StyleSheet presentation transforms",
      "HTML/renderable record markup",
      "MDX @@@LINK redirects",
      ".mdd resources"
    ]
  };
}

function parseKeyBlockIndex(
  input,
  blockCount,
  entryCount,
  encoding,
  limits
) {
  const cursor = new MDictCursor(input);
  const descriptors = [];
  let countedEntries = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const blockEntries =
      cursor.readSafeUint64Be(
        "MDict key index entry count"
      );
    requireMdictAtMost(
      blockEntries,
      limits.entryCount,
      "MDict key index entry count"
    );
    if (!blockEntries) {
      mdictFail(
        MDICT_IMPORT_ERROR.CORRUPT,
        "MDict key block declares zero entries."
      );
    }
    const firstKey = readSizedKey(
      cursor,
      encoding,
      limits,
      "MDict first key"
    );
    const lastKey = readSizedKey(
      cursor,
      encoding,
      limits,
      "MDict last key"
    );
    const compressedBytes =
      cursor.readSafeUint64Be(
        "MDict key block compressed bytes"
      );
    const decompressedBytes =
      cursor.readSafeUint64Be(
        "MDict key block decompressed bytes"
      );
    requireMdictAtMost(
      compressedBytes,
      limits.blockCompressedBytes,
      "MDict key block compressed bytes"
    );
    requireMdictAtMost(
      decompressedBytes,
      limits.blockDecompressedBytes,
      "MDict key block decompressed bytes"
    );
    if (compressedBytes < 8 || !decompressedBytes) {
      mdictFail(
        MDICT_IMPORT_ERROR.CORRUPT,
        "MDict key block sizes are invalid."
      );
    }
    countedEntries += blockEntries;
    requireMdictAtMost(
      countedEntries,
      limits.entryCount,
      "MDict key index total entries"
    );
    descriptors.push({
      entryCount: blockEntries,
      firstKey,
      lastKey,
      compressedBytes,
      decompressedBytes
    });
  }
  if (
    cursor.remaining !== 0 ||
    countedEntries !== entryCount
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict key index size/count is inconsistent."
    );
  }
  return descriptors;
}

function splitKeyBlock(
  input,
  entryCount,
  encoding,
  limits
) {
  const cursor = new MDictCursor(input);
  const result = [];
  for (let index = 0; index < entryCount; index += 1) {
    const recordOffset =
      cursor.readSafeUint64Be("MDict record offset");
    const displayForm = readNullTerminatedText(
      cursor,
      encoding,
      limits.headwordBytes,
      "MDict headword"
    );
    validateMdictHeadword(displayForm);
    result.push({ recordOffset, displayForm });
  }
  if (cursor.remaining !== 0) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict key block has trailing bytes."
    );
  }
  return result;
}

async function decodeMdictBlock({
  input,
  expectedBytes,
  limits,
  label,
  decompressionStreamFactory
}) {
  const block = mdictBytes(input, label);
  requireMdictAtMost(
    block.byteLength,
    limits.blockCompressedBytes,
    label + " compressed bytes"
  );
  requireMdictAtMost(
    expectedBytes,
    limits.blockDecompressedBytes,
    label + " decompressed bytes"
  );
  if (block.byteLength < 8) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " is truncated."
    );
  }

  const type = block.subarray(0, 4);
  const expectedChecksum = readMdictUint32Be(block, 4);
  const payload = block.subarray(8);
  let bytes;
  let compression;
  if (type.every((value) => value === 0)) {
    bytes = payload;
    compression = "none";
  } else if (
    type[0] === 1 &&
    type[1] === 0 &&
    type[2] === 0 &&
    type[3] === 0
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "LZO-compressed MDict blocks are not supported.",
      { label }
    );
  } else if (
    type[0] === 2 &&
    type[1] === 0 &&
    type[2] === 0 &&
    type[3] === 0
  ) {
    bytes = await inflateBounded(
      payload,
      Math.min(
        expectedBytes,
        limits.blockDecompressedBytes
      ),
      label,
      decompressionStreamFactory
    );
    compression = "zlib";
  } else {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "Unknown MDict block compression type.",
      { label, type: [...type] }
    );
  }

  if (bytes.byteLength !== expectedBytes) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " decompressed size mismatch.",
      { expected: expectedBytes, actual: bytes.byteLength }
    );
  }
  if (adler32(bytes) !== expectedChecksum) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " Adler32 checksum mismatch."
    );
  }
  return { bytes, compression };
}

async function inflateBounded(
  input,
  maximumBytes,
  label,
  decompressionStreamFactory
) {
  let stream;
  try {
    stream = new Blob([input])
      .stream()
      .pipeThrough(decompressionStreamFactory());
  } catch (cause) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      label + " requires browser zlib decompression support.",
      { cause }
    );
  }

  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = mdictBytes(
        value,
        label + " decompressed chunk"
      );
      total += chunk.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {});
        mdictFail(
          MDICT_IMPORT_ERROR.LIMIT,
          label + " decompressed bytes exceeds the safety limit.",
          { actual: total, maximum: maximumBytes }
        );
      }
      chunks.push(chunk);
    }
  } catch (cause) {
    if (cause?.code) throw cause;
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " zlib decompression failed.",
      { cause }
    );
  } finally {
    reader.releaseLock?.();
  }
  return concatBytes(chunks, total);
}

function readSizedKey(
  cursor,
  encoding,
  limits,
  label
) {
  const units = cursor.readUint16Be(label + " length");
  const byteLength = units * encoding.unitBytes;
  requireMdictAtMost(
    byteLength,
    limits.headwordBytes,
    label + " bytes"
  );
  const raw = cursor.read(byteLength, label);
  const terminator =
    cursor.read(encoding.unitBytes, label + " terminator");
  if (![...terminator].every((value) => value === 0)) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " is missing its null terminator."
    );
  }
  const text = decodeMdictText(raw, encoding, label);
  validateMdictHeadword(text);
  return text;
}

function readNullTerminatedText(
  cursor,
  encoding,
  maximumBytes,
  label
) {
  const start = cursor.offset;
  let end = -1;
  const step = encoding.unitBytes;
  const max = Math.min(
    cursor.bytes.byteLength - (step - 1),
    start + maximumBytes + step
  );
  for (let index = start; index < max; index += step) {
    const zero = cursor.bytes[index] === 0 &&
      (step === 1 || cursor.bytes[index + 1] === 0);
    if (zero) {
      end = index;
      break;
    }
  }
  if (end < 0) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " is unterminated or exceeds the byte limit."
    );
  }
  const raw = cursor.read(end - start, label);
  const terminator =
    cursor.read(step, label + " terminator");
  if (![...terminator].every((value) => value === 0)) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " terminator is malformed."
    );
  }
  return decodeMdictText(raw, encoding, label);
}

function decodeMdictRecord(input, encoding) {
  let bytes = mdictBytes(input, "MDict record");
  while (bytes.byteLength >= encoding.unitBytes) {
    const tail = bytes.subarray(
      bytes.byteLength - encoding.unitBytes
    );
    if (![...tail].every((value) => value === 0)) break;
    bytes = bytes.subarray(
      0,
      bytes.byteLength - encoding.unitBytes
    );
  }
  return decodeMdictText(bytes, encoding, "MDict record");
}

function concatBytes(chunks, totalBytes) {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function defaultDecompressionStream() {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream is unavailable.");
  }
  return new DecompressionStream("deflate");
}
