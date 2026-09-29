import {
  PACK_ERROR_CODES,
  PACK_READER_VERSION,
  packError
} from "../../shared/pack-manager.js";

export async function inspectInstalledPack({
  store,
  snapshot,
  cryptoProvider = globalThis.crypto,
  readerVersion = PACK_READER_VERSION
} = {}) {
  if (!snapshot?.packId || !snapshot?.packVersion || !Array.isArray(snapshot.files)) {
    return { status: "corrupt", reason: "metadata" };
  }

  for (const descriptor of snapshot.files) {
    let bytes;
    try {
      bytes = await store.readFile(snapshot.packId, snapshot.packVersion, descriptor.path);
    } catch (error) {
      if (error?.missing) {
        return { status: "missing", path: descriptor.path };
      }
      return { status: "storage-error", path: descriptor.path, error };
    }
    if (bytes.byteLength !== descriptor.size) {
      return { status: "corrupt", path: descriptor.path, reason: "size" };
    }
    const actual = await sha256Hex(bytes, cryptoProvider);
    if (actual !== descriptor.sha256) {
      return { status: "corrupt", path: descriptor.path, reason: "hash", actualSha256: actual };
    }
  }

  try {
    await validateInstalledManifest({ store, snapshot, readerVersion });
  } catch (error) {
    return { status: "corrupt", path: "manifest.json", reason: "manifest", error };
  }
  return { status: "healthy" };
}

export async function validateInstalledManifest({
  store,
  snapshot,
  readerVersion = PACK_READER_VERSION
} = {}) {
  const descriptor = snapshot.files.find((file) => file.role === "manifest" && file.path === "manifest.json");
  if (!descriptor) throw packError(PACK_ERROR_CODES.CORRUPT, "Installed pack has no manifest descriptor.");

  let manifest;
  try {
    const bytes = await store.readFile(snapshot.packId, snapshot.packVersion, descriptor.path);
    manifest = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error?.code) throw error;
    throw packError(PACK_ERROR_CODES.CORRUPT, "Installed dictionary manifest is not valid JSON.", { cause: error });
  }
  return validateInstalledManifestValue({ manifest, snapshot, readerVersion });
}

export function validateInstalledManifestValue({
  manifest,
  snapshot,
  readerVersion = PACK_READER_VERSION
} = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Installed dictionary manifest must be an object.");
  }
  if (!snapshot || !Array.isArray(snapshot.files)) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Installed dictionary snapshot metadata is malformed.");
  }
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
    manifest.targetLanguage !== "zh-CN" ||
    manifest.fingerprint !== snapshot.fingerprint
  ) {
    throw packError(PACK_ERROR_CODES.INCOMPATIBLE, "Installed dictionary manifest is incompatible.");
  }

  if (!Array.isArray(manifest.sources) || !manifest.sources.length) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Installed dictionary manifest has no source provenance.");
  }
  for (const source of manifest.sources) {
    if (!source?.id || !source?.version || !source?.provenance || !source?.license?.id) {
      throw packError(PACK_ERROR_CODES.CORRUPT, "Installed dictionary source provenance is malformed.");
    }
  }

  const expected = snapshot.files
    .filter((file) => file.role === "lookup-index" || file.role === "lexical-data")
    .map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }))
    .sort(compareDescriptor);
  const actual = (Array.isArray(manifest.files) ? manifest.files : [])
    .map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }))
    .sort(compareDescriptor);

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw packError(PACK_ERROR_CODES.CORRUPT, "Installed dictionary manifest file descriptors do not match signed catalog metadata.");
  }
  return manifest;
}

export async function verifyDownloadedFile(descriptor, bytes, cryptoProvider = globalThis.crypto) {
  if (bytes.byteLength !== descriptor.size) {
    throw packError(PACK_ERROR_CODES.HASH, "Dictionary file size failed verification.", {
      path: descriptor.path,
      expectedSize: descriptor.size,
      actualSize: bytes.byteLength
    });
  }
  const actual = await sha256Hex(bytes, cryptoProvider);
  if (actual !== descriptor.sha256) {
    throw packError(PACK_ERROR_CODES.HASH, "Dictionary file SHA-256 failed verification.", {
      path: descriptor.path,
      expectedSha256: descriptor.sha256,
      actualSha256: actual
    });
  }
}

async function sha256Hex(bytes, cryptoProvider) {
  if (!cryptoProvider?.subtle) {
    throw packError(PACK_ERROR_CODES.HASH, "WebCrypto is unavailable for dictionary integrity verification.");
  }
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function compareDescriptor(a, b) {
  return String(a.path).localeCompare(String(b.path), "en") || String(a.role).localeCompare(String(b.role), "en");
}
