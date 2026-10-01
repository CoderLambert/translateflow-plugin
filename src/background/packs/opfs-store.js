import {
  PACK_ERROR_CODES,
  isSafePackIdentifier,
  isSafePackPath,
  packError
} from "../../shared/pack-manager.js";

const DEFAULT_ROOT_DIR = "dictionaries";

export function createOpfsPackStore({
  rootProvider = () => navigator.storage.getDirectory(),
  rootDir = DEFAULT_ROOT_DIR
} = {}) {
  if (!isSafePackIdentifier(rootDir, 80)) {
    throw packError(PACK_ERROR_CODES.STORAGE, "Unsafe dictionary pack root directory.");
  }

  async function writeFile(packId, version, path, bytes) {
    validateLocation(packId, version, path);
    try {
      const versionDir = await getVersionDir(packId, version, true);
      const { directory, name } = await descendToParent(versionDir, path, true);
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (error) {
        await writable.abort?.().catch?.(() => {});
        throw error;
      }
    } catch (error) {
      throw storageError("Unable to write dictionary pack file.", { packId, version, path, cause: error });
    }
  }

  async function readFile(packId, version, path) {
    validateLocation(packId, version, path);
    try {
      const versionDir = await getVersionDir(packId, version, false);
      const { directory, name } = await descendToParent(versionDir, path, false);
      const handle = await directory.getFileHandle(name);
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      throw storageError("Unable to read dictionary pack file.", {
        packId,
        version,
        path,
        missing: error?.name === "NotFoundError",
        cause: error
      });
    }
  }

  async function getFileSize(packId, version, path) {
    validateLocation(packId, version, path);
    try {
      const versionDir = await getVersionDir(packId, version, false);
      const { directory, name } = await descendToParent(versionDir, path, false);
      const handle = await directory.getFileHandle(name);
      const file = await handle.getFile();
      return file.size;
    } catch (error) {
      throw storageError("Unable to inspect dictionary pack file.", {
        packId,
        version,
        path,
        missing: error?.name === "NotFoundError",
        cause: error
      });
    }
  }

  async function readFileRange(packId, version, path, offset, length, signal) {
    throwIfAborted(signal);
    validateLocation(packId, version, path);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length <= 0
    ) {
      throw packError(PACK_ERROR_CODES.STORAGE, "Invalid dictionary pack byte range.");
    }
    try {
      const versionDir = await getVersionDir(packId, version, false);
      const { directory, name } = await descendToParent(versionDir, path, false);
      const handle = await directory.getFileHandle(name);
      const file = await handle.getFile();
      if (offset > file.size || length > file.size - offset) {
        throw packError(PACK_ERROR_CODES.STORAGE, "Dictionary pack byte range exceeds the file.", {
          packId, version, path, offset, length, fileBytes: file.size
        });
      }
      const range = file.slice(offset, offset + length);
      if (!signal) return new Uint8Array(await range.arrayBuffer());
      return await readBlobRange(range, length, signal);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw storageError("Unable to read dictionary pack byte range.", {
        packId,
        version,
        path,
        offset,
        length,
        missing: error?.name === "NotFoundError",
        cause: error
      });
    }
  }

  async function listPacks() {
    try {
      const dictionaries = await getDictionariesDir(false);
      const packs = [];
      for await (const [name, handle] of dictionaries.entries()) {
        if (handle.kind === "directory" && isSafePackIdentifier(name)) packs.push(name);
      }
      return packs.sort(compareText);
    } catch (error) {
      if (error?.name === "NotFoundError") return [];
      throw storageError("Unable to list dictionary packs.", { cause: error });
    }
  }

  async function listVersions(packId) {
    validatePackId(packId);
    try {
      const packDir = await getPackDir(packId, false);
      const versions = [];
      for await (const [name, handle] of packDir.entries()) {
        if (handle.kind === "directory" && isSafePackIdentifier(name, 120)) versions.push(name);
      }
      return versions.sort(compareText);
    } catch (error) {
      if (error?.name === "NotFoundError") return [];
      throw storageError("Unable to list dictionary pack versions.", { packId, cause: error });
    }
  }

  async function removeVersion(packId, version) {
    validateLocation(packId, version);
    try {
      const packDir = await getPackDir(packId, false);
      await packDir.removeEntry(version, { recursive: true });
      return true;
    } catch (error) {
      if (error?.name === "NotFoundError") return false;
      throw storageError("Unable to remove dictionary pack version.", { packId, version, cause: error });
    }
  }

  async function removePack(packId) {
    validatePackId(packId);
    try {
      const dictionaries = await getDictionariesDir(false);
      await dictionaries.removeEntry(packId, { recursive: true });
      return true;
    } catch (error) {
      if (error?.name === "NotFoundError") return false;
      throw storageError("Unable to uninstall dictionary pack.", { packId, cause: error });
    }
  }

  async function cleanupPack(packId, keepVersions = []) {
    const keep = new Set((Array.isArray(keepVersions) ? keepVersions : []).map(String));
    const versions = await listVersions(packId);
    const removed = [];
    for (const version of versions) {
      if (keep.has(version)) continue;
      if (await removeVersion(packId, version)) removed.push(version);
    }
    return removed;
  }

  async function getDictionariesDir(create) {
    const root = await rootProvider();
    return root.getDirectoryHandle(rootDir, { create });
  }

  async function getPackDir(packId, create) {
    const dictionaries = await getDictionariesDir(create);
    return dictionaries.getDirectoryHandle(packId, { create });
  }

  async function getVersionDir(packId, version, create) {
    const packDir = await getPackDir(packId, create);
    return packDir.getDirectoryHandle(version, { create });
  }

  return Object.freeze({
    writeFile,
    readFile,
    getFileSize,
    readFileRange,
    listPacks,
    listVersions,
    removeVersion,
    removePack,
    cleanupPack
  });
}

async function readBlobRange(blob, expectedBytes, signal) {
  throwIfAborted(signal);
  if (typeof blob.stream !== "function") {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    throwIfAborted(signal);
    if (bytes.byteLength !== expectedBytes) throw new Error("Dictionary pack range size changed while reading.");
    return bytes;
  }

  const reader = blob.stream().getReader();
  const chunks = [];
  let total = 0;
  const cancel = () => { void reader.cancel(abortError()).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) break;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += bytes.byteLength;
      if (total > expectedBytes) throw new Error("Dictionary pack range exceeded its requested size.");
      chunks.push(bytes);
    }
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock?.();
  }
  if (total !== expectedBytes) throw new Error("Dictionary pack range returned a short read.");
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    throwIfAborted(signal);
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function abortError() {
  return new DOMException("Dictionary pack range read cancelled.", "AbortError");
}

async function descendToParent(root, path, create) {
  const parts = path.split("/");
  const name = parts.pop();
  let directory = root;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create });
  }
  return { directory, name };
}

function validateLocation(packId, version, path) {
  validatePackId(packId);
  if (!isSafePackIdentifier(version, 120)) {
    throw packError(PACK_ERROR_CODES.STORAGE, "Unsafe dictionary pack version.");
  }
  if (path !== undefined && !isSafePackPath(path)) {
    throw packError(PACK_ERROR_CODES.STORAGE, "Unsafe dictionary pack file path.");
  }
}

function validatePackId(packId) {
  if (!isSafePackIdentifier(packId)) {
    throw packError(PACK_ERROR_CODES.STORAGE, "Unsafe dictionary pack ID.");
  }
}

function storageError(message, details) {
  if (details?.cause?.code && String(details.cause.code).startsWith("PACK_")) return details.cause;
  return packError(PACK_ERROR_CODES.STORAGE, message, details);
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), "en");
}
