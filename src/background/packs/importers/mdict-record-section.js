import {
  MDICT_IMPORT_ERROR,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import {
  concatMdictBytes,
  decodeMdictBlock
} from "./mdict-block-codec.js";

export async function readMdictRecordSection({
  cursor,
  numEntries,
  limits,
  decompressionStreamFactory
}) {
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

  const descriptors = [];
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
    descriptors.push({
      compressedBytes,
      decompressedBytes
    });
  }

  if (compressedTotal !== recordBlocksBytes) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict record block size total does not match record header."
    );
  }

  const chunks = [];
  const compression = new Set();
  let actualBytes = 0;
  for (const descriptor of descriptors) {
    const decoded = await decodeMdictBlock({
      input: cursor.read(
        descriptor.compressedBytes,
        "MDict record block"
      ),
      expectedBytes: descriptor.decompressedBytes,
      limits,
      label: "MDict record block",
      ...(decompressionStreamFactory
        ? { decompressionStreamFactory }
        : {})
    });
    compression.add(decoded.compression);
    actualBytes += decoded.bytes.byteLength;
    requireMdictAtMost(
      actualBytes,
      limits.totalRecordBytes,
      "MDict total record bytes"
    );
    chunks.push(decoded.bytes);
  }

  if (cursor.remaining !== 0) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict file contains unexpected trailing bytes."
    );
  }

  return {
    numRecordBlocks,
    recordBytes: concatMdictBytes(chunks, actualBytes),
    compression: [...compression].sort()
  };
}
