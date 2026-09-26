import {
  LEXICAL_ERROR_CODES,
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../../shared/lexical.js";
import { ByteBoundedLru } from "./lru.js";

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

  async function lookup(text) {
    const key = normalizeLexicalKey(text);
    if (!key) return null;
    const meta = await metadata();
    const shard = findShard(meta.directory.shards, key);
    if (!shard) return null;
    const records = await loadShard({ base, shard, meta, readBytes, cryptoProvider, cache });
    const record = records.get(key);
    if (!record) return null;
    const exactKey = normalizeLexicalExactKey(text);
    return {
      record,
      exactCaseMatch: Array.isArray(record.exactLookupKeys) && record.exactLookupKeys.includes(exactKey),
      pack: {
        packId: meta.manifest.packId,
        packVersion: meta.manifest.packVersion,
        fingerprint: meta.manifest.fingerprint,
        sourceLanguage: meta.manifest.sourceLanguage,
        targetLanguage: meta.manifest.targetLanguage
      }
    };
  }

  return {
    lookup,
    clearCache() {
      cache.clear();
    },
    stats() {
      return {
        metadataLoaded: Boolean(metadataPromise),
        cache: cache.stats()
      };
    }
  };
}

export class TflexReaderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TflexReaderError";
    this.code = code;
    this.packId = details.packId || "";
    this.path = details.path || "";
    if (details.cause) this.cause = details.cause;
  }
}

async function loadMetadata({ base, readBytes, cryptoProvider, readerVersion }) {
  const manifestBytes = await safeRead(readBytes, joinPackPath(base, "manifest.json"), "");
  const manifest = parseJson(manifestBytes, "manifest.json");
  validateManifest(manifest, readerVersion);

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
  await verifyDescriptor(directoryDescriptor, directoryBytes, cryptoProvider, manifest.packId);
  const directory = parseJson(directoryBytes, directoryDescriptor.path);
  validateDirectory(directory, manifest);

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
  await verifyDescriptor(descriptor, bytes, cryptoProvider, meta.manifest.packId);
  const text = new TextDecoder().decode(bytes);
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length !== shard.count) {
    throw corrupt(meta.manifest.packId, shard.path, "TFLex shard record count mismatch");
  }

  const records = new Map();
  let firstKey = "";
  let lastKey = "";
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw corrupt(meta.manifest.packId, shard.path, "Malformed TFLex record JSON", error);
    }
    validateRecord(record, meta.manifest.packId, shard.path);
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

function validateManifest(manifest, readerVersion) {
  if (!manifest || manifest.format !== "tflex" || manifest.formatVersion !== 1) {
    throw incompatible("", "manifest.json", "Unsupported TFLex format");
  }
  if (!Number.isSafeInteger(manifest.readerMinVersion) || manifest.readerMinVersion > readerVersion) {
    throw incompatible(manifest.packId, "manifest.json", "TFLex reader version is too old");
  }
  if (manifest.normalizationVersion !== 1 || manifest.profile !== "bundled-sharded-v1") {
    throw incompatible(manifest.packId, "manifest.json", "Unsupported TFLex normalization/profile");
  }
  if (manifest.sourceLanguage !== "en" || manifest.targetLanguage !== "zh-CN") {
    throw incompatible(manifest.packId, "manifest.json", "Unsupported TFLex language pair");
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) {
    throw corrupt(manifest.packId, "manifest.json", "TFLex file descriptors are missing");
  }
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !isSafePackPath(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(file.sha256)
    ) {
      throw corrupt(manifest.packId, "manifest.json", "Malformed TFLex file descriptor");
    }
  }
}

function validateDirectory(directory, manifest) {
  if (
    !directory ||
    directory.format !== "tflex-directory" ||
    directory.formatVersion !== manifest.formatVersion ||
    directory.normalizationVersion !== manifest.normalizationVersion ||
    !Array.isArray(directory.shards)
  ) {
    throw corrupt(manifest.packId, "directory.json", "Malformed TFLex directory");
  }

  let previousLast = null;
  const seen = new Set();
  for (const shard of directory.shards) {
    if (
      !shard ||
      typeof shard.path !== "string" ||
      !isSafePackPath(shard.path) ||
      typeof shard.firstKey !== "string" ||
      typeof shard.lastKey !== "string" ||
      !Number.isSafeInteger(shard.count) ||
      shard.count <= 0 ||
      !Number.isSafeInteger(shard.size) ||
      shard.size <= 0 ||
      typeof shard.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(shard.sha256)
    ) {
      throw corrupt(manifest.packId, "directory.json", "Malformed TFLex shard descriptor");
    }
    if (seen.has(shard.path)) throw corrupt(manifest.packId, shard.path, "Duplicate TFLex shard path");
    if (shard.firstKey > shard.lastKey || (previousLast !== null && previousLast >= shard.firstKey)) {
      throw corrupt(manifest.packId, shard.path, "TFLex shard ranges overlap or are unordered");
    }
    seen.add(shard.path);
    previousLast = shard.lastKey;
  }
}

function validateRecord(record, packId, path) {
  if (
    !record ||
    typeof record.lookupKey !== "string" ||
    normalizeLexicalKey(record.lookupKey) !== record.lookupKey ||
    typeof record.displayForm !== "string" ||
    !record.displayForm ||
    !Array.isArray(record.senses) ||
    !record.senses.length
  ) {
    throw corrupt(packId, path, "Malformed TFLex lexical record");
  }
  for (const sense of record.senses) {
    if (
      !sense ||
      typeof sense.id !== "string" ||
      !sense.id ||
      !Array.isArray(sense.translations) ||
      !sense.translations.length ||
      !Array.isArray(sense.sourceRefs) ||
      !sense.sourceRefs.length
    ) {
      throw corrupt(packId, path, "Malformed TFLex lexical sense");
    }
  }
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

async function verifyDescriptor(descriptor, bytes, cryptoProvider, packId) {
  if (bytes.byteLength !== descriptor.size) {
    throw corrupt(packId, descriptor.path, "TFLex file size mismatch");
  }
  const actual = await sha256Hex(bytes, cryptoProvider);
  if (actual !== descriptor.sha256.toLowerCase()) {
    throw corrupt(packId, descriptor.path, "TFLex file hash mismatch");
  }
}

async function sha256Hex(bytes, cryptoProvider) {
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
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

function corrupt(packId, path, message, cause) {
  return new TflexReaderError(LEXICAL_ERROR_CODES.CORRUPT, message, { packId, path, cause });
}

function incompatible(packId, path, message) {
  return new TflexReaderError(LEXICAL_ERROR_CODES.INCOMPATIBLE, message, { packId, path });
}

function normalizeBasePath(value) {
  const base = String(value || "").replace(/^\/+|\/+$/g, "");
  if (!base || !isSafePackPath(base)) throw new Error("packBasePath must be a safe relative path");
  return base;
}

function joinPackPath(base, path) {
  if (!isSafePackPath(path)) throw new Error("unsafe TFLex relative path");
  return base + "/" + path;
}

function isSafePackPath(path) {
  return Boolean(path) &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => !part || part === "." || part === "..");
}
