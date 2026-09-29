import {
  PACK_ERROR_CODES,
  PACK_LIMITS,
  packError
} from "./pack-manager.js";

export const IMPORT_QUARANTINE_ROOT =
  "dictionary-import-quarantine";

export const IMPORT_QUARANTINE_FILES = Object.freeze([
  "entries.dat",
  "index.dat",
  "manifest.json"
]);

export const IMPORT_QUARANTINE_RANGE_BYTES =
  4 * 1024 * 1024;

const FILE_SET = new Set(IMPORT_QUARANTINE_FILES);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function makeImportQuarantineToken(
  randomUUID = () => globalThis.crypto.randomUUID()
) {
  if (typeof randomUUID !== "function") {
    throw new Error(
      "Import quarantine token factory must be a function."
    );
  }
  const value = String(randomUUID() || "");
  if (!UUID_PATTERN.test(value)) {
    throw new Error(
      "Import quarantine token factory returned an invalid UUID."
    );
  }
  return "import-" + value.toLowerCase();
}

export function isSafeImportQuarantineToken(value) {
  const text = String(value || "");
  return text.startsWith("import-") &&
    UUID_PATTERN.test(
      text.slice("import-".length)
    );
}

export function assertImportQuarantineToken(token) {
  if (!isSafeImportQuarantineToken(token)) {
    throw packError(
      PACK_ERROR_CODES.STORAGE,
      "Unsafe import quarantine token."
    );
  }
}

export function isImportQuarantinePath(path) {
  return FILE_SET.has(String(path || ""));
}

export function assertImportQuarantinePath(path) {
  if (!isImportQuarantinePath(path)) {
    throw packError(
      PACK_ERROR_CODES.STORAGE,
      "Import quarantine only accepts TFLex manifest.json, index.dat and entries.dat."
    );
  }
}

export function normalizeImportQuarantineBytes(
  value,
  path
) {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength
        )
        : null;
  if (!bytes?.byteLength) {
    throw packError(
      PACK_ERROR_CODES.STORAGE,
      "Import quarantine file is empty or invalid.",
      { path }
    );
  }
  return bytes;
}

export function assertImportQuarantineFileSize(
  path,
  size
) {
  if (
    !Number.isSafeInteger(size) ||
    size <= 0
  ) {
    throw packError(
      PACK_ERROR_CODES.CORRUPT,
      "Import quarantine file size is invalid.",
      { path, size }
    );
  }
  const maximum = path === "manifest.json"
    ? PACK_LIMITS.catalogBytes
    : PACK_LIMITS.totalBytes;
  if (size > maximum) {
    throw packError(
      PACK_ERROR_CODES.QUOTA,
      "Import quarantine file exceeds the current safety ceiling.",
      {
        path,
        size,
        maximumBytes: maximum
      }
    );
  }
}

export function assertImportQuarantineTotalBytes(
  totalBytes
) {
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 0 ||
    totalBytes > PACK_LIMITS.totalBytes
  ) {
    throw packError(
      PACK_ERROR_CODES.QUOTA,
      "Import quarantine exceeds the current safety ceiling.",
      {
        totalBytes,
        maximumBytes: PACK_LIMITS.totalBytes
      }
    );
  }
}

export function assertImportQuarantineRange(
  offset,
  length
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > IMPORT_QUARANTINE_RANGE_BYTES
  ) {
    throw packError(
      PACK_ERROR_CODES.STORAGE,
      "Invalid import quarantine byte range.",
      {
        offset,
        length,
        maximumLength:
          IMPORT_QUARANTINE_RANGE_BYTES
      }
    );
  }
}
