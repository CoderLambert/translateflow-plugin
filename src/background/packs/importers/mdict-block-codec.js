import {
  MDICT_IMPORT_ERROR,
  MDictImportError,
  adler32,
  mdictBytes,
  mdictFail,
  readMdictUint32Be,
  requireMdictAtMost
} from "./mdict-contract.js";
import { ripemd128 } from "./mdict-ripemd128.js";

const MDX_KEY_INFO_SALT = new Uint8Array([
  0x95, 0x36, 0x00, 0x00
]);

export async function decodeMdictBlock({
  input,
  expectedBytes,
  limits,
  label,
  decompressionStreamFactory =
    defaultDecompressionStream,
  signal
}) {
  throwIfAborted(signal);
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
      decompressionStreamFactory,
      signal
    );
    compression = "zlib";
  } else {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "Unknown MDict block compression type.",
      { label, type: [...type] }
    );
  }

  throwIfAborted(signal);
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

export function decryptMdictKeyInfoBlock(input) {
  const block = mdictBytes(input, "MDict key info block");
  if (
    block.byteLength < 8 ||
    block[0] !== 2 ||
    block[1] !== 0 ||
    block[2] !== 0 ||
    block[3] !== 0
  ) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "Encrypted MDX v2 key info must use zlib compression."
    );
  }

  const keyMaterial = new Uint8Array(8);
  keyMaterial.set(block.subarray(4, 8));
  keyMaterial.set(MDX_KEY_INFO_SALT, 4);
  const key = ripemd128(keyMaterial);
  const output = block.slice();
  let previous = 0x36;
  for (let index = 8; index < block.byteLength; index += 1) {
    const cipher = block[index];
    const swapped = ((cipher >>> 4) | (cipher << 4)) & 0xff;
    output[index] =
      swapped ^ previous ^ ((index - 8) & 0xff) ^ key[(index - 8) % key.length];
    previous = cipher;
  }
  return output;
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
  decompressionStreamFactory,
  signal
) {
  throwIfAborted(signal);
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
  const cancelReader = () => {
    void reader.cancel(abortError()).catch(() => {});
  };
  signal?.addEventListener("abort", cancelReader, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
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
    if (signal?.aborted || cause?.name === "AbortError") throw abortError();
    if (cause instanceof MDictImportError) throw cause;
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " zlib decompression failed.",
      { cause }
    );
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    reader.releaseLock?.();
  }
  throwIfAborted(signal);
  return concatMdictBytes(chunks, total);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function abortError() {
  return new DOMException("MDict lookup cancelled.", "AbortError");
}

function defaultDecompressionStream() {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream is unavailable.");
  }
  return new DecompressionStream("deflate");
}
