import {
  assertDeclaredCuratedDictionary,
  CURATED_IMPORTER_TYPES
} from "../../../shared/curated-dictionaries.js";
import {
  parseSingleRootMdxZipLayout,
  zipCrc32 as crc32,
  zipToBytes as toBytes
} from "./ecdict-mdx-zip-layout.js";

const READ_CHUNK_BYTES = 64 * 1024;
const ALLOWED_RESPONSE_ORIGINS = new Set([
  "https://github.com",
  "https://release-assets.githubusercontent.com"
]);

/**
 * Bounded downloader and extractor for the extension-declared ECDICT 1.0.28
 * MDX ZIP recipe. The ZIP reader intentionally supports one root-level .mdx
 * file only; it is not a general-purpose archive API.
 */
export async function extractPinnedEcdictMdx(response, {
  source,
  signal,
  cryptoProvider = globalThis.crypto,
  decompressionStreamFactory = (format) => new DecompressionStream(format),
  onProgress = () => {}
} = {}) {
  const declared = assertDeclaredCuratedDictionary(source);
  if (
    declared.importerType !== CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1
  ) {
    throw new Error("ECDICT MDX ZIP extractor received another recipe type.");
  }
  validateResponse(response, declared);
  assertActive(signal);
  if (typeof onProgress !== "function") {
    throw new Error("ECDICT MDX progress callback must be a function.");
  }

  let archiveBytes = await readBoundedResponse(response, declared, {
    signal,
    onProgress
  });
  const archiveDigest = await sha256Hex(
    archiveBytes,
    cryptoProvider,
    "ECDICT ZIP"
  );
  if (archiveDigest !== declared.downloadSha256) {
    throw zipError("ECDICT_ARCHIVE_HASH", "ECDICT ZIP SHA-256 does not match the reviewed archive.");
  }
  assertActive(signal);

  let mdxBytes = await extractSingleRootMdxZip(archiveBytes, {
    expectedNameBytesHex: declared.archive.entryNameBytesHex,
    expectedBytes: declared.archive.entryBytes,
    maxArchiveBytes: declared.archive.maxArchiveBytes,
    maxExpandedBytes: declared.archive.maxExpandedBytes,
    maxFileBytes: declared.archive.maxFileBytes,
    maxCompressionRatio: declared.archive.maxCompressionRatio,
    signal,
    decompressionStreamFactory,
    onProgress
  });
  archiveBytes = null;
  const mdxDigest = await sha256Hex(mdxBytes, cryptoProvider, "ECDICT MDX");
  if (
    mdxBytes.byteLength !== declared.mdx.bytes ||
    mdxDigest !== declared.mdx.sha256
  ) {
    throw zipError("ECDICT_MDX_HASH", "Extracted ECDICT MDX does not match the reviewed corpus.");
  }
  assertActive(signal);

  const type = "application/octet-stream";
  let file;
  if (typeof File === "function") {
    file = new File([mdxBytes], declared.mdx.fileName, {
      type,
      lastModified: 0
    });
  } else {
    file = new Blob([mdxBytes], { type });
    Object.defineProperty(file, "name", {
      configurable: false,
      enumerable: true,
      value: declared.mdx.fileName
    });
  }
  // The returned File owns its own immutable byte sequence. Clear the much
  // larger temporary typed array before resolving the worker message.
  mdxBytes = null;
  return file;
}

/**
 * Extract exactly one named root MDX member from a ZIP byte array. This lower
 * level is exported so security tests can exercise hostile layouts without
 * changing the extension-owned immutable recipe.
 */
export async function extractSingleRootMdxZip(input, {
  expectedNameBytesHex,
  expectedBytes,
  maxArchiveBytes,
  maxExpandedBytes,
  maxFileBytes,
  maxCompressionRatio,
  signal,
  decompressionStreamFactory = (format) => new DecompressionStream(format),
  onProgress = () => {}
} = {}) {
  const bytes = toBytes(input);
  requireAtMost(bytes.byteLength, maxArchiveBytes, "ZIP archive bytes");
  const expectedNameBytes = String(expectedNameBytesHex || "");
  requirePositiveInteger(expectedBytes, "expected MDX bytes");
  requirePositiveInteger(maxExpandedBytes, "expanded ZIP byte limit");
  requirePositiveInteger(maxFileBytes, "ZIP member byte limit");
  if (!Number.isFinite(maxCompressionRatio) || maxCompressionRatio < 1) {
    throw zipError("ECDICT_ZIP_LIMIT", "ZIP compression ratio limit is invalid.");
  }
  if (typeof onProgress !== "function") {
    throw new Error("ECDICT MDX progress callback must be a function.");
  }
  assertActive(signal);

  const layout = parseSingleRootMdxZipLayout(bytes, {
    expectedNameBytesHex: expectedNameBytes,
    expectedBytes,
    maxExpandedBytes,
    maxFileBytes,
    maxCompressionRatio
  });
  const compressed = bytes.subarray(
    layout.dataOffset,
    layout.dataOffset + layout.compressedBytes
  );
  let mdxBytes;
  if (layout.method === 0) {
    mdxBytes = compressed.slice();
  } else {
    mdxBytes = await inflateRawBounded(compressed, layout.uncompressedBytes, {
      maxFileBytes,
      maxExpandedBytes,
      signal,
      decompressionStreamFactory,
      onProgress
    });
  }
  assertActive(signal);
  if (mdxBytes.byteLength !== expectedBytes) {
    throw zipError("ECDICT_ZIP_SIZE", "Extracted MDX size does not match the locked recipe.");
  }
  if (crc32(mdxBytes) !== layout.crc32) {
    throw zipError("ECDICT_ZIP_CRC", "ECDICT ZIP member CRC-32 check failed.");
  }
  if (looksLikeNestedArchive(mdxBytes)) {
    throw zipError("ECDICT_ZIP_NESTED", "Nested archives are not supported in ECDICT ZIP.");
  }
  onProgress({
    phase: "extract",
    outputBytes: mdxBytes.byteLength,
    expectedOutputBytes: expectedBytes
  });
  return mdxBytes;
}

function validateResponse(response, source) {
  if (!response?.ok) {
    throw zipError(
      "ECDICT_DOWNLOAD",
      `ECDICT download failed with HTTP ${response?.status || "error"}.`
    );
  }
  if (typeof response.url !== "string" || !response.url) {
    throw zipError("ECDICT_DOWNLOAD_URL", "ECDICT download returned no final URL.");
  }
  let origin;
  try {
    origin = new URL(response.url).origin;
  } catch {
    throw zipError("ECDICT_DOWNLOAD_URL", "ECDICT download returned an invalid URL.");
  }
  if (!ALLOWED_RESPONSE_ORIGINS.has(origin)) {
    throw zipError("ECDICT_DOWNLOAD_REDIRECT", "ECDICT download left the reviewed GitHub asset origins.");
  }
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined && contentLength !== "") {
    if (!/^\d+$/u.test(contentLength) || Number(contentLength) !== source.downloadBytes) {
      throw zipError("ECDICT_DOWNLOAD_SIZE", "ECDICT download Content-Length does not match the locked asset.");
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw zipError("ECDICT_DOWNLOAD_STREAM", "ECDICT download must provide a bounded readable stream.");
  }
}

async function readBoundedResponse(response, source, { signal, onProgress }) {
  const maximum = source.archive.maxArchiveBytes;
  const expected = source.downloadBytes;
  requireAtMost(expected, maximum, "ECDICT ZIP download bytes");
  const output = new Uint8Array(expected);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      assertActive(signal);
      const { value, done } = await reader.read();
      assertActive(signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw zipError("ECDICT_DOWNLOAD_STREAM", "ECDICT response yielded a non-byte chunk.");
      }
      if (value.byteLength > maximum - offset) {
        throw zipError("ECDICT_DOWNLOAD_LIMIT", "ECDICT download exceeds its ZIP byte limit.");
      }
      if (value.byteLength > expected - offset) {
        throw zipError("ECDICT_DOWNLOAD_SIZE", "ECDICT download exceeds the locked asset size.");
      }
      output.set(value, offset);
      offset += value.byteLength;
      onProgress({
        phase: "download",
        inputBytes: offset,
        expectedBytes: expected
      });
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock?.();
  }
  if (offset !== expected) {
    throw zipError("ECDICT_DOWNLOAD_SIZE", `ECDICT download size mismatch: expected ${expected}, got ${offset}.`);
  }
  return output;
}

async function inflateRawBounded(compressed, expectedBytes, {
  maxFileBytes,
  maxExpandedBytes,
  signal,
  decompressionStreamFactory,
  onProgress
}) {
  requireAtMost(expectedBytes, maxFileBytes, "ECDICT MDX bytes");
  requireAtMost(expectedBytes, maxExpandedBytes, "ECDICT expanded ZIP bytes");
  if (typeof decompressionStreamFactory !== "function") {
    throw zipError("ECDICT_ZIP_DEFLATE", "ECDICT ZIP deflate decoder is unavailable.");
  }
  let decoder;
  try {
    decoder = decompressionStreamFactory("deflate-raw");
  } catch (cause) {
    throw zipError("ECDICT_ZIP_DEFLATE", "ECDICT ZIP raw deflate is unsupported.", { cause });
  }
  if (!decoder?.writable || !decoder?.readable) {
    throw zipError("ECDICT_ZIP_DEFLATE", "ECDICT ZIP raw deflate decoder is invalid.");
  }

  const input = new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < compressed.byteLength; offset += READ_CHUNK_BYTES) {
        controller.enqueue(compressed.subarray(
          offset,
          Math.min(compressed.byteLength, offset + READ_CHUNK_BYTES)
        ));
      }
      controller.close();
    }
  });
  const reader = input.pipeThrough(decoder).getReader();
  const output = new Uint8Array(expectedBytes);
  let outputBytes = 0;
  let lastReportedBytes = 0;
  try {
    while (true) {
      assertActive(signal);
      const { value, done } = await reader.read();
      assertActive(signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw zipError("ECDICT_ZIP_DEFLATE", "ECDICT ZIP decoder yielded a non-byte chunk.");
      }
      if (value.byteLength > maxFileBytes - outputBytes ||
          value.byteLength > maxExpandedBytes - outputBytes ||
          value.byteLength > expectedBytes - outputBytes) {
        throw zipError("ECDICT_ZIP_LIMIT", "ECDICT ZIP expansion exceeded its configured output limit.");
      }
      output.set(value, outputBytes);
      outputBytes += value.byteLength;
      if (
        outputBytes - lastReportedBytes >= 1024 * 1024 ||
        outputBytes === expectedBytes
      ) {
        lastReportedBytes = outputBytes;
        onProgress({
          phase: "extract",
          outputBytes,
          expectedOutputBytes: expectedBytes
        });
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock?.();
  }
  if (outputBytes !== expectedBytes) {
    throw zipError("ECDICT_ZIP_SIZE", "ECDICT ZIP deflate output size does not match its central directory.");
  }
  return output;
}

async function sha256Hex(bytes, cryptoProvider, label) {
  if (typeof cryptoProvider?.subtle?.digest !== "function") {
    throw zipError("ECDICT_CRYPTO", "WebCrypto is required to verify the reviewed " + label + " SHA-256.");
  }
  const digest = new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function looksLikeNestedArchive(bytes) {
  const signatures = [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
    [0x1f, 0x8b],
    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]
  ];
  return signatures.some((signature) =>
    signature.every((value, index) => bytes[index] === value)
  );
}

function requireAtMost(actual, maximum, label) {
  if (
    !Number.isSafeInteger(actual) || actual < 0 ||
    !Number.isSafeInteger(maximum) || maximum <= 0 || actual > maximum
  ) {
    throw zipError("ECDICT_ZIP_LIMIT", label + " exceeds its safety limit.");
  }
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw zipError("ECDICT_ZIP_LIMIT", label + " is invalid.");
  }
}

function assertActive(signal) {
  if (signal?.aborted) {
    throw new DOMException("ECDICT MDX download or extraction cancelled.", "AbortError");
  }
}

function zipError(code, message, extra = {}) {
  const error = new Error(message, extra.cause ? { cause: extra.cause } : undefined);
  error.code = code;
  return error;
}
