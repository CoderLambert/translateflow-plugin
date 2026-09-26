import {
  LEXICAL_ERROR_CODES,
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../../shared/lexical.js";
import { ByteBoundedLru } from "./lru.js";
import {
  TflexReaderError,
  corrupt,
  findTflexAlias,
  isSafeTflexPackPath,
  validateTflexDirectory,
  validateTflexManifest,
  validateTflexRecord,
  verifyTflexDescriptor,
  verifyTflexManifestFingerprint
} from "./tflex-integrity.js";

export function createTflexReader({
  packBasePath,
  readBytes,
  cryptoProvider = globalThis.crypto,
  readerVersion = 1,
  cacheMaxEntries = 4,
  cacheMaxBytes = 2 * 1024 * 1024
}) {
  if (typeof readBytes !== "function") throw new Error("readBytes is required");
  if (!cryptoProvider?.subtle) throw new Error("WebCrypto subtle API is required");
  const base = normalizeBasePath(packBasePath);
  const cache = new ByteBoundedLru({ maxEntries: cacheMaxEntries, maxBytes: cacheMaxBytes });
  let metadataPromise = null;

  async function metadata() {
    if (!metadataPromise) {
      metadataPromise = loadMetadata({ base, readBytes, cryptoProvider, readerVersion })
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
    const targets = resolveLookupTargets(meta.directory, key, exactKey);
    const hits = [];

    for (const target of targets) {
      const shard = findShard(meta.directory.shards, target.lookupKey);
      if (!shard) {
        if (target.matchedAlias) {
          throw corrupt(meta.manifest.packId, "directory.json", "TFLex alias target is missing");
        }
        continue;
      }
      const records = await loadShard({ base, shard, meta, readBytes, cryptoProvider, cache });
      const record = records.get(target.lookupKey);
      if (!record) {
        if (target.matchedAlias) {
          throw corrupt(meta.manifest.packId, shard.path, "TFLex alias target record is missing");
        }
        continue;
      }
      hits.push({
        record,
        exactCaseMatch: target.matchedAlias
          ? target.aliasExactCaseMatch
          : Array.isArray(record.exactLookupKeys) && record.exactLookupKeys.includes(exactKey),
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

  async function lookup(text) {
    return (await lookupAll(text))[0] || null;
  }

  return {
    lookup,
    lookupAll,
    clearCache() {
      cache.clear();
    },
    stats() {
      return { metadataLoaded: Boolean(metadataPromise), cache: cache.stats() };
    }
  };
}

export { TflexReaderError };

async function loadMetadata({ base, readBytes, cryptoProvider, readerVersion }) {
  const manifestBytes = await safeRead(readBytes, joinPackPath(base, "manifest.json"), "");
  const manifest = parseJson(manifestBytes, "manifest.json");
  validateTflexManifest(manifest, readerVersion);
  await verifyTflexManifestFingerprint(manifest, cryptoProvider);

  const directoryDescriptor = manifest.files.find(
    (file) => file.role === "lookup-index" && file.path === "directory.json"
  );
  if (!directoryDescriptor) {
    throw corrupt(manifest.packId, "directory.json", "TFLex directory descriptor is missing");
  }

  const directoryBytes = await safeRead(
    readBytes,
    joinPackPath(base, directoryDescriptor.path),
    manifest.packId
  );
  await verifyTflexDescriptor(directoryDescriptor, directoryBytes, cryptoProvider, manifest.packId);
  const directory = parseJson(directoryBytes, directoryDescriptor.path);
  validateTflexDirectory(directory, manifest);

  const fileDescriptors = new Map();
  for (const descriptor of manifest.files) {
    if (fileDescriptors.has(descriptor.path)) {
      throw corrupt(manifest.packId, descriptor.path, "Duplicate TFLex file descriptor");
    }
    fileDescriptors.set(descriptor.path, descriptor);
  }
  for (const shard of directory.shards) {
    const descriptor = fileDescriptors.get(shard.path);
    if (!descriptor || descriptor.role !== "lexical-data") {
      throw corrupt(manifest.packId, shard.path, "Directory references a missing lexical shard");
    }
    if (descriptor.size !== shard.size || descriptor.sha256 !== shard.sha256) {
      throw corrupt(manifest.packId, shard.path, "Directory and manifest shard metadata disagree");
    }
  }
  return { manifest, directory, fileDescriptors };
}

async function loadShard({ base, shard, meta, readBytes, cryptoProvider, cache }) {
  const cached = cache.get(shard.path);
  if (cached) return cached;

  const descriptor = meta.fileDescriptors.get(shard.path);
  const bytes = await safeRead(readBytes, joinPackPath(base, shard.path), meta.manifest.packId);
  await verifyTflexDescriptor(descriptor, bytes, cryptoProvider, meta.manifest.packId);
  const lines = new TextDecoder().decode(bytes).split(/\r?\n/).filter(Boolean);
  if (lines.length !== shard.count) {
    throw corrupt(meta.manifest.packId, shard.path, "TFLex shard record count mismatch");
  }

  const records = new Map();
  let firstKey = "";
  let lastKey = "";
  for (const line of lines) {
    const record = parseRecord(line, meta.manifest.packId, shard.path);
    validateTflexRecord(record, meta.manifest.packId, shard.path);
    if (records.has(record.lookupKey)) {
      throw corrupt(meta.manifest.packId, shard.path, "Duplicate TFLex lookup key");
    }
    if (lastKey && lastKey >= record.lookupKey) {
      throw corrupt(meta.manifest.packId, shard.path, "TFLex shard keys are not strictly ordered");
    }
    if (!firstKey) firstKey = record.lookupKey;
    lastKey = record.lookupKey;
    records.set(record.lookupKey, record);
  }

  if (firstKey !== shard.firstKey || lastKey !== shard.lastKey) {
    throw corrupt(meta.manifest.packId, shard.path, "TFLex shard key range mismatch");
  }
  cache.set(shard.path, records, bytes.byteLength);
  return records;
}

function resolveLookupTargets(directory, key, exactKey) {
  const targets = [];
  const seen = new Set();

  if (findShard(directory.shards, key)) {
    targets.push({ lookupKey: key, matchedAlias: false });
    seen.add(key);
  }

  const alias = findTflexAlias(directory, key, exactKey);
  if (alias) {
    const aliasExactCaseMatch = alias.exactLookupKeys.includes(exactKey);
    for (const lookupKey of alias.targets) {
      if (seen.has(lookupKey)) continue;
      targets.push({ lookupKey, matchedAlias: true, aliasExactCaseMatch });
      seen.add(lookupKey);
    }
  }
  return targets;
}

function findShard(shards, key) {
  let low = 0;
  let high = shards.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const shard = shards[middle];
    if (key < shard.firstKey) high = middle - 1;
    else if (key > shard.lastKey) low = middle + 1;
    else return shard;
  }
  return null;
}

async function safeRead(readBytes, path, packId) {
  try {
    const value = await readBytes(path);
    return value instanceof Uint8Array ? value : new Uint8Array(value);
  } catch (error) {
    if (error instanceof TflexReaderError) throw error;
    throw new TflexReaderError(
      LEXICAL_ERROR_CODES.STORAGE,
      "Unable to read TFLex package data",
      { packId, path, cause: error }
    );
  }
}

function parseJson(bytes, path) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw corrupt("", path, "Malformed TFLex JSON", error);
  }
}

function parseRecord(line, packId, path) {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw corrupt(packId, path, "Malformed TFLex record JSON", error);
  }
}

function normalizeBasePath(value) {
  const base = String(value || "").replace(/^\/+|\/+$/g, "");
  if (!base || !isSafeTflexPackPath(base)) throw new Error("packBasePath must be a safe relative path");
  return base;
}

function joinPackPath(base, path) {
  if (!isSafeTflexPackPath(path)) throw new Error("unsafe TFLex relative path");
  return base + "/" + path;
}
