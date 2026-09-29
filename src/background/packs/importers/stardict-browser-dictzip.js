import {
  STARDICT_IMPORT_ERROR,
  STARDICT_IMPORT_LIMITS,
  StarDictImportError,
  readStarDictUint16Le,
  requireStarDictAtMost,
  starDictFail
} from "./stardict-contract.js";
import { parseStarDictDictzipHeader } from "./stardict-dictzip.js";

export async function decompressStarDictDictzip(
  blob,
  {
    limits = STARDICT_IMPORT_LIMITS,
    signal,
    decompressionStreamFactory = defaultDecompressionStreamFactory
  } = {}
) {
  validateBlobLike(blob);
  requireStarDictAtMost(
    blob.size,
    limits.dictArchiveBytes,
    "DICT.DZ bytes"
  );
  assertActive(signal);

  const header = await readDictzipHeader(blob);
  const dictzip = parseStarDictDictzipHeader(header);
  assertActive(signal);

  let stream;
  try {
    stream = decompressionStreamFactory();
  } catch (cause) {
    if (cause instanceof StarDictImportError) throw cause;
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSUPPORTED,
      "Browser gzip decompression is unavailable.",
      { cause }
    );
  }
  if (
    !stream ||
    !stream.readable ||
    !stream.writable
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSUPPORTED,
      "Browser gzip decompression stream is invalid."
    );
  }

  let reader;
  try {
    reader = blob
      .stream()
      .pipeThrough(stream)
      .getReader();
  } catch (cause) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz stream could not be opened.",
      { cause }
    );
  }

  const chunks = [];
  let total = 0;
  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => {});
  };
  if (signal) {
    signal.addEventListener("abort", onAbort, {
      once: true
    });
  }

  try {
    while (true) {
      assertActive(signal);
      const { value, done } = await reader.read();
      assertActive(signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        starDictFail(
          STARDICT_IMPORT_ERROR.CORRUPT,
          "Browser gzip decompressor emitted invalid bytes."
        );
      }

      total += value.byteLength;
      requireStarDictAtMost(
        total,
        limits.dictBytes,
        "DICT decompressed bytes"
      );
      chunks.push(new Uint8Array(value));
    }
  } catch (cause) {
    if (signal?.aborted || cause?.name === "AbortError") {
      throw abortError();
    }
    if (cause instanceof StarDictImportError) {
      await reader.cancel(cause).catch(() => {});
      throw cause;
    }
    await reader.cancel(cause).catch(() => {});
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz decompression failed.",
      { cause }
    );
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
    reader.releaseLock?.();
  }

  return {
    bytes: concatBytes(chunks, total),
    inputBytes: blob.size,
    dictzip
  };
}

async function readDictzipHeader(blob) {
  const fixed = new Uint8Array(
    await blob.slice(0, 12).arrayBuffer()
  );
  if (fixed.byteLength < 12) {
    return fixed;
  }

  const extraLength = readStarDictUint16Le(
    fixed,
    10
  );
  const headerBytes = 12 + extraLength;
  if (headerBytes > blob.size) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz declared extra header exceeds the file."
    );
  }
  return new Uint8Array(
    await blob.slice(0, headerBytes).arrayBuffer()
  );
}

function defaultDecompressionStreamFactory() {
  if (
    typeof globalThis.DecompressionStream !==
    "function"
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSUPPORTED,
      "Browser DecompressionStream is unavailable."
    );
  }
  return new globalThis.DecompressionStream("gzip");
}

function validateBlobLike(blob) {
  if (
    !blob ||
    !Number.isSafeInteger(blob.size) ||
    blob.size <= 0 ||
    typeof blob.slice !== "function" ||
    typeof blob.stream !== "function"
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz input must be a non-empty Blob/File."
    );
  }
}

function assertActive(signal) {
  if (!signal?.aborted) return;
  throw abortError();
}

function abortError() {
  return new DOMException(
    "StarDict dictionary import cancelled.",
    "AbortError"
  );
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
