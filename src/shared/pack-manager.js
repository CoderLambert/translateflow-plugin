export const PACK_MANAGER_STATE_KEY = "tfDictionaryPackStateV1";
export const PACK_CATALOG_SCHEMA = "translateflow-pack-catalog";
export const PACK_CATALOG_SCHEMA_VERSION = 1;
export const PACK_READER_VERSION = 1;

export const PACK_ERROR_CODES = Object.freeze({
  UNTRUSTED_SOURCE: "PACK_UNTRUSTED_SOURCE",
  PERMISSION_REQUIRED: "PACK_PERMISSION_REQUIRED",
  CATALOG_SIGNATURE: "PACK_CATALOG_SIGNATURE",
  CATALOG_SCHEMA: "PACK_CATALOG_SCHEMA",
  CATALOG_REPLAY: "PACK_CATALOG_REPLAY",
  NOT_FOUND: "PACK_NOT_FOUND",
  DOWNGRADE: "PACK_DOWNGRADE",
  BUSY: "PACK_BUSY",
  CANCELLED: "PACK_CANCELLED",
  QUOTA: "PACK_QUOTA",
  DOWNLOAD: "PACK_DOWNLOAD",
  HASH: "PACK_HASH",
  STORAGE: "PACK_STORAGE",
  INCOMPATIBLE: "PACK_INCOMPATIBLE",
  CORRUPT: "PACK_CORRUPT",
  NEEDS_REINSTALL: "PACK_NEEDS_REINSTALL"
});

export const PACK_LIMITS = Object.freeze({
  catalogBytes: 512 * 1024,
  signatureBytes: 16 * 1024,
  fileCount: 64,
  fileBytes: 64 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  safetyMarginBytes: 32 * 1024 * 1024,
  packIdChars: 80,
  versionChars: 120,
  pathChars: 240
});

export class DictionaryPackError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DictionaryPackError";
    this.code = code;
    for (const [key, value] of Object.entries(details || {})) {
      if (value !== undefined) this[key] = value;
    }
  }
}

export function packError(code, message, details) {
  return new DictionaryPackError(code, message, details);
}

export function isSafePackIdentifier(value, maxChars = PACK_LIMITS.packIdChars) {
  const text = String(value || "");
  return text.length > 0 &&
    text.length <= maxChars &&
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(text);
}

export function isSafePackPath(value) {
  const path = String(value || "");
  return Boolean(path) &&
    path.length <= PACK_LIMITS.pathChars &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => !part || part === "." || part === "..");
}
