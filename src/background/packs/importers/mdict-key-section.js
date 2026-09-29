import {
  MDICT_IMPORT_ERROR,
  MDictCursor,
  adler32,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import {
  decodeMdictText,
  validateMdictHeadword
} from "./mdict-metadata.js";
import {
  decodeMdictBlock
} from "./mdict-block-codec.js";

export async function readMdictKeySection({
  cursor,
  header,
  limits,
  decompressionStreamFactory
}) {
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

  const keyIndexDecoded = await decodeMdictBlock({
    input: cursor.read(
      keyIndexCompressedBytes,
      "MDict key index"
    ),
    expectedBytes: keyIndexDecompressedBytes,
    limits,
    label: "MDict key index",
    ...(decompressionStreamFactory
      ? { decompressionStreamFactory }
      : {})
  });
  if (keyIndexDecoded.compression !== "zlib") {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "MDict v2 key block info must use zlib compression."
    );
  }

  const descriptors = parseKeyBlockIndex(
    keyIndexDecoded.bytes,
    numKeyBlocks,
    numEntries,
    header.encoding,
    limits
  );
  if (
    descriptors.reduce(
      (sum, item) => sum + item.compressedBytes,
      0
    ) !== keyBlocksBytes
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict key block size total does not match keyword preamble."
    );
  }

  const keys = [];
  const compression = new Set([
    keyIndexDecoded.compression
  ]);
  let previousRecordOffset = -1;
  for (const descriptor of descriptors) {
    const decoded = await decodeMdictBlock({
      input: cursor.read(
        descriptor.compressedBytes,
        "MDict key block"
      ),
      expectedBytes: descriptor.decompressedBytes,
      limits,
      label: "MDict key block",
      ...(decompressionStreamFactory
        ? { decompressionStreamFactory }
        : {})
    });
    compression.add(decoded.compression);
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

  return {
    numEntries,
    numKeyBlocks,
    keys,
    compression: [...compression].sort()
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
  const step = encoding.unitBytes;
  const max = Math.min(
    cursor.bytes.byteLength - (step - 1),
    start + maximumBytes + step
  );
  let end = -1;
  for (let index = start; index < max; index += step) {
    if (
      cursor.bytes[index] === 0 &&
      (
        step === 1 ||
        cursor.bytes[index + 1] === 0
      )
    ) {
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
