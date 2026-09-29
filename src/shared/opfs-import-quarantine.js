import {
  PACK_ERROR_CODES,
  PACK_LIMITS,
  packError
} from "./pack-manager.js";

const ROOT_DIR = "dictionary-import-quarantine";
const ALLOWED_FILES = Object.freeze([
  "entries.dat",
  "index.dat",
  "manifest.json"
]);
const ALLOWED_FILE_SET = new Set(ALLOWED_FILES);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IMPORT_QUARANTINE_RANGE_BYTES =
  4 * 1024 * 1024;

export function makeImportQuarantineToken(
  randomUUID = () => globalThis.crypto.randomUUID()
) {
  if (typeof randomUUID !== "function") {
    throw new Error(
      "Import quarantine token factory must be a function."
    );
  }
  const value = String(randomUUID() || "");
  if (!UUID_PATTERN.test(value)) {
    throw new Error(
      "Import quarantine token factory returned an invalid UUID."
    );
  }
  return "import-" + value.toLowerCase();
}

export function isSafeImportQuarantineToken(value) {
  const text = String(value || "");
  return text.startsWith("import-") &&
    UUID_PATTERN.test(text.slice("import-".length));
}

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
    validateToken(token);
    validatePath(path);
    const bytes = normalizeBytes(input, path);
    validateFileSize(path, bytes.byteLength);

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
      if (nextTotal > PACK_LIMITS.totalBytes) {
        throw packError(
          PACK_ERROR_CODES.QUOTA,
          "Import quarantine exceeds the current safety ceiling.",
          {
            token,
            totalBytes: nextTotal,
            maximumBytes: PACK_LIMITS.totalBytes
          }
        );
      }

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
    validateToken(token);
    validatePath(path);
    try {
      const directory = await getTokenDir(token, false);
      const handle = await directory.getFileHandle(path);
      const file = await handle.getFile();
      validateFileSize(path, file.size);
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
    validateToken(token);
    validatePath(path);
    validateRange(offset, length);

    try {
      const directory = await getTokenDir(token, false);
      const handle = await directory.getFileHandle(path);
      const file = await handle.getFile();
      validateFileSize(path, file.size);
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
    validateToken(token);
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
      for await (const [name, handle] of quarantine.entries()) {
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
    validateToken(token);
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
          validateToken(token);
          return String(token);
        })
    );

    try {
      const quarantine = await getQuarantineDir(false);
      const removed = [];
      for await (const [name] of quarantine.entries()) {
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
      ROOT_DIR,
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
  for await (const [name, handle] of directory.entries()) {
    if (
      handle.kind !== "file" ||
      !ALLOWED_FILE_SET.has(name)
    ) {
      throw packError(
        PACK_ERROR_CODES.CORRUPT,
        "Import quarantine contains an unexpected entry.",
        { token, path: name }
      );
    }
    const file = await handle.getFile();
    validateFileSize(name, file.size);
    files.push({
      path: name,
      size: file.size
    });
  }
  return files.sort(
    (left, right) =>
      compareText(left.path, right.path)
  );
}

function validateToken(token) {
  if (!isSafeImportQuarantineToken(token)) {
    throw packError(
      PACK_ERROR_CODES.STORAGE,
      "Unsafe import quarantine token."
    );
  }
}

function validatePath(path) {
  if (!ALLOWED_FILE_SET.has(String(path || ""))) {
    throw packError(
      PACK_ERROR_CODES.STORAGE,
      "Import quarantine only accepts TFLex manifest.json, index.dat and entries.dat."
    );
  }
}

function normalizeBytes(value, path) {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength
        )
        : null;
  if (!bytes?.byteLength) {
    throw packError(
      PACK_ERROR_CODES.STORAGE,
      "Import quarantine file is empty or invalid.",
      { path }
    );
  }
  return bytes;
}

function validateFileSize(path, size) {
  if (
    !Number.isSafeInteger(size) ||
    size <= 0
  ) {
    throw packError(
      PACK_ERROR_CODES.CORRUPT,
      "Import quarantine file size is invalid.",
      { path, size }
    );
  }
  const maximum = path === "manifest.json"
    ? PACK_LIMITS.catalogBytes
    : PACK_LIMITS.totalBytes;
  if (size > maximum) {
    throw packError(
      PACK_ERROR_CODES.QUOTA,
      "Import quarantine file exceeds the current safety ceiling.",
      {
        path,
        size,
        maximumBytes: maximum
      }
    );
  }
}

function validateRange(offset, length) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > IMPORT_QUARANTINE_RANGE_BYTES
  ) {
    throw packError(
      PACK_ERROR_CODES.STORAGE,
      "Invalid import quarantine byte range.",
      {
        offset,
        length,
        maximumLength:
          IMPORT_QUARANTINE_RANGE_BYTES
      }
    );
  }
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
