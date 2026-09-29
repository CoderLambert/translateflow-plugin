import {
  LEXICAL_ERROR_CODES,
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../../shared/lexical.js";
import { PACK_ERROR_CODES } from "../../shared/pack-manager.js";
import { validateInstalledManifestValue } from "../packs/health.js";
import { ByteBoundedLru } from "./lru.js";
import {
  TflexReaderError,
  corrupt,
  incompatible,
  validateTflexRecord
} from "./tflex-integrity.js";

export function createOpfsIndexedTflexReader({
  store,
  snapshot,
  cryptoProvider = globalThis.crypto,
  readerVersion = 1,
  cacheMaxEntries = 64,
  cacheMaxBytes = 2 * 1024 * 1024
} = {}) {
  if (!store?.readFile || !store?.readFileRange) {
    throw new Error("OPFS indexed reader requires readFile and readFileRange");
  }
  if (!snapshot?.packId || !snapshot?.packVersion || !snapshot?.fingerprint) {
    throw new Error("OPFS indexed reader requires an active pack snapshot");
  }
  if (!cryptoProvider?.subtle) throw new Error("WebCrypto subtle API is required");

  const cache = new ByteBoundedLru({
    maxEntries: cacheMaxEntries,
    maxBytes: cacheMaxBytes
  });
  let metadataPromise = null;

  async function metadata() {
    if (!metadataPromise) {
      metadataPromise = loadMetadata({
        store,
        snapshot,
        cryptoProvider,
        readerVersion
      }).catch((error) => {
        metadataPromise = null;
        throw normalizeReaderError(error, snapshot.packId, "manifest.json");
      });
    }
    return metadataPromise;
  }

  async function lookupAll(text) {
    const key = normalizeLexicalKey(text);
    if (!key) return [];
    const exactKey = normalizeLexicalExactKey(text);
    const meta = await metadata();
    const item = findIndexEntry(meta.index.entries, key);
    if (!item) return [];

    const hits = [];
    for (const target of item.targets) {
      const cacheKey = target.offset + ":" + target.length + ":" + target.sha256;
      let record = cache.get(cacheKey);
      if (!record) {
        const bytes = await safeReadRange({
          store,
          snapshot,
          path: meta.entriesDescriptor.path,
          offset: target.offset,
          length: target.length
        });
        if (bytes.byteLength !== target.length) {
          throw corrupt(snapshot.packId, meta.entriesDescriptor.path, "Indexed TFLex record slice size mismatch");
        }
        const actual = await sha256Hex(bytes, cryptoProvider);
        if (actual !== target.sha256) {
          throw corrupt(snapshot.packId, meta.entriesDescriptor.path, "Indexed TFLex record slice hash mismatch");
        }
        try {
          record = JSON.parse(new TextDecoder().decode(bytes).trim());
        } catch (error) {
          throw corrupt(snapshot.packId, meta.entriesDescriptor.path, "Indexed TFLex record JSON is malformed", error);
        }
        validateTflexRecord(record, snapshot.packId, meta.entriesDescriptor.path);
        if (record.lookupKey !== target.lookupKey) {
          throw corrupt(snapshot.packId, meta.entriesDescriptor.path, "Indexed TFLex target/record key mismatch");
        }
        cache.set(cacheKey, record, bytes.byteLength);
      }

      if (target.matchedAlias) {
        if (
          item.key === target.lookupKey ||
          !Array.isArray(record.aliases) ||
          !record.aliases.some((alias) => normalizeLexicalKey(alias) === item.key)
        ) {
          throw corrupt(snapshot.packId, "index.dat", "Indexed TFLex alias target is inconsistent");
        }
      } else if (item.key !== target.lookupKey) {
        throw corrupt(snapshot.packId, "index.dat", "Indexed TFLex canonical target is inconsistent");
      }

      hits.push({
        record,
        exactCaseMatch: item.exactLookupKeys.includes(exactKey),
        matchedAlias: target.matchedAlias,
        aliasKey: target.matchedAlias ? item.key : "",
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

  return Object.freeze({
    lookupAll,
    async lookup(text) {
      return (await lookupAll(text))[0] || null;
    },
    async inspect() {
      const meta = await metadata();
      return {
        packId: meta.manifest.packId,
        packVersion: meta.manifest.packVersion,
        fingerprint: meta.manifest.fingerprint,
        sourceLanguage: meta.manifest.sourceLanguage,
        targetLanguage: meta.manifest.targetLanguage,
        recordCount: meta.manifest.recordCount,
        distributionStatus: meta.manifest.distributionStatus || "",
        sources: meta.manifest.sources.map((source) => ({
          id: source.id,
          version: source.version,
          licenseId: source.license?.id || ""
        }))
      };
    },
    clearCache() {
      cache.clear();
    },
    stats() {
      return {
        profile: "opfs-indexed-v1",
        metadataLoaded: Boolean(metadataPromise),
        cache: cache.stats()
      };
    }
  });
}

async function loadMetadata({
  store,
  snapshot,
  cryptoProvider,
  readerVersion
}) {
  const manifestDescriptor = snapshot.files.find(
    (file) => file.role === "manifest" && file.path === "manifest.json"
  );
  if (!manifestDescriptor) {
    throw corrupt(snapshot.packId, "manifest.json", "Installed TFLex manifest descriptor is missing");
  }
  const manifestBytes = await safeReadFile({
    store,
    snapshot,
    path: manifestDescriptor.path
  });
  await verifyFileDescriptor(
    manifestDescriptor,
    manifestBytes,
    cryptoProvider,
    snapshot.packId
  );

  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    manifest = validateInstalledManifestValue({
      manifest,
      snapshot,
      readerVersion
    });
  } catch (error) {
    throw normalizeReaderError(error, snapshot.packId, "manifest.json");
  }

  const indexDescriptor = manifest.files.find(
    (file) => file.role === "lookup-index" && file.path === "index.dat"
  );
  const entriesDescriptor = manifest.files.find(
    (file) => file.role === "lexical-data" && file.path === "entries.dat"
  );
  if (!indexDescriptor || !entriesDescriptor) {
    throw corrupt(manifest.packId, "manifest.json", "Indexed TFLex descriptors are missing");
  }

  const indexBytes = await safeReadFile({
    store,
    snapshot,
    path: indexDescriptor.path
  });
  await verifyFileDescriptor(
    indexDescriptor,
    indexBytes,
    cryptoProvider,
    manifest.packId
  );

  let index;
  try {
    index = JSON.parse(new TextDecoder().decode(indexBytes));
  } catch (error) {
    throw corrupt(manifest.packId, indexDescriptor.path, "Indexed TFLex index JSON is malformed", error);
  }
  validateIndexedIndex(index, manifest, entriesDescriptor);
  return { manifest, index, indexDescriptor, entriesDescriptor };
}

export function validateIndexedIndex(index, manifest, entriesDescriptor) {
  const packId = manifest?.packId || "";
  if (
    !index ||
    index.format !== "tflex-index" ||
    index.formatVersion !== 1 ||
    index.normalizationVersion !== 1 ||
    index.recordCount !== manifest?.recordCount ||
    index.entriesBytes !== entriesDescriptor?.size ||
    !Array.isArray(index.entries) ||
    !index.entries.length
  ) {
    throw corrupt(packId, "index.dat", "Indexed TFLex index metadata is malformed");
  }

  const canonicalKeys = new Set();
  const aliasTargets = [];
  let previousKey = null;

  for (const item of index.entries) {
    if (
      !item ||
      typeof item.key !== "string" ||
      !item.key ||
      normalizeLexicalKey(item.key) !== item.key ||
      (previousKey !== null && previousKey >= item.key) ||
      !Array.isArray(item.exactLookupKeys) ||
      item.exactLookupKeys.some((value) => typeof value !== "string" || !value) ||
      !Array.isArray(item.targets) ||
      !item.targets.length
    ) {
      throw corrupt(packId, "index.dat", "Indexed TFLex index entry is malformed");
    }

    const exactSeen = new Set();
    for (const value of item.exactLookupKeys) {
      if (exactSeen.has(value)) {
        throw corrupt(packId, "index.dat", "Indexed TFLex exact lookup keys contain duplicates");
      }
      exactSeen.add(value);
    }

    let previousTargetKey = null;
    for (const target of item.targets) {
      validateIndexTarget(target, entriesDescriptor.size, packId);
      if (previousTargetKey !== null && previousTargetKey >= target.lookupKey) {
        throw corrupt(packId, "index.dat", "Indexed TFLex targets must be unique and sorted");
      }
      previousTargetKey = target.lookupKey;

      if (target.matchedAlias) {
        if (item.key === target.lookupKey) {
          throw corrupt(packId, "index.dat", "Indexed TFLex alias cannot target its own canonical key");
        }
        aliasTargets.push(target.lookupKey);
      } else {
        if (item.key !== target.lookupKey || canonicalKeys.has(target.lookupKey)) {
          throw corrupt(packId, "index.dat", "Indexed TFLex canonical target is malformed");
        }
        canonicalKeys.add(target.lookupKey);
      }
    }
    previousKey = item.key;
  }

  if (canonicalKeys.size !== manifest.recordCount) {
    throw corrupt(packId, "index.dat", "Indexed TFLex canonical record count mismatch");
  }
  for (const target of aliasTargets) {
    if (!canonicalKeys.has(target)) {
      throw corrupt(packId, "index.dat", "Indexed TFLex alias target has no canonical record");
    }
  }
}

function validateIndexTarget(target, entriesBytes, packId) {
  if (
    !target ||
    typeof target.lookupKey !== "string" ||
    normalizeLexicalKey(target.lookupKey) !== target.lookupKey ||
    !Number.isSafeInteger(target.offset) ||
    target.offset < 0 ||
    !Number.isSafeInteger(target.length) ||
    target.length <= 0 ||
    target.offset > entriesBytes ||
    target.length > entriesBytes - target.offset ||
    typeof target.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(target.sha256) ||
    typeof target.matchedAlias !== "boolean"
  ) {
    throw corrupt(packId, "index.dat", "Indexed TFLex target is malformed");
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

async function verifyFileDescriptor(descriptor, bytes, cryptoProvider, packId) {
  if (bytes.byteLength !== descriptor.size) {
    throw corrupt(packId, descriptor.path, "Indexed TFLex file size mismatch");
  }
  const actual = await sha256Hex(bytes, cryptoProvider);
  if (actual !== descriptor.sha256) {
    throw corrupt(packId, descriptor.path, "Indexed TFLex file hash mismatch");
  }
}

async function safeReadFile({ store, snapshot, path }) {
  try {
    const bytes = await store.readFile(
      snapshot.packId,
      snapshot.packVersion,
      path
    );
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  } catch (error) {
    throw normalizeReaderError(error, snapshot.packId, path);
  }
}

async function safeReadRange({
  store,
  snapshot,
  path,
  offset,
  length
}) {
  try {
    const bytes = await store.readFileRange(
      snapshot.packId,
      snapshot.packVersion,
      path,
      offset,
      length
    );
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  } catch (error) {
    throw normalizeReaderError(error, snapshot.packId, path);
  }
}

function normalizeReaderError(error, packId, path) {
  if (error instanceof TflexReaderError) return error;
  if (error?.code === PACK_ERROR_CODES.INCOMPATIBLE) {
    return incompatible(packId, path, error.message || "Installed TFLex pack is incompatible");
  }
  if (
    error?.code === PACK_ERROR_CODES.CORRUPT ||
    error?.code === PACK_ERROR_CODES.HASH
  ) {
    return corrupt(packId, path, error.message || "Installed TFLex pack is corrupt", error);
  }
  return new TflexReaderError(
    LEXICAL_ERROR_CODES.STORAGE,
    error?.message || "Unable to read installed TFLex pack",
    { packId, path, cause: error }
  );
}

async function sha256Hex(bytes, cryptoProvider) {
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
