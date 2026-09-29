import {
  PACK_ERROR_CODES,
  PACK_LIMITS,
  isSafePackIdentifier,
  packError
} from "../../shared/pack-manager.js";
import {
  normalizeLexicalKey
} from "../../shared/lexical.js";
import { validateInstalledManifestValue } from "./health.js";
import { validateIndexedIndex } from "../lexical/opfs-indexed-reader.js";
import { validateTflexRecord } from "../lexical/tflex-integrity.js";

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
  await validateAllIndexedRecords({
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
    assertSafeDataText(source.id, "source id");
    assertSafeDataText(source.version, "source version");
    assertSafeDataText(source.provenance, "source provenance");
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

async function validateAllIndexedRecords({
  index,
  entriesBytes,
  manifest,
  cryptoProvider,
  sourceIds
}) {
  const validated = new Map();
  const canonicalRanges = [];

  for (const item of index.entries) {
    for (const target of item.targets) {
      const key = [
        target.offset,
        target.length,
        target.sha256,
        target.lookupKey
      ].join(":");
      let record = validated.get(key);
      if (!record) {
        const slice = entriesBytes.subarray(
          target.offset,
          target.offset + target.length
        );
        const actual = await sha256Hex(slice, cryptoProvider);
        if (actual !== target.sha256) {
          throw packError(PACK_ERROR_CODES.HASH, "Local dictionary indexed record SHA-256 failed verification.", {
            lookupKey: target.lookupKey,
            offset: target.offset
          });
        }
        record = parseJson(slice, "entries.dat");
        try {
          validateTflexRecord(record, manifest.packId, "entries.dat");
        } catch (error) {
          throw packError(PACK_ERROR_CODES.CORRUPT, error?.message || "Local dictionary record is malformed.", {
            lookupKey: target.lookupKey,
            cause: error
          });
        }
        if (record.lookupKey !== target.lookupKey) {
          throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary index/record key mismatch.", {
            indexKey: target.lookupKey,
            recordKey: record.lookupKey
          });
        }
        validateLocalRecordStrings(record, sourceIds);
        validated.set(key, record);
      }

      if (target.matchedAlias) {
        if (
          item.key === target.lookupKey ||
          !Array.isArray(record.aliases) ||
          !record.aliases.some((alias) => normalizeLexicalKey(alias) === item.key)
        ) {
          throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary alias target is inconsistent.");
        }
      } else {
        canonicalRanges.push({
          lookupKey: target.lookupKey,
          offset: target.offset,
          length: target.length
        });
      }
    }
  }

  canonicalRanges.sort((a, b) => a.offset - b.offset || compareText(a.lookupKey, b.lookupKey));
  if (canonicalRanges.length !== manifest.recordCount) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary canonical record count mismatch.");
  }
  let expectedOffset = 0;
  for (const range of canonicalRanges) {
    if (range.offset !== expectedOffset) {
      throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary entries.dat contains gaps, overlaps or hidden trailing payload.");
    }
    expectedOffset += range.length;
  }
  if (expectedOffset !== entriesBytes.byteLength) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary entries.dat contains unindexed trailing payload.");
  }
}

function validateLocalRecordStrings(record, sourceIds) {
  if (record.kind !== "lexical") {
    throw packError(PACK_ERROR_CODES.INCOMPATIBLE, "Local bilingual import profile only accepts lexical records.");
  }
  if (!Array.isArray(record.exactLookupKeys) || !Array.isArray(record.aliases)) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary lookup metadata is malformed.");
  }
  assertSafeDataText(record.displayForm, "display form");
  for (const value of record.exactLookupKeys) {
    if (typeof value !== "string" || normalizeLexicalKey(value) !== record.lookupKey) {
      throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary exact lookup key is malformed.");
    }
    assertSafeDataText(value, "exact lookup key");
  }
  for (const alias of record.aliases) {
    if (typeof alias !== "string" || !normalizeLexicalKey(alias)) {
      throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary alias is malformed.");
    }
    assertSafeDataText(alias, "alias");
  }
  for (const sense of record.senses || []) {
    assertSafeDataText(sense.id, "sense id");
    for (const value of sense.translations || []) assertSafeDataText(value, "translation");
    for (const value of sense.domains || []) assertSafeDataText(value, "domain");
    for (const value of sense.typeLabels || []) assertSafeDataText(value, "type label");
    for (const ref of sense.sourceRefs || []) {
      if (!sourceIds.has(ref.sourceId)) {
        throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary sourceRef references an undeclared source.");
      }
      assertSafeDataText(ref.sourceId, "sourceRef sourceId");
      assertSafeDataText(ref.recordId, "sourceRef recordId");
    }
  }
}

function assertSafeDataText(value, label) {
  const text = String(value || "");
  if (
    !text ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ||
    /<\/?[A-Za-z][^>]*>/u.test(text) ||
    /<!--|<!DOCTYPE\b|<\?/iu.test(text) ||
    /javascript\s*:/iu.test(text)
  ) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Local dictionary " + label + " contains unsafe renderable/control content.");
  }
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
