import {
  PACK_ERROR_CODES,
  packError
} from "./pack-manager.js";
import {
  IMPORT_QUARANTINE_FILES,
  IMPORT_QUARANTINE_ROOT,
  assertImportQuarantineFileSize,
  assertImportQuarantinePath,
  assertImportQuarantineRange,
  assertImportQuarantineToken,
  assertImportQuarantineTotalBytes,
  isImportQuarantinePath,
  isSafeImportQuarantineToken,
  normalizeImportQuarantineBytes
} from "./import-quarantine-contract.js";

export function createOpfsImportQuarantine({
  rootProvider = () =>
    globalThis.navigator.storage.getDirectory()
} = {}) {
  if (typeof rootProvider !== "function") {
    throw new Error(
      "OPFS import quarantine requires a root provider."
    );
  }

  async function writeFile(token, path, input) {
    assertImportQuarantineToken(token);
    assertImportQuarantinePath(path);
    const bytes = normalizeImportQuarantineBytes(
      input,
      path
    );
    assertImportQuarantineFileSize(
      path,
      bytes.byteLength
    );

    try {
      const directory = await getTokenDir(token, true);
      const existing = await listFilesFromDirectory(
        token,
        directory
      );
      const current = existing.find(
        (item) => item.path === path
      );
      const nextTotal =
        existing.reduce(
          (sum, item) => sum + item.size,
          0
        ) -
        Number(current?.size || 0) +
        bytes.byteLength;
      assertImportQuarantineTotalBytes(nextTotal);

      const handle = await directory.getFileHandle(
        path,
        { create: true }
      );
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (error) {
        await writable.abort?.().catch?.(() => {});
        throw error;
      }
      return {
        path,
        size: bytes.byteLength
      };
    } catch (error) {
      throw storageError(
        "Unable to write import quarantine file.",
        { token, path, cause: error }
      );
    }
  }

  async function statFile(token, path) {
    assertImportQuarantineToken(token);
    assertImportQuarantinePath(path);
    try {
      const directory = await getTokenDir(token, false);
      const handle = await directory.getFileHandle(path);
      const file = await handle.getFile();
      assertImportQuarantineFileSize(
        path,
        file.size
      );
      return {
        path,
        size: file.size
      };
    } catch (error) {
      throw storageError(
        "Unable to inspect import quarantine file.",
        {
          token,
          path,
          missing: error?.name === "NotFoundError",
          cause: error
        }
      );
    }
  }

  async function readFileRange(
    token,
    path,
    offset,
    length
  ) {
    assertImportQuarantineToken(token);
    assertImportQuarantinePath(path);
    assertImportQuarantineRange(offset, length);

    try {
      const directory = await getTokenDir(token, false);
      const handle = await directory.getFileHandle(path);
      const file = await handle.getFile();
      assertImportQuarantineFileSize(
        path,
        file.size
      );
      if (
        offset > file.size ||
        length > file.size - offset
      ) {
        throw packError(
          PACK_ERROR_CODES.STORAGE,
          "Import quarantine byte range exceeds the file.",
          {
            token,
            path,
            offset,
            length,
            fileBytes: file.size
          }
        );
      }
      return new Uint8Array(
        await file.slice(
          offset,
          offset + length
        ).arrayBuffer()
      );
    } catch (error) {
      throw storageError(
        "Unable to read import quarantine byte range.",
        {
          token,
          path,
          offset,
          length,
          missing: error?.name === "NotFoundError",
          cause: error
        }
      );
    }
  }

  async function listFiles(token) {
    assertImportQuarantineToken(token);
    try {
      const directory = await getTokenDir(token, false);
      return listFilesFromDirectory(
        token,
        directory
      );
    } catch (error) {
      throw storageError(
        "Unable to list import quarantine files.",
        {
          token,
          missing: error?.name === "NotFoundError",
          cause: error
        }
      );
    }
  }

  async function listTokens() {
    try {
      const quarantine = await getQuarantineDir(false);
      const tokens = [];
      for await (
        const [name, handle] of quarantine.entries()
      ) {
        if (
          handle.kind === "directory" &&
          isSafeImportQuarantineToken(name)
        ) {
          tokens.push(name);
        }
      }
      return tokens.sort(compareText);
    } catch (error) {
      if (error?.name === "NotFoundError") return [];
      throw storageError(
        "Unable to list import quarantine tokens.",
        { cause: error }
      );
    }
  }

  async function remove(token) {
    assertImportQuarantineToken(token);
    try {
      const quarantine = await getQuarantineDir(false);
      await quarantine.removeEntry(
        token,
        { recursive: true }
      );
      return true;
    } catch (error) {
      if (error?.name === "NotFoundError") return false;
      throw storageError(
        "Unable to remove import quarantine token.",
        { token, cause: error }
      );
    }
  }

  async function cleanup(keepTokens = []) {
    const keep = new Set(
      (Array.isArray(keepTokens) ? keepTokens : [])
        .map((token) => {
          assertImportQuarantineToken(token);
          return String(token);
        })
    );

    try {
      const quarantine = await getQuarantineDir(false);
      const entries = [];
      for await (
        const [name] of quarantine.entries()
      ) {
        entries.push(name);
      }

      const removed = [];
      for (const name of entries) {
        if (
          isSafeImportQuarantineToken(name) &&
          keep.has(name)
        ) {
          continue;
        }
        await quarantine.removeEntry(
          name,
          { recursive: true }
        );
        removed.push(name);
      }
      return removed.sort(compareText);
    } catch (error) {
      if (error?.name === "NotFoundError") return [];
      throw storageError(
        "Unable to clean import quarantine.",
        { cause: error }
      );
    }
  }

  async function getQuarantineDir(create) {
    const root = await rootProvider();
    return root.getDirectoryHandle(
      IMPORT_QUARANTINE_ROOT,
      { create }
    );
  }

  async function getTokenDir(token, create) {
    const quarantine = await getQuarantineDir(create);
    return quarantine.getDirectoryHandle(
      token,
      { create }
    );
  }

  return Object.freeze({
    writeFile,
    statFile,
    readFileRange,
    listFiles,
    listTokens,
    remove,
    cleanup
  });
}

async function listFilesFromDirectory(
  token,
  directory
) {
  const files = [];
  for await (
    const [name, handle] of directory.entries()
  ) {
    if (
      handle.kind !== "file" ||
      !isImportQuarantinePath(name)
    ) {
      throw packError(
        PACK_ERROR_CODES.CORRUPT,
        "Import quarantine contains an unexpected entry.",
        { token, path: name }
      );
    }
    const file = await handle.getFile();
    assertImportQuarantineFileSize(
      name,
      file.size
    );
    files.push({
      path: name,
      size: file.size
    });
  }

  if (files.length > IMPORT_QUARANTINE_FILES.length) {
    throw packError(
      PACK_ERROR_CODES.CORRUPT,
      "Import quarantine contains too many files.",
      { token }
    );
  }

  return files.sort(
    (left, right) =>
      compareText(left.path, right.path)
  );
}

function storageError(message, details) {
  if (
    details?.cause?.code &&
    String(details.cause.code).startsWith("PACK_")
  ) {
    return details.cause;
  }
  return packError(
    PACK_ERROR_CODES.STORAGE,
    message,
    details
  );
}

function compareText(left, right) {
  return String(left).localeCompare(
    String(right),
    "en"
  );
}
