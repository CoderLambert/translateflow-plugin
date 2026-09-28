import {
  PACK_ERROR_CODES,
  isSafePackIdentifier,
  isSafePackPath,
  packError
} from "../../shared/pack-manager.js";

const ROOT_DIR = "dictionaries";

export function createOpfsPackStore({
  rootProvider = () => navigator.storage.getDirectory()
} = {}) {
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

  async function readFileSlice(packId, version, path, offset, length) {
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
      if (offset + length > file.size) {
        throw packError(PACK_ERROR_CODES.CORRUPT, "Dictionary pack byte range exceeds file size.", {
          packId, version, path, offset, length, fileSize: file.size
        });
      }
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    } catch (error) {
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
    return root.getDirectoryHandle(ROOT_DIR, { create });
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
    readFileSlice,
    listPacks,
    listVersions,
    removeVersion,
    removePack,
    cleanupPack
  });
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
