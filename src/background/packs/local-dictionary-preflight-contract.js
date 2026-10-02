import {
  DICTIONARY_RUNTIME_CAPABILITIES,
  SHIPPED_DICTIONARY_RUNTIME_CAPABILITIES
} from "../../shared/dictionary-catalog-v2-schema.js";

export const LOCAL_DICTIONARY_PREFLIGHT_STATUS = Object.freeze([
  "supported", "partial", "unsupported", "invalid"
]);
export const LOCAL_DICTIONARY_PREFLIGHT_IMPORTERS = Object.freeze([
  "rich-mdict", "structured-mdict", "stardict", "tflex", "none"
]);
export const LOCAL_DICTIONARY_PREFLIGHT_LIMITS = Object.freeze({
  fileCount: 32,
  totalBytes: 640 * 1024 * 1024,
  titleChars: 120,
  fileNameChars: 180,
  tflexManifestBytes: 64 * 1024
});

const CAPABILITIES = new Set(DICTIONARY_RUNTIME_CAPABILITIES);
export const SHIPPED_CAPABILITIES = new Set(SHIPPED_DICTIONARY_RUNTIME_CAPABILITIES);
const utf8 = new TextDecoder("utf-8", { fatal: true });

export function basePreflightResult({
  family,
  files,
  sourceBytes,
  status,
  reason: mainReason = null,
  warnings = [],
  displayTitle,
  entryCount,
  capabilities = [],
  requiredCapabilities = [],
  unsupportedCapabilities = [],
  route = { importer: "none", requiresSemanticConfirmation: false },
  associatedMdd = [],
  unassociatedFiles = [],
  missingCompanionHints = [],
  identity = {}
}) {
  const safeCapabilities = uniqueCapabilities(capabilities);
  const safeRequired = uniqueCapabilities(requiredCapabilities);
  const safeUnsupported = uniqueCapabilities(unsupportedCapabilities);
  const cleanTitle = cleanDisplayText(displayTitle);
  return {
    schemaVersion: 1,
    identity: {
      family,
      ...(cleanTitle ? { displayTitle: cleanTitle } : {}),
      sourceFiles: files.map((file) => ({ fileName: safeFileLabel(file.name), size: file.size })),
      ...identity
    },
    compatibility: {
      status: LOCAL_DICTIONARY_PREFLIGHT_STATUS.includes(status) ? status : "invalid",
      capabilitiesPresent: safeCapabilities,
      capabilitiesRequired: safeRequired,
      unsupportedCapabilities: safeUnsupported,
      reasons: mainReason ? [mainReason] : [],
      warnings: warnings.filter(Boolean)
    },
    route: {
      importer: LOCAL_DICTIONARY_PREFLIGHT_IMPORTERS.includes(route.importer) ? route.importer : "none",
      requiresSemanticConfirmation: route.requiresSemanticConfirmation === true
    },
    resources: {
      associatedMdd,
      unassociatedFiles: unassociatedFiles.map((file) => safeFileLabel(file.name)),
      missingCompanionHints: missingCompanionHints.map(cleanDisplayText).filter(Boolean)
    },
    estimates: {
      sourceBytes,
      ...(Number.isSafeInteger(entryCount) && entryCount >= 0 ? { entryCount } : {}),
      expectedLocalBytes: null
    }
  };
}

export function reason(code, capability = null, stage = null) {
  const output = { code };
  if (CAPABILITIES.has(capability)) output.capability = capability;
  if (["header", "key-index", "record-index", "key-blocks", "index-validation"].includes(stage)) {
    output.stage = stage;
  }
  return output;
}

export function uniqueCapabilities(values) {
  return [...new Set(values)].filter((value) => CAPABILITIES.has(value));
}

export function normalizePreflightFiles(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > LOCAL_DICTIONARY_PREFLIGHT_LIMITS.fileCount) {
    throw new TypeError("Select between one and 32 local dictionary files.");
  }
  return input.map((file) => {
    if (!file || typeof file.name !== "string" || !Number.isSafeInteger(file.size) ||
        file.size < 0 || typeof file.slice !== "function") {
      throw new TypeError("Preflight accepts named local File or Blob objects only.");
    }
    return file;
  });
}

export function hasDuplicateFileNames(files) {
  const names = new Set();
  for (const file of files) {
    const key = file.name.normalize("NFKC").toLocaleLowerCase("en-US");
    if (names.has(key)) return true;
    names.add(key);
  }
  return false;
}

export function blobRangeSource(file, signal) {
  return {
    size: file.size,
    async read(offset, length) {
      assertPreflightActive(signal);
      const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
      assertPreflightActive(signal);
      return bytes;
    }
  };
}

export async function readPreflightBytes(file, signal, maximum) {
  assertPreflightActive(signal);
  assertPreflightFileLimit(file, maximum, "file.too_large");
  const bytes = new Uint8Array(await file.slice(0, file.size).arrayBuffer());
  assertPreflightActive(signal);
  if (bytes.byteLength !== file.size) throw new TypeError("Local file read returned an incomplete range.");
  return bytes;
}

export async function readPreflightRange(file, offset, length, signal) {
  assertPreflightActive(signal);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
      offset < 0 || length < 0 || offset + length > file.size) {
    throw new RangeError("file.range_invalid");
  }
  const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  assertPreflightActive(signal);
  if (bytes.byteLength !== length) throw new TypeError("Local file read returned an incomplete range.");
  return bytes;
}

export async function readPreflightUtf8(file, signal, maximum) {
  return utf8.decode(await readPreflightBytes(file, signal, maximum));
}

export function assertPreflightFileLimit(file, maximum, code) {
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maximum) {
    const error = new RangeError(code);
    error.preflightReason = code;
    throw error;
  }
}

export function assertPreflightActive(signal) {
  if (signal?.aborted) throw preflightAbortError();
}

export function preflightAbortError() {
  return new DOMException("Dictionary preflight was cancelled.", "AbortError");
}

export function isPreflightAbort(error, signal) {
  return signal?.aborted || error?.name === "AbortError";
}

export function cleanDisplayText(value) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, " ")
    .replace(/[<>]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, LOCAL_DICTIONARY_PREFLIGHT_LIMITS.titleChars);
}

export function safeFileLabel(value) {
  return String(value || "")
    .replace(/[\\/\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, "_")
    .replace(/[<>]/gu, "_")
    .trim()
    .slice(0, LOCAL_DICTIONARY_PREFLIGHT_LIMITS.fileNameChars) || "local file";
}

export function preflightExtension(name) {
  const value = name.toLocaleLowerCase("en-US");
  if (value.endsWith(".dict.dz")) return ".dict.dz";
  return value.slice(value.lastIndexOf("."));
}

export function normalizePreflightLanguage(value) {
  return String(value || "").replaceAll("_", "-").toLocaleLowerCase("en-US");
}

export function escapePreflightRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
