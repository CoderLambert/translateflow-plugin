import {
  LEXICAL_ERROR_CODES,
  normalizeLexicalKey
} from "../../shared/lexical.js";

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

export function corrupt(packId, path, message, cause) {
  return new TflexReaderError(LEXICAL_ERROR_CODES.CORRUPT, message, { packId, path, cause });
}

export function incompatible(packId, path, message) {
  return new TflexReaderError(LEXICAL_ERROR_CODES.INCOMPATIBLE, message, { packId, path });
}

export function validateTflexManifest(manifest, readerVersion) {
  if (!manifest || manifest.format !== "tflex" || manifest.formatVersion !== 1) {
    throw incompatible("", "manifest.json", "Unsupported TFLex format");
  }
  if (!Number.isSafeInteger(manifest.readerMinVersion) || manifest.readerMinVersion > readerVersion) {
    throw incompatible(manifest.packId, "manifest.json", "TFLex reader version is too old");
  }
  if (manifest.normalizationVersion !== 1 || manifest.profile !== "bundled-sharded-v1") {
    throw incompatible(manifest.packId, "manifest.json", "Unsupported TFLex normalization/profile");
  }
  if (!Number.isSafeInteger(manifest.profileOptions?.maxShardBytes) || manifest.profileOptions.maxShardBytes <= 0) {
    throw corrupt(manifest.packId, "manifest.json", "Invalid TFLex shard budget");
  }
  if (!Number.isSafeInteger(manifest.recordCount) || manifest.recordCount <= 0) {
    throw corrupt(manifest.packId, "manifest.json", "Invalid TFLex record count");
  }
  if (manifest.sourceLanguage !== "en" || manifest.targetLanguage !== "zh-CN") {
    throw incompatible(manifest.packId, "manifest.json", "Unsupported TFLex language pair");
  }
  if (!Array.isArray(manifest.sources) || !manifest.sources.length) {
    throw corrupt(manifest.packId, "manifest.json", "TFLex source metadata is missing");
  }
  for (const source of manifest.sources) {
    if (!source?.id || !source?.version || !source?.provenance || !source?.license?.id) {
      throw corrupt(manifest.packId, "manifest.json", "Malformed TFLex source provenance");
    }
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) {
    throw corrupt(manifest.packId, "manifest.json", "TFLex file descriptors are missing");
  }
  for (const file of manifest.files) validateFileDescriptor(file, manifest.packId);
}

export function validateTflexDirectory(directory, manifest) {
  if (
    !directory ||
    directory.format !== "tflex-directory" ||
    directory.formatVersion !== manifest.formatVersion ||
    directory.normalizationVersion !== manifest.normalizationVersion ||
    !Array.isArray(directory.shards) ||
    !directory.shards.length
  ) {
    throw corrupt(manifest.packId, "directory.json", "Malformed TFLex directory");
  }

  let previousLast = null;
  let totalRecords = 0;
  const seen = new Set();
  for (const shard of directory.shards) {
    validateShardDescriptor(shard, manifest);
    if (seen.has(shard.path)) throw corrupt(manifest.packId, shard.path, "Duplicate TFLex shard path");
    if (shard.firstKey > shard.lastKey || (previousLast !== null && previousLast >= shard.firstKey)) {
      throw corrupt(manifest.packId, shard.path, "TFLex shard ranges overlap or are unordered");
    }
    seen.add(shard.path);
    previousLast = shard.lastKey;
    totalRecords += shard.count;
  }
  if (totalRecords !== manifest.recordCount) {
    throw corrupt(manifest.packId, "directory.json", "TFLex directory record count mismatch");
  }
}

export function validateTflexRecord(record, packId, path) {
  if (
    !record ||
    typeof record.lookupKey !== "string" ||
    normalizeLexicalKey(record.lookupKey) !== record.lookupKey ||
    typeof record.displayForm !== "string" ||
    !record.displayForm ||
    !["lexical", "technical-concept", "technical-entity"].includes(record.kind)
  ) {
    throw corrupt(packId, path, "Malformed TFLex record");
  }

  const senses = Array.isArray(record.senses) ? record.senses : [];
  const directTranslations = Array.isArray(record.translations) ? record.translations : [];
  if (!senses.length && !directTranslations.length) {
    throw corrupt(packId, path, "TFLex record has no lexical content");
  }
  for (const translation of directTranslations) {
    if (typeof translation !== "string" || !translation) {
      throw corrupt(packId, path, "Malformed TFLex translation");
    }
  }
  if (directTranslations.length) validateSourceRefs(record.sourceRefs, packId, path);

  for (const sense of senses) {
    if (
      !sense ||
      typeof sense.id !== "string" ||
      !sense.id ||
      !Array.isArray(sense.translations) ||
      !sense.translations.length
    ) {
      throw corrupt(packId, path, "Malformed TFLex lexical sense");
    }
    validateSourceRefs(sense.sourceRefs, packId, path);
  }
}

export async function verifyTflexManifestFingerprint(manifest, cryptoProvider) {
  if (typeof manifest.fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(manifest.fingerprint)) {
    throw corrupt(manifest.packId, "manifest.json", "Malformed TFLex fingerprint");
  }
  const payload = {
    formatVersion: manifest.formatVersion,
    normalizationVersion: manifest.normalizationVersion,
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    profile: manifest.profile,
    profileOptions: { maxShardBytes: manifest.profileOptions.maxShardBytes },
    sources: [...manifest.sources]
      .sort((a, b) => compareText(a?.id, b?.id))
      .map((source) => ({
        id: source.id,
        version: source.version,
        provenance: source.provenance,
        dataSha256: source.dataSha256,
        licenseId: source.license?.id
      })),
    files: [...manifest.files]
      .sort((a, b) => compareText(a.path, b.path) || compareText(a.role, b.role))
      .map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }))
  };
  const actual = "sha256:" + await sha256Hex(
    new TextEncoder().encode(stableStringify(payload)),
    cryptoProvider
  );
  if (actual !== manifest.fingerprint.toLowerCase()) {
    throw corrupt(manifest.packId, "manifest.json", "TFLex manifest fingerprint mismatch");
  }
}

export async function verifyTflexDescriptor(descriptor, bytes, cryptoProvider, packId) {
  if (bytes.byteLength !== descriptor.size) {
    throw corrupt(packId, descriptor.path, "TFLex file size mismatch");
  }
  const actual = await sha256Hex(bytes, cryptoProvider);
  if (actual !== descriptor.sha256.toLowerCase()) {
    throw corrupt(packId, descriptor.path, "TFLex file hash mismatch");
  }
}

export function isSafeTflexPackPath(path) {
  return Boolean(path) &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => !part || part === "." || part === "..");
}

function validateFileDescriptor(file, packId) {
  if (
    !file ||
    typeof file.path !== "string" ||
    !isSafeTflexPackPath(file.path) ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    typeof file.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(file.sha256)
  ) {
    throw corrupt(packId, "manifest.json", "Malformed TFLex file descriptor");
  }
}

function validateShardDescriptor(shard, manifest) {
  if (
    !shard ||
    typeof shard.path !== "string" ||
    !isSafeTflexPackPath(shard.path) ||
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
  if (shard.size > manifest.profileOptions.maxShardBytes) {
    throw corrupt(manifest.packId, shard.path, "TFLex shard exceeds declared cache/read budget");
  }
}

function validateSourceRefs(refs, packId, path) {
  if (!Array.isArray(refs) || !refs.length) throw corrupt(packId, path, "TFLex sourceRefs are required");
  for (const ref of refs) {
    if (
      !ref ||
      typeof ref.sourceId !== "string" ||
      !ref.sourceId ||
      typeof ref.recordId !== "string" ||
      !ref.recordId
    ) {
      throw corrupt(packId, path, "Malformed TFLex sourceRef");
    }
  }
}

async function sha256Hex(bytes, cryptoProvider) {
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
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

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}
