import {
  MDICT_IMPORT_ERROR,
  MDictImportError,
  mdictBytes,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";

export async function readSourceRange(source, offset, length) {
  if (
    !source ||
    typeof source.read !== "function" ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > source.size
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict source range is invalid.");
  }
  let bytes;
  try {
    bytes = mdictBytes(await source.read(offset, length), "MDict source range");
  } catch (cause) {
    if (cause instanceof MDictImportError) throw cause;
    if (cause?.name === "AbortError") throw cause;
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict source range read failed.", { cause });
  }
  if (bytes.byteLength !== length) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      "MDict source returned a short range.",
      { offset, requested: length, actual: bytes.byteLength }
    );
  }
  return bytes;
}

export function withMdictAbortSignal(source, signal) {
  if (!source || typeof source.read !== "function") return source;
  return {
    size: source.size,
    async read(offset, length) {
      assertNotAborted(signal);
      const bytes = await source.read(offset, length);
      assertNotAborted(signal);
      return bytes;
    }
  };
}

export function validateMdictSource(source, limits) {
  if (
    !source ||
    !Number.isSafeInteger(source.size) ||
    typeof source.read !== "function"
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict range source is invalid.");
  }
  requireMdictAtMost(source.size, limits.fileBytes, "MDX bytes");
  return source.size;
}

function assertNotAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException("MDX index construction cancelled.", "AbortError");
  }
}
