import {
  MDICT_IMPORT_ERROR,
  adler32,
  mdictBytes,
  mdictFail,
  readMdictUint32Be,
  requireMdictAtMost
} from "./mdict-contract.js";

export async function decodeMdictBlock({
  input,
  expectedBytes,
  limits,
  label,
  decompressionStreamFactory =
    defaultDecompressionStream
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
      {
        expected: expectedBytes,
        actual: bytes.byteLength
      }
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

export function concatMdictBytes(chunks, totalBytes) {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
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
      label + " requires zlib decompression support.",
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
  return concatMdictBytes(chunks, total);
}

function defaultDecompressionStream() {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream is unavailable.");
  }
  return new DecompressionStream("deflate");
}
