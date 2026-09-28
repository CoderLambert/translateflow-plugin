import {
  PACK_ERROR_CODES,
  PACK_LIMITS,
  packError
} from "../../shared/pack-manager.js";
import { resolvePackDownloadUrl } from "../packs/catalog.js";

export async function fetchTrustedPackCatalog(source, { signal } = {}) {
  const [catalogBytes, signatureBytes] = await Promise.all([
    fetchBounded(source.catalogUrl, PACK_LIMITS.catalogBytes, { signal, label: "catalog" }),
    fetchBounded(source.signatureUrl, PACK_LIMITS.signatureBytes, { signal, label: "catalog signature" })
  ]);
  return { catalogBytes, signatureBytes };
}

export async function fetchTrustedPackFile(source, descriptor, { signal } = {}) {
  const url = resolvePackDownloadUrl(source, descriptor);
  const bytes = await fetchBounded(url, Math.min(PACK_LIMITS.fileBytes, descriptor.size), {
    signal,
    label: descriptor.path
  });
  if (bytes.byteLength !== descriptor.size) {
    throw packError(PACK_ERROR_CODES.DOWNLOAD, "Downloaded dictionary file size does not match signed metadata.", {
      path: descriptor.path,
      expectedSize: descriptor.size,
      actualSize: bytes.byteLength
    });
  }
  return bytes;
}

async function fetchBounded(url, maxBytes, { signal, label }) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw packError(PACK_ERROR_CODES.DOWNLOAD, `Unable to download dictionary ${label}.`, {
      url,
      cause: error
    });
  }

  if (!response.ok) {
    throw packError(PACK_ERROR_CODES.DOWNLOAD, `Dictionary ${label} download failed with HTTP ${response.status}.`, {
      url,
      status: response.status
    });
  }

  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw packError(PACK_ERROR_CODES.DOWNLOAD, `Dictionary ${label} exceeds the allowed size.`, {
      url,
      declared,
      maxBytes
    });
  }

  return readBoundedBody(response, maxBytes, { url, label });
}

async function readBoundedBody(response, maxBytes, { url, label }) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return validateBoundedBytes(bytes, maxBytes, { url, label });
  }

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
      if (!chunk.byteLength) continue;
      total += chunk.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel("dictionary response exceeds signed size limit"); } catch {}
        throw packError(PACK_ERROR_CODES.DOWNLOAD, `Dictionary ${label} is empty or oversized.`, {
          url,
          actualSize: total,
          maxBytes
        });
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error?.code === PACK_ERROR_CODES.DOWNLOAD || error?.name === "AbortError") throw error;
    throw packError(PACK_ERROR_CODES.DOWNLOAD, `Unable to read dictionary ${label} response.`, {
      url,
      cause: error
    });
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  if (!total) {
    throw packError(PACK_ERROR_CODES.DOWNLOAD, `Dictionary ${label} is empty or oversized.`, {
      url,
      actualSize: 0,
      maxBytes
    });
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validateBoundedBytes(bytes, maxBytes, { url, label }) {
  if (!bytes.byteLength || bytes.byteLength > maxBytes) {
    throw packError(PACK_ERROR_CODES.DOWNLOAD, `Dictionary ${label} is empty or oversized.`, {
      url,
      actualSize: bytes.byteLength,
      maxBytes
    });
  }
  return bytes;
}
