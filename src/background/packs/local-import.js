import {
  PACK_ERROR_CODES,
  PACK_LIMITS,
  isSafePackIdentifier,
  packError
} from "../../shared/pack-manager.js";
import { validateInstalledManifestValue } from "./health.js";
import {
  assertSafeLocalDataText,
  validateLocalIndexedRecords
} from "./local-import-integrity.js";
import { validateIndexedIndex } from "../lexical/opfs-indexed-reader.js";

export const LOCAL_IMPORT_SOURCE_ID = "local-user-import";
export const LOCAL_IMPORT_DISTRIBUTION_STATUS = "user-import-only";
export const LOCAL_IMPORT_SEMANTIC_PROFILE = "en-zh-plain-text-translation-v1";
export const LOCAL_IMPORT_LICENSE_ID = "USER-PROVIDED-UNVERIFIED";

const REQUIRED_FILES = Object.freeze(["entries.dat", "index.dat", "manifest.json"]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

export async function validateLocalTflexImport({
  files,
  cryptoProvider = globalThis.crypto
} = {}) {
  if (!cryptoProvider?.subtle) {
    throw packError(PACK_ERROR_CODES.HASH, "WebCrypto is unavailable for local dictionary verification.");
  }
  const normalizedFiles = normalizeInputFiles(files);
  const totalBytes = REQUIRED_FILES.reduce(
    (sum, path) => sum + normalizedFiles[path].byteLength,
    0
  );
  if (totalBytes > PACK_LIMITS.totalBytes) {
    throw packError(PACK_ERROR_CODES.QUOTA, "Local dictionary import exceeds the current safety ceiling.", {
      totalBytes,
      maximumBytes: PACK_LIMITS.totalBytes
    });
  }

  const manifestBytes = normalizedFiles["manifest.json"];
  if (manifestBytes.byteLength > PACK_LIMITS.catalogBytes) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary manifest exceeds the safety ceiling.");
  }

  const manifest = parseJson(manifestBytes, "manifest.json");
  validateLocalManifestIdentity(manifest);

  const descriptors = validateLocalDescriptors(manifest, normalizedFiles);
  for (const descriptor of descriptors.values()) {
    const bytes = normalizedFiles[descriptor.path];
    const actual = await sha256Hex(bytes, cryptoProvider);
    if (actual !== descriptor.sha256) {
      throw packError(PACK_ERROR_CODES.HASH, "Local dictionary file SHA-256 failed verification.", {
        path: descriptor.path,
        expectedSha256: descriptor.sha256,
        actualSha256: actual
      });
    }
  }

  const index = parseJson(normalizedFiles["index.dat"], "index.dat");
  const entriesDescriptor = descriptors.get("entries.dat");
  validateIndexedIndex(index, manifest, entriesDescriptor);
  await validateLocalIndexedRecords({
    index,
    entriesBytes: normalizedFiles["entries.dat"],
    manifest,
    cryptoProvider,
    sourceIds: new Set(manifest.sources.map((source) => source.id))
  });

  const actualFingerprint = "sha256:" + await sha256Hex(
    encoder.encode(stableStringify(makeLocalImportFingerprintPayload(manifest))),
    cryptoProvider
  );
  if (actualFingerprint !== String(manifest.fingerprint || "").toLowerCase()) {
    throw packError(PACK_ERROR_CODES.HASH, "Local dictionary manifest fingerprint failed verification.", {
      expectedFingerprint: manifest.fingerprint,
      actualFingerprint
    });
  }

  const manifestDescriptor = {
    role: "manifest",
    path: "manifest.json",
    size: manifestBytes.byteLength,
    sha256: await sha256Hex(manifestBytes, cryptoProvider)
  };
  const snapshot = {
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    sourceId: LOCAL_IMPORT_SOURCE_ID,
    fingerprint: manifest.fingerprint,
    totalBytes,
    files: [
      manifestDescriptor,
      ...[...descriptors.values()].sort(compareDescriptor)
    ],
    verifiedAt: Date.now()
  };
  validateInstalledManifestValue({ manifest, snapshot });

  return {
    manifest,
    index,
    snapshot,
    totalBytes,
    files: REQUIRED_FILES.map((path) => ({
      path,
      bytes: normalizedFiles[path]
    }))
  };
}

export function makeLocalImportFingerprintPayload(manifest) {
  return {
    formatVersion: 1,
    normalizationVersion: 1,
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    profile: "opfs-indexed-v1",
    distributionStatus: LOCAL_IMPORT_DISTRIBUTION_STATUS,
    semanticProfile: manifest.semanticProfile,
    sources: [...manifest.sources]
      .sort((a, b) => compareText(a?.id, b?.id))
      .map((source) => ({
        id: source.id,
        version: source.version,
        provenance: source.provenance,
        semanticProfile: source.semanticProfile,
        sourceFileSha256: source.sourceFileSha256,
        licenseId: source.license?.id
      })),
    files: [...manifest.files]
      .sort(compareDescriptor)
      .map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }))
  };
}

function normalizeInputFiles(files) {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary import requires exactly three TFLex files.");
  }
  const keys = Object.keys(files).sort(compareText);
  if (
    keys.length !== REQUIRED_FILES.length ||
    keys.some((key, index) => key !== REQUIRED_FILES[index])
  ) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary import requires exactly manifest.json, index.dat and entries.dat.");
  }

  const result = {};
  for (const path of REQUIRED_FILES) {
    const value = files[path];
    const bytes = value instanceof Uint8Array
      ? new Uint8Array(value)
      : value instanceof ArrayBuffer
        ? new Uint8Array(value.slice(0))
        : null;
    if (!bytes?.byteLength) {
      throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary import file is empty or invalid.", { path });
    }
    result[path] = bytes;
  }
  return result;
}

function validateLocalManifestIdentity(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary manifest must be an object.");
  }
  if (
    manifest.format !== "tflex" ||
    manifest.formatVersion !== 1 ||
    manifest.readerMinVersion !== 1 ||
    manifest.normalizationVersion !== 1 ||
    manifest.profile !== "opfs-indexed-v1" ||
    manifest.distributionStatus !== LOCAL_IMPORT_DISTRIBUTION_STATUS ||
    manifest.semanticProfile !== LOCAL_IMPORT_SEMANTIC_PROFILE ||
    manifest.sourceLanguage !== "en" ||
    manifest.targetLanguage !== "zh-CN" ||
    typeof manifest.fingerprint !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(manifest.fingerprint) ||
    !Number.isSafeInteger(manifest.recordCount) ||
    manifest.recordCount <= 0
  ) {
    throw packError(PACK_ERROR_CODES.INCOMPATIBLE, "Local dictionary manifest is incompatible with the supported import profile.");
  }
  if (
    !isSafePackIdentifier(manifest.packId) ||
    !String(manifest.packId).startsWith("local-")
  ) {
    throw packError(PACK_ERROR_CODES.INCOMPATIBLE, "Local dictionary packId must be a safe local-* identifier.");
  }
  if (!isSafePackIdentifier(manifest.packVersion, PACK_LIMITS.versionChars)) {
    throw packError(PACK_ERROR_CODES.INCOMPATIBLE, "Local dictionary packVersion is invalid.");
  }
  if (
    manifest.license?.id !== LOCAL_IMPORT_LICENSE_ID ||
    !Array.isArray(manifest.sources) ||
    !manifest.sources.length
  ) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary source/license boundary is invalid.");
  }
  const sourceIds = new Set();
  for (const source of manifest.sources) {
    if (
      !source?.id ||
      !source?.version ||
      !source?.provenance ||
      source?.semanticProfile !== LOCAL_IMPORT_SEMANTIC_PROFILE ||
      source?.license?.id !== LOCAL_IMPORT_LICENSE_ID
    ) {
      throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary source provenance is malformed.");
    }
    if (sourceIds.has(source.id)) {
      throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary source IDs must be unique.");
    }
    sourceIds.add(source.id);
    assertSafeLocalDataText(source.id, "source id");
    assertSafeLocalDataText(source.version, "source version");
    assertSafeLocalDataText(source.provenance, "source provenance");
  }
}

function validateLocalDescriptors(manifest, files) {
  if (!Array.isArray(manifest.files) || manifest.files.length !== 2) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary manifest must describe exactly index.dat and entries.dat.");
  }
  const descriptors = new Map();
  for (const descriptor of manifest.files) {
    if (
      !descriptor ||
      !["lookup-index", "lexical-data"].includes(descriptor.role) ||
      !["index.dat", "entries.dat"].includes(descriptor.path) ||
      !Number.isSafeInteger(descriptor.size) ||
      descriptor.size <= 0 ||
      descriptor.size !== files[descriptor.path]?.byteLength ||
      typeof descriptor.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
      descriptors.has(descriptor.path)
    ) {
      throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary file descriptor is malformed.");
    }
    if (
      (descriptor.path === "index.dat" && descriptor.role !== "lookup-index") ||
      (descriptor.path === "entries.dat" && descriptor.role !== "lexical-data")
    ) {
      throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary file role/path mapping is invalid.");
    }
    descriptors.set(descriptor.path, descriptor);
  }
  if (!descriptors.has("index.dat") || !descriptors.has("entries.dat")) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary file descriptors are incomplete.");
  }
  return descriptors;
}

function parseJson(bytes, path) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary " + path + " is not valid UTF-8 JSON.", {
      path,
      cause: error
    });
  }
}

async function sha256Hex(bytes, cryptoProvider) {
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareText)
      .map((key) => [key, sortJson(value[key])])
  );
}

function compareDescriptor(a, b) {
  return compareText(a.path, b.path) || compareText(a.role, b.role);
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}
