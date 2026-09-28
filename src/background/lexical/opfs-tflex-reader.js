import {
  LEXICAL_ERROR_CODES,
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../../shared/lexical.js";
import {
  TflexReaderError,
  corrupt,
  incompatible,
  validateTflexRecord
} from "./tflex-integrity.js";

export function createOpfsTflexReader({
  store,
  snapshot,
  cryptoProvider = globalThis.crypto,
  readerVersion = 1
} = {}) {
  if (!store?.readFile || !store?.readFileSlice) throw new Error("OPFS TFLex store requires readFile and readFileSlice");
  if (!snapshot?.packId || !snapshot?.packVersion) throw new Error("OPFS TFLex snapshot is required");
  if (!cryptoProvider?.subtle) throw new Error("WebCrypto subtle API is required");
  let metadataPromise = null;

  async function metadata() {
    if (!metadataPromise) {
      metadataPromise = loadMetadata({ store, snapshot, cryptoProvider, readerVersion })
        .catch((error) => {
          metadataPromise = null;
          throw error;
        });
    }
    return metadataPromise;
  }

  async function lookupAll(text) {
    const key = normalizeLexicalKey(text);
    if (!key) return [];
    const exactKey = normalizeLexicalExactKey(text);
    const meta = await metadata();
    const indexEntry = findIndexEntry(meta.index.entries, key);
    if (!indexEntry) return [];

    const hits = [];
    for (const target of indexEntry.targets) {
      const bytes = await safeSlice(
        store,
        snapshot.packId,
        snapshot.packVersion,
        "entries.dat",
        target.offset,
        target.length
      );
      if (bytes.byteLength !== target.length) {
        throw corrupt(snapshot.packId, "entries.dat", "Indexed TFLex record slice length mismatch");
      }
      const actual = await sha256Hex(bytes, cryptoProvider);
      if (actual !== target.sha256) {
        throw corrupt(snapshot.packId, "entries.dat", "Indexed TFLex record slice hash mismatch");
      }
      const record = parseRecord(bytes, snapshot.packId);
      validateTflexRecord(record, snapshot.packId, "entries.dat");
      if (record.lookupKey !== target.lookupKey) {
        throw corrupt(snapshot.packId, "entries.dat", "Indexed TFLex lookup target does not match record");
      }
      hits.push({
        record,
        exactCaseMatch: indexEntry.exactLookupKeys.includes(exactKey),
        matchedAlias: target.matchedAlias,
        aliasKey: target.matchedAlias ? key : "",
        pack: {
          packId: meta.manifest.packId,
          packVersion: meta.manifest.packVersion,
          fingerprint: meta.manifest.fingerprint,
          sourceLanguage: meta.manifest.sourceLanguage,
          targetLanguage: meta.manifest.targetLanguage
        }
      });
    }
    return hits;
  }

  return {
    async lookup(text) {
      return (await lookupAll(text))[0] || null;
    },
    lookupAll,
    clearCache() {
      metadataPromise = null;
    },
    stats() {
      return {
        metadataLoaded: Boolean(metadataPromise),
        packId: snapshot.packId,
        packVersion: snapshot.packVersion
      };
    }
  };
}

async function loadMetadata({ store, snapshot, cryptoProvider, readerVersion }) {
  const manifestDescriptor = descriptor(snapshot.files, "manifest", "manifest.json");
  const manifestBytes = await safeRead(store, snapshot.packId, snapshot.packVersion, "manifest.json");
  await verifyDescriptor(manifestDescriptor, manifestBytes, snapshot.packId, cryptoProvider);
  const manifest = parseJson(manifestBytes, snapshot.packId, "manifest.json");

  if (
    manifest.format !== "tflex" ||
    manifest.formatVersion !== 1 ||
    !Number.isSafeInteger(manifest.readerMinVersion) ||
    manifest.readerMinVersion <= 0 ||
    manifest.readerMinVersion > readerVersion ||
    manifest.normalizationVersion !== 1 ||
    manifest.profile !== "opfs-indexed-v1" ||
    manifest.packId !== snapshot.packId ||
    manifest.packVersion !== snapshot.packVersion ||
    manifest.sourceLanguage !== "en" ||
    manifest.targetLanguage !== "zh-CN"
  ) {
    throw incompatible(snapshot.packId, "manifest.json", "Unsupported indexed TFLex manifest");
  }
  if (manifest.fingerprint !== snapshot.fingerprint) {
    throw corrupt(snapshot.packId, "manifest.json", "Indexed TFLex fingerprint disagrees with active metadata");
  }
  if (!Array.isArray(manifest.sources) || !manifest.sources.length) {
    throw corrupt(snapshot.packId, "manifest.json", "Indexed TFLex source provenance is missing");
  }
  for (const source of manifest.sources) {
    if (!source?.id || !source?.version || !source?.provenance || !source?.license?.id) {
      throw corrupt(snapshot.packId, "manifest.json", "Indexed TFLex source provenance is malformed");
    }
  }

  const indexDescriptor = descriptor(manifest.files, "lookup-index", "index.dat");
  const entriesDescriptor = descriptor(manifest.files, "lexical-data", "entries.dat");
  crossCheckSnapshotDescriptor(snapshot.files, indexDescriptor);
  crossCheckSnapshotDescriptor(snapshot.files, entriesDescriptor);

  const indexBytes = await safeRead(store, snapshot.packId, snapshot.packVersion, "index.dat");
  await verifyDescriptor(indexDescriptor, indexBytes, snapshot.packId, cryptoProvider);
  const index = parseJson(indexBytes, snapshot.packId, "index.dat");
  validateIndex(index, {
    packId: snapshot.packId,
    entriesBytes: entriesDescriptor.size,
    recordCount: manifest.recordCount
  });
  await verifyManifestFingerprint(manifest, cryptoProvider);
  return { manifest, index, entriesDescriptor };
}

function validateIndex(index, { packId, entriesBytes, recordCount }) {
  if (
    index?.format !== "tflex-index" ||
    index.formatVersion !== 1 ||
    index.normalizationVersion !== 1 ||
    index.recordCount !== recordCount ||
    index.entriesBytes !== entriesBytes ||
    !Array.isArray(index.entries) ||
    !index.entries.length
  ) {
    throw corrupt(packId, "index.dat", "Malformed indexed TFLex index");
  }
  let previousKey = "";
  for (const item of index.entries) {
    if (
      !item?.key ||
      normalizeLexicalKey(item.key) !== item.key ||
      (previousKey && previousKey >= item.key) ||
      !Array.isArray(item.exactLookupKeys) ||
      !Array.isArray(item.targets) ||
      !item.targets.length
    ) {
      throw corrupt(packId, "index.dat", "Malformed indexed TFLex index entry");
    }
    previousKey = item.key;
    const targetKeys = new Set();
    for (const target of item.targets) {
      if (
        !target?.lookupKey ||
        normalizeLexicalKey(target.lookupKey) !== target.lookupKey ||
        targetKeys.has(target.lookupKey) ||
        !Number.isSafeInteger(target.offset) ||
        target.offset < 0 ||
        !Number.isSafeInteger(target.length) ||
        target.length <= 0 ||
        target.offset + target.length > entriesBytes ||
        !/^[a-f0-9]{64}$/.test(target.sha256 || "") ||
        typeof target.matchedAlias !== "boolean"
      ) {
        throw corrupt(packId, "index.dat", "Malformed indexed TFLex lookup target");
      }
      targetKeys.add(target.lookupKey);
    }
  }
}

function findIndexEntry(entries, key) {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const item = entries[middle];
    if (key < item.key) high = middle - 1;
    else if (key > item.key) low = middle + 1;
    else return item;
  }
  return null;
}

async function verifyManifestFingerprint(manifest, cryptoProvider) {
  const payload = {
    formatVersion: manifest.formatVersion,
    normalizationVersion: manifest.normalizationVersion,
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    profile: manifest.profile,
    sources: [...manifest.sources]
      .sort((a, b) => compareText(a.id, b.id))
      .map((source) => ({
        id: source.id,
        version: source.version,
        provenance: source.provenance,
        dataSha512: source.dataSha512,
        teiSha256: source.teiSha256,
        licenseId: source.license?.id
      })),
    files: [...manifest.files]
      .sort(compareDescriptor)
      .map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }))
  };
  const actual = "sha256:" + await sha256Hex(
    new TextEncoder().encode(stableStringify(payload)),
    cryptoProvider
  );
  if (actual !== String(manifest.fingerprint || "").toLowerCase()) {
    throw corrupt(manifest.packId, "manifest.json", "Indexed TFLex manifest fingerprint mismatch");
  }
}

function descriptor(files, role, path) {
  const matches = (Array.isArray(files) ? files : []).filter(
    (file) => file?.role === role && file?.path === path
  );
  if (matches.length !== 1) throw corrupt("", path, "Indexed TFLex descriptor is missing or duplicated");
  const file = matches[0];
  if (
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    !/^[a-f0-9]{64}$/i.test(file.sha256 || "")
  ) {
    throw corrupt("", path, "Indexed TFLex descriptor is malformed");
  }
  return file;
}

function crossCheckSnapshotDescriptor(files, expected) {
  const match = (Array.isArray(files) ? files : []).find(
    (file) => file?.role === expected.role && file?.path === expected.path
  );
  if (!match || match.size !== expected.size || match.sha256 !== expected.sha256) {
    throw corrupt("", expected.path, "Installed metadata and manifest descriptor disagree");
  }
}

async function verifyDescriptor(descriptor, bytes, packId, cryptoProvider) {
  if (bytes.byteLength !== descriptor.size) {
    throw corrupt(packId, descriptor.path, "Indexed TFLex file size mismatch");
  }
  const actual = await sha256Hex(bytes, cryptoProvider);
  if (actual !== descriptor.sha256.toLowerCase()) {
    throw corrupt(packId, descriptor.path, "Indexed TFLex file hash mismatch");
  }
}

async function safeRead(store, packId, version, path) {
  try {
    const value = await store.readFile(packId, version, path);
    return value instanceof Uint8Array ? value : new Uint8Array(value);
  } catch (error) {
    if (error instanceof TflexReaderError) throw error;
    throw new TflexReaderError(
      LEXICAL_ERROR_CODES.STORAGE,
      "Unable to read indexed TFLex data",
      { packId, path, cause: error }
    );
  }
}

async function safeSlice(store, packId, version, path, offset, length) {
  try {
    const value = await store.readFileSlice(packId, version, path, offset, length);
    return value instanceof Uint8Array ? value : new Uint8Array(value);
  } catch (error) {
    if (error instanceof TflexReaderError) throw error;
    throw new TflexReaderError(
      LEXICAL_ERROR_CODES.STORAGE,
      "Unable to read indexed TFLex record",
      { packId, path, cause: error }
    );
  }
}

function parseJson(bytes, packId, path) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw corrupt(packId, path, "Malformed indexed TFLex JSON", error);
  }
}

function parseRecord(bytes, packId) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes).trim());
  } catch (error) {
    throw corrupt(packId, "entries.dat", "Malformed indexed TFLex record JSON", error);
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
    Object.keys(value).sort(compareText).map((key) => [key, sortJson(value[key])])
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
