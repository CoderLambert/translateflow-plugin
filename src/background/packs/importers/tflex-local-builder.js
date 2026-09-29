import {
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../../../shared/lexical.js";
import { validateTflexRecord } from "../../lexical/tflex-integrity.js";
import {
  LOCAL_IMPORT_DISTRIBUTION_STATUS,
  LOCAL_IMPORT_LICENSE_ID,
  LOCAL_IMPORT_SEMANTIC_PROFILE,
  LOCAL_IMPORT_SOURCE_ID,
  makeLocalImportFingerprintPayload,
  validateOwnedLocalTflexBuild
} from "../local-import.js";

const encoder = new TextEncoder();

export async function buildLocalIndexedTflex({
  packId,
  packVersion,
  semanticProfile = LOCAL_IMPORT_SEMANTIC_PROFILE,
  sourceLanguage = "en",
  targetLanguage = "zh-CN",
  records,
  sources,
  sourceEntryCount,
  sourceAliasCount,
  signal,
  cryptoProvider = globalThis.crypto
} = {}) {
  assertBuildActive(signal);
  if (!cryptoProvider?.subtle) {
    throw new Error("WebCrypto is required to build local TFLex");
  }
  if (!Array.isArray(records) || !records.length) {
    throw new Error("Local TFLex build requires records");
  }
  if (!Array.isArray(sources) || !sources.length) {
    throw new Error("Local TFLex build requires sources");
  }
  if (!Number.isSafeInteger(sourceEntryCount) || sourceEntryCount <= 0) {
    throw new Error("Local TFLex sourceEntryCount must be positive");
  }
  if (
    sourceAliasCount !== undefined &&
    (!Number.isSafeInteger(sourceAliasCount) || sourceAliasCount < 0)
  ) {
    throw new Error("Local TFLex sourceAliasCount is invalid");
  }

  const normalizedRecords = validateRecords(records, packId);
  assertBuildActive(signal);
  const indexed = await buildIndexedData(
    normalizedRecords,
    cryptoProvider,
    signal
  );
  assertBuildActive(signal);
  const entriesDescriptor = await descriptor(
    "lexical-data",
    "entries.dat",
    indexed.entriesBytes,
    cryptoProvider
  );
  assertBuildActive(signal);
  const indexDescriptor = await descriptor(
    "lookup-index",
    "index.dat",
    indexed.indexBytes,
    cryptoProvider
  );
  assertBuildActive(signal);
  const files = [entriesDescriptor, indexDescriptor].sort(compareDescriptor);

  const manifest = {
    format: "tflex",
    formatVersion: 1,
    readerMinVersion: 1,
    compilerVersion: 1,
    normalizationVersion: 1,
    packId,
    packVersion,
    sourceLanguage,
    targetLanguage,
    profile: "opfs-indexed-v1",
    distributionStatus: LOCAL_IMPORT_DISTRIBUTION_STATUS,
    semanticProfile,
    fingerprint: "",
    recordCount: normalizedRecords.length,
    sourceEntryCount,
    ...(sourceAliasCount === undefined ? {} : { sourceAliasCount }),
    license: localLicense(),
    sources: sources.map(normalizeSource),
    files
  };
  const fingerprintPayload = makeLocalImportFingerprintPayload(manifest);
  manifest.fingerprint = "sha256:" + await sha256Hex(
    encoder.encode(stableStringify(fingerprintPayload)),
    cryptoProvider
  );
  assertBuildActive(signal);

  const output = {
    "manifest.json": encoder.encode(stableStringify(manifest) + "\n"),
    "index.dat": indexed.indexBytes,
    "entries.dat": indexed.entriesBytes
  };
  const validated = await validateOwnedLocalTflexBuild({
    files: output,
    cryptoProvider
  });
  assertBuildActive(signal);
  return {
    files: output,
    manifest: validated.manifest,
    index: validated.index,
    records: normalizedRecords
  };
}

async function buildIndexedData(
  records,
  cryptoProvider,
  signal
) {
  const indexMap = new Map();
  const entryChunks = [];
  let offset = 0;

  for (const record of records) {
    assertBuildActive(signal);
    const bytes = encoder.encode(stableStringify(record) + "\n");
    const target = {
      lookupKey: record.lookupKey,
      offset,
      length: bytes.byteLength,
      sha256: await sha256Hex(bytes, cryptoProvider),
      matchedAlias: false
    };
    assertBuildActive(signal);
    entryChunks.push(bytes);
    addIndexTarget(
      indexMap,
      record.lookupKey,
      record.exactLookupKeys,
      target
    );

    for (const alias of record.aliases || []) {
      const aliasKey = normalizeLexicalKey(alias);
      const aliasExact = normalizeLexicalExactKey(alias);
      if (!aliasKey) continue;
      addIndexTarget(
        indexMap,
        aliasKey,
        [aliasExact],
        {
          ...target,
          matchedAlias: aliasKey !== record.lookupKey
        }
      );
    }
    offset += bytes.byteLength;
  }

  const entriesBytes = concatBytes(entryChunks, offset);
  const entries = [...indexMap.values()]
    .map((entry) => ({
      key: entry.key,
      exactLookupKeys: [...entry.exactLookupKeys]
        .filter(Boolean)
        .sort(compareText),
      targets: [...entry.targets.values()]
        .sort((a, b) => compareText(a.lookupKey, b.lookupKey))
    }))
    .sort((a, b) => compareText(a.key, b.key));
  const index = {
    format: "tflex-index",
    formatVersion: 1,
    normalizationVersion: 1,
    recordCount: records.length,
    entriesBytes: entriesBytes.byteLength,
    entries
  };
  const indexBytes = encoder.encode(stableStringify(index) + "\n");
  return { entriesBytes, indexBytes, index };
}

function validateRecords(records, packId) {
  const result = records.map((record) => structuredClone(record));
  let previous = "";
  for (const record of result) {
    validateTflexRecord(record, packId, "entries.dat");
    if (previous && previous >= record.lookupKey) {
      throw new Error("Local TFLex records must be strictly ordered");
    }
    previous = record.lookupKey;
  }
  return result;
}

function addIndexTarget(indexMap, rawKey, exactKeys, target) {
  const key = normalizeLexicalKey(rawKey);
  if (!key) return;
  let item = indexMap.get(key);
  if (!item) {
    item = {
      key,
      exactLookupKeys: new Set(),
      targets: new Map()
    };
    indexMap.set(key, item);
  }
  for (const exact of exactKeys || []) {
    if (exact) item.exactLookupKeys.add(exact);
  }
  const existing = item.targets.get(target.lookupKey);
  if (
    !existing ||
    (existing.matchedAlias && !target.matchedAlias)
  ) {
    item.targets.set(target.lookupKey, target);
  }
}

async function descriptor(role, path, bytes, cryptoProvider) {
  return {
    role,
    path,
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes, cryptoProvider)
  };
}

function normalizeSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Local TFLex source metadata is invalid");
  }
  return {
    ...structuredClone(source),
    semanticProfile:
      source.semanticProfile || LOCAL_IMPORT_SEMANTIC_PROFILE,
    license: {
      ...localLicense(),
      ...(source.license || {})
    }
  };
}

function localLicense() {
  return {
    id: LOCAL_IMPORT_LICENSE_ID,
    name: "User-provided dictionary; redistribution rights are not verified",
    source: LOCAL_IMPORT_SOURCE_ID
  };
}

async function sha256Hex(bytes, cryptoProvider) {
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
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


function assertBuildActive(signal) {
  if (!signal?.aborted) return;
  throw new DOMException(
    "Local TFLex build cancelled.",
    "AbortError"
  );
}
