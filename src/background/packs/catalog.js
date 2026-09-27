import {
  PACK_CATALOG_SCHEMA,
  PACK_CATALOG_SCHEMA_VERSION,
  PACK_ERROR_CODES,
  PACK_LIMITS,
  PACK_READER_VERSION,
  isSafePackIdentifier,
  isSafePackPath,
  packError
} from "../../shared/pack-manager.js";

const ALLOWED_FILE_ROLES = new Set(["manifest", "lookup-index", "lexical-data", "notice"]);
const EXECUTABLE_EXTENSION = /\.(?:html?|mjs|cjs|js|css|wasm)$/i;

export async function verifyTrustedCatalog({
  catalogBytes,
  signatureBytes,
  source,
  highestSequence = 0,
  readerVersion = PACK_READER_VERSION,
  cryptoProvider = globalThis.crypto
} = {}) {
  const trusted = validateTrustedSource(source);
  const catalogData = toBytes(catalogBytes);
  const signatureData = decodeSignature(signatureBytes);

  if (!cryptoProvider?.subtle) {
    throw packError(PACK_ERROR_CODES.CATALOG_SIGNATURE, "WebCrypto is unavailable for catalog verification.");
  }

  let key;
  try {
    key = await cryptoProvider.subtle.importKey(
      "jwk",
      trusted.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  } catch (error) {
    throw packError(PACK_ERROR_CODES.CATALOG_SIGNATURE, "Catalog trust root cannot be imported.", { cause: error });
  }

  const valid = await cryptoProvider.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signatureData,
    catalogData
  );
  if (!valid) {
    throw packError(PACK_ERROR_CODES.CATALOG_SIGNATURE, "Dictionary catalog signature is invalid.");
  }

  let catalog;
  try {
    catalog = JSON.parse(new TextDecoder().decode(catalogData));
  } catch (error) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Signed dictionary catalog is not valid JSON.", { cause: error });
  }

  return validateCatalog(catalog, {
    source: trusted,
    highestSequence,
    readerVersion
  });
}

export function validateTrustedSource(source) {
  if (!source || !isSafePackIdentifier(source.id)) {
    throw packError(PACK_ERROR_CODES.UNTRUSTED_SOURCE, "Unknown dictionary pack source.");
  }
  if (!source.keyId || !source.publicKeyJwk || typeof source.publicKeyJwk !== "object") {
    throw packError(PACK_ERROR_CODES.UNTRUSTED_SOURCE, "Dictionary source has no extension-pinned trust root.");
  }
  if (!Number.isSafeInteger(source.minimumSequence) || source.minimumSequence < 0) {
    throw packError(PACK_ERROR_CODES.UNTRUSTED_SOURCE, "Dictionary source minimum catalog sequence is invalid.");
  }

  const catalogUrl = trustedUrl(source.catalogUrl, source);
  const signatureUrl = trustedUrl(source.signatureUrl, source);
  const downloadBaseUrl = trustedUrl(source.downloadBaseUrl, source);
  if (catalogUrl.origin !== signatureUrl.origin || catalogUrl.origin !== downloadBaseUrl.origin) {
    throw packError(PACK_ERROR_CODES.UNTRUSTED_SOURCE, "Dictionary source endpoints must share one trusted origin.");
  }

  const originPattern = catalogUrl.origin + "/*";
  if (source.originPattern !== originPattern) {
    throw packError(PACK_ERROR_CODES.UNTRUSTED_SOURCE, "Dictionary source origin permission does not match its endpoints.");
  }

  const packs = Array.isArray(source.packs) ? source.packs : [];
  const packIds = new Set();
  for (const item of packs) {
    if (!item || !isSafePackIdentifier(item.packId) || packIds.has(item.packId)) {
      throw packError(PACK_ERROR_CODES.UNTRUSTED_SOURCE, "Dictionary source pack declaration is invalid.");
    }
    packIds.add(item.packId);
  }

  return Object.freeze({
    ...source,
    catalogUrl: catalogUrl.href,
    signatureUrl: signatureUrl.href,
    downloadBaseUrl: downloadBaseUrl.href,
    declaredPackIds: Object.freeze([...packIds])
  });
}

export function validateCatalog(catalog, {
  source,
  highestSequence = 0,
  readerVersion = PACK_READER_VERSION
} = {}) {
  if (
    !catalog ||
    catalog.schema !== PACK_CATALOG_SCHEMA ||
    catalog.schemaVersion !== PACK_CATALOG_SCHEMA_VERSION ||
    catalog.sourceId !== source.id ||
    !Number.isSafeInteger(catalog.sequence) ||
    catalog.sequence < source.minimumSequence
  ) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary catalog schema/source/sequence is invalid.");
  }
  if (catalog.sequence < Number(highestSequence || 0)) {
    throw packError(PACK_ERROR_CODES.CATALOG_REPLAY, "Dictionary catalog replay/downgrade was rejected.", {
      sequence: catalog.sequence,
      highestSequence: Number(highestSequence || 0)
    });
  }

  const packs = Array.isArray(catalog.packs) ? catalog.packs : [];
  if (!packs.length || packs.length > 32) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary catalog pack list is invalid.");
  }

  const seen = new Set();
  const normalizedPacks = packs.map((pack) => {
    const normalized = validateCatalogPack(pack, { source, readerVersion });
    if (seen.has(normalized.packId)) {
      throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary catalog contains duplicate pack IDs.");
    }
    seen.add(normalized.packId);
    return normalized;
  });

  return Object.freeze({
    schema: PACK_CATALOG_SCHEMA,
    schemaVersion: PACK_CATALOG_SCHEMA_VERSION,
    sourceId: source.id,
    sequence: catalog.sequence,
    packs: Object.freeze(normalizedPacks)
  });
}

export function resolvePackDownloadUrl(source, descriptor) {
  if (!isSafePackPath(descriptor?.downloadPath)) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary file download path is unsafe.");
  }
  const url = new URL(descriptor.downloadPath, source.downloadBaseUrl);
  const base = new URL(source.downloadBaseUrl);
  if (url.origin !== base.origin) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary file escaped the trusted download origin.");
  }
  return url.href;
}

function validateCatalogPack(pack, { source, readerVersion }) {
  if (
    !pack ||
    !isSafePackIdentifier(pack.packId) ||
    !isSafePackIdentifier(pack.packVersion, PACK_LIMITS.versionChars) ||
    !source.declaredPackIds.includes(pack.packId) ||
    !Number.isSafeInteger(pack.releaseSequence) ||
    pack.releaseSequence <= 0 ||
    pack.format !== "tflex" ||
    pack.formatVersion !== 1 ||
    pack.normalizationVersion !== 1 ||
    pack.profile !== "opfs-indexed-v1" ||
    !Number.isSafeInteger(pack.readerMinVersion) ||
    pack.readerMinVersion <= 0 ||
    pack.readerMinVersion > readerVersion ||
    pack.sourceLanguage !== "en" ||
    pack.targetLanguage !== "zh-CN" ||
    typeof pack.fingerprint !== "string" ||
    !/^sha256:[a-f0-9]{64}$/i.test(pack.fingerprint)
  ) {
    throw packError(PACK_ERROR_CODES.INCOMPATIBLE, "Dictionary pack metadata is incompatible with this reader.");
  }

  const files = Array.isArray(pack.files) ? pack.files : [];
  if (!files.length || files.length > PACK_LIMITS.fileCount) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary pack file list is invalid.");
  }

  let totalBytes = 0;
  const paths = new Set();
  const normalizedFiles = files.map((file) => {
    const normalized = validateCatalogFile(file);
    if (paths.has(normalized.path)) {
      throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary pack contains duplicate file paths.");
    }
    paths.add(normalized.path);
    totalBytes += normalized.size;
    return normalized;
  });

  if (
    !Number.isSafeInteger(pack.totalBytes) ||
    pack.totalBytes !== totalBytes ||
    totalBytes > PACK_LIMITS.totalBytes
  ) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary pack total byte size is invalid.");
  }

  requireRolePath(normalizedFiles, "manifest", "manifest.json");
  requireRolePath(normalizedFiles, "lookup-index", "index.dat");
  requireRolePath(normalizedFiles, "lexical-data", "entries.dat");

  return Object.freeze({
    packId: pack.packId,
    packVersion: pack.packVersion,
    releaseSequence: pack.releaseSequence,
    format: "tflex",
    formatVersion: 1,
    readerMinVersion: pack.readerMinVersion,
    normalizationVersion: 1,
    profile: "opfs-indexed-v1",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    fingerprint: pack.fingerprint.toLowerCase(),
    totalBytes,
    files: Object.freeze(normalizedFiles)
  });
}

function validateCatalogFile(file) {
  if (
    !file ||
    !ALLOWED_FILE_ROLES.has(file.role) ||
    !isSafePackPath(file.path) ||
    !isSafePackPath(file.downloadPath) ||
    EXECUTABLE_EXTENSION.test(file.path) ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > PACK_LIMITS.fileBytes ||
    typeof file.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(file.sha256)
  ) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary pack file descriptor is invalid.");
  }
  if (file.role === "notice" && !/\.txt$/i.test(file.path)) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary notice files must be plain text.");
  }
  return Object.freeze({
    role: file.role,
    path: file.path,
    downloadPath: file.downloadPath,
    size: file.size,
    sha256: file.sha256.toLowerCase()
  });
}

function requireRolePath(files, role, path) {
  const matches = files.filter((file) => file.role === role);
  if (matches.length !== 1 || matches[0].path !== path) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, `Dictionary pack requires exactly one ${path} ${role} file.`);
  }
}

function decodeSignature(value) {
  const bytes = toBytes(value);
  if (bytes.byteLength > PACK_LIMITS.signatureBytes) {
    throw packError(PACK_ERROR_CODES.CATALOG_SIGNATURE, "Dictionary catalog signature is oversized.");
  }
  const text = new TextDecoder().decode(bytes).trim();
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch (error) {
    throw packError(PACK_ERROR_CODES.CATALOG_SIGNATURE, "Dictionary catalog signature is not valid base64.", { cause: error });
  }
}

function toBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  if (!bytes.byteLength || bytes.byteLength > PACK_LIMITS.catalogBytes) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Dictionary catalog bytes are empty or oversized.");
  }
  return bytes;
}

function trustedUrl(value, source) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (error) {
    throw packError(PACK_ERROR_CODES.UNTRUSTED_SOURCE, "Dictionary source URL is invalid.", { cause: error });
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(source.allowInsecureLocalhost === true && local && url.protocol === "http:")) {
    throw packError(PACK_ERROR_CODES.UNTRUSTED_SOURCE, "Dictionary source must use HTTPS.");
  }
  if (url.username || url.password || url.hash) {
    throw packError(PACK_ERROR_CODES.UNTRUSTED_SOURCE, "Dictionary source URL contains forbidden components.");
  }
  return url;
}
