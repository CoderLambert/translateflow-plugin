import {
  createOpfsPackStore
} from "../../background/packs/opfs-store.js";
import {
  buildRichMdictIndex
} from "../../background/packs/importers/mdict-rich.js";
import {
  RICH_MDICT_OPFS_ROOT,
  RICH_MDICT_INDEX_PATH,
  RICH_MDICT_SOURCE_PATH
} from "../../background/packs/rich-mdict.js";
import {
  RICH_MDICT_WORKER_MESSAGES
} from "./rich-mdict-import-worker-protocol.js";
import {
  makeCuratedRichMdictProvenance
} from "../../background/packs/rich-mdict-contract.js";
import {
  CURATED_IMPORTER_TYPES,
  getCuratedDictionary
} from "../../shared/curated-dictionaries.js";

const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_INDEX_BYTES = 8 * 1024 * 1024;

export function createRichMdictImportWorkerHandler({
  postMessage,
  store = createOpfsPackStore({ rootDir: RICH_MDICT_OPFS_ROOT }),
  cryptoProvider = globalThis.crypto,
  buildIndex = buildRichMdictIndex
} = {}) {
  if (typeof postMessage !== "function") {
    throw new Error("Rich MDict import worker requires postMessage.");
  }
  if (!store?.writeFile || !store?.getFileSize || !store?.removeVersion || !store?.listVersions) {
    throw new Error("Rich MDict import worker requires OPFS storage.");
  }

  let active = null;

  function cancel(requestId) {
    if (!active || active.requestId !== normalizeRequestId(requestId)) {
      return { cancelled: false };
    }
    active.controller.abort();
    return { cancelled: true };
  }

  async function handleMessage(message) {
    if (message?.type === RICH_MDICT_WORKER_MESSAGES.CANCEL) {
      return cancel(message.requestId);
    }
    if (message?.type !== RICH_MDICT_WORKER_MESSAGES.START) {
      throw workerError("RICH_MDICT_WORKER_INPUT", "Unknown rich MDict import worker message.");
    }

    const requestId = normalizeRequestId(message.requestId);
    if (active) {
      throw workerError("RICH_MDICT_WORKER_BUSY", "Another rich MDict import is already running.");
    }
    const input = validateInput(message.input);
    const {
      file,
      packId,
      packVersion,
      displayMetadata = {},
      curatedRecipeId = ""
    } = input;
    const controller = new AbortController();
    active = { requestId, controller };

    try {
      emitProgress(postMessage, requestId, "index");
      const source = {
        size: file.size,
        async read(offset, length) {
          assertActive(controller.signal);
          if (
            !Number.isSafeInteger(offset) || offset < 0 ||
            !Number.isSafeInteger(length) || length <= 0 ||
            offset > file.size || length > file.size - offset
          ) {
            throw workerError("RICH_MDICT_CORRUPT", "MDX byte range is outside the selected file.");
          }
          const bytes = new Uint8Array(
            await file.slice(offset, offset + length).arrayBuffer()
          );
          assertActive(controller.signal);
          if (bytes.byteLength !== length) {
            throw workerError("RICH_MDICT_CORRUPT", "MDX range read returned a short block.");
          }
          return bytes;
        }
      };
      const index = await buildIndex({ source, signal: controller.signal });
      assertActive(controller.signal);

      const indexBytes = new TextEncoder().encode(JSON.stringify(index));
      if (!indexBytes.byteLength || indexBytes.byteLength > MAX_INDEX_BYTES) {
        throw workerError("RICH_MDICT_LIMIT", "Rich MDict index exceeds the 8 MiB safety limit.");
      }
      const indexSha256 = await sha256(indexBytes, cryptoProvider);

      const existingVersions = await store.listVersions(packId);
      if (
        existingVersions.includes(packVersion) ||
        (!curatedRecipeId && existingVersions.length)
      ) {
        throw workerError("RICH_MDICT_EXISTS", "This rich dictionary identifier is already in use.");
      }
      emitProgress(postMessage, requestId, "store-source");
      await store.writeFile(packId, packVersion, RICH_MDICT_SOURCE_PATH, file);
      assertActive(controller.signal);
      emitProgress(postMessage, requestId, "store-index");
      await store.writeFile(packId, packVersion, RICH_MDICT_INDEX_PATH, indexBytes);
      assertActive(controller.signal);

      const storedSourceBytes = await store.getFileSize(packId, packVersion, RICH_MDICT_SOURCE_PATH);
      const storedIndexBytes = await store.getFileSize(packId, packVersion, RICH_MDICT_INDEX_PATH);
      if (storedSourceBytes !== file.size || storedIndexBytes !== indexBytes.byteLength) {
        throw workerError("RICH_MDICT_STORAGE", "Stored MDX source or index size does not match the completed import.");
      }

      const header = index.header || {};
      const metadata = {
        sourceSize: file.size,
        indexSize: indexBytes.byteLength,
        indexSha256,
        entryCount: index.entryCount,
        title: header.title || displayMetadata.name || file.name.replace(/\.mdx$/iu, ""),
        fileName: file.name || "dictionary.mdx",
        format: header.format || index.format || "Html",
        engineVersion: header.version || header.generatedByEngineVersion || "",
        encoding: header.encoding || "",
        header,
        ...(curatedRecipeId
          ? { curated: makeCuratedRichMdictProvenance(curatedRecipeId) }
          : {})
      };
      const result = {
        type: RICH_MDICT_WORKER_MESSAGES.READY,
        requestId,
        packId,
        packVersion,
        metadata
      };
      postMessage(result);
      return result;
    } catch (error) {
      await store.removeVersion(packId, packVersion).catch(() => {});
      const payload = {
        type: RICH_MDICT_WORKER_MESSAGES.ERROR,
        requestId,
        error: error?.message || String(error),
        errorName: error?.name || "Error",
        errorCode: error?.code || ""
      };
      postMessage(payload);
      return payload;
    } finally {
      if (active?.requestId === requestId) active = null;
    }
  }

  return Object.freeze({
    handleMessage,
    cancel,
    get activeRequestId() {
      return active?.requestId || "";
    }
  });
}

function validateInput(input) {
  const file = input?.file;
  if (
    !file || typeof file.slice !== "function" ||
    !Number.isSafeInteger(file.size) || file.size <= 0 ||
    file.size > MAX_SOURCE_BYTES ||
    !/\.mdx$/iu.test(String(file.name || ""))
  ) {
    throw workerError("RICH_MDICT_INPUT", "Choose a valid MDX file no larger than 128 MiB.");
  }
  const packId = normalizePackId(input.packId);
  const packVersion = normalizePackVersion(input.packVersion);
  const curatedRecipeId = String(input.curatedRecipeId || "");
  if (curatedRecipeId) {
    const curated = makeCuratedRichMdictProvenance(curatedRecipeId);
    const source = getCuratedDictionary(curatedRecipeId);
    if (
      curated.recipeId !== curatedRecipeId ||
      source?.importerType !== CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1 ||
      source?.output?.packId !== packId
    ) {
      throw workerError("RICH_MDICT_PROVENANCE", "Curated rich MDict identity does not match its declared recipe.");
    }
  }
  return {
    file,
    packId,
    packVersion,
    displayMetadata: input.displayMetadata || {},
    curatedRecipeId
  };
}

async function sha256(bytes, cryptoProvider) {
  if (!cryptoProvider?.subtle?.digest) {
    throw workerError("RICH_MDICT_STORAGE", "WebCrypto is unavailable for rich dictionary index verification.");
  }
  const digest = new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function emitProgress(postMessage, requestId, phase) {
  postMessage({ type: RICH_MDICT_WORKER_MESSAGES.PROGRESS, requestId, phase });
}

function normalizeRequestId(value) {
  const text = String(value || "");
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw workerError("RICH_MDICT_WORKER_INPUT", "Rich MDict worker request ID is invalid.");
  }
  return text;
}

function normalizePackId(value) {
  const text = String(value || "");
  if (!/^rich-mdict-[a-f0-9-]{36}$/u.test(text)) {
    throw workerError("RICH_MDICT_WORKER_INPUT", "Rich MDict package ID is invalid.");
  }
  return text;
}

function normalizePackVersion(value) {
  const text = String(value || "");
  if (!/^import-[a-z0-9]+-[a-f0-9]{8}$/u.test(text)) {
    throw workerError("RICH_MDICT_WORKER_INPUT", "Rich MDict package version is invalid.");
  }
  return text;
}

function assertActive(signal) {
  if (!signal?.aborted) return;
  throw new DOMException("Rich MDict import cancelled.", "AbortError");
}

function workerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
