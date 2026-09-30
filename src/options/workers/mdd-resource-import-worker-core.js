import { createOpfsPackStore } from "../../background/packs/opfs-store.js";
import { buildMddIndex, validateMddIndex } from "../../background/packs/importers/mdd.js";
import { RICH_MDICT_OPFS_ROOT } from "../../background/packs/rich-mdict.js";
import {
  RICH_MDD_MAX_INDEX_BYTES,
  RICH_MDD_MAX_SOURCE_BYTES,
  RICH_MDD_MAX_TOTAL_INDEX_BYTES,
  RICH_MDD_MAX_TOTAL_SOURCE_BYTES,
  resourceFilePaths,
  safeFileName,
  validateMddCompanions
} from "../../background/packs/rich-mdd-contract.js";
import { normalizePackId, normalizeRequestId, normalizeVersion, richError, richMdictAbortError } from "../../background/packs/rich-mdict-contract.js";
import { MDD_RESOURCE_WORKER_MESSAGES } from "./mdd-resource-import-worker-protocol.js";

export function createMddResourceImportWorkerHandler({
  postMessage,
  store = createOpfsPackStore({ rootDir: RICH_MDICT_OPFS_ROOT }),
  cryptoProvider = globalThis.crypto,
  buildIndex = buildMddIndex,
  validateIndex = validateMddIndex
} = {}) {
  if (typeof postMessage !== "function") throw new Error("MDD resource worker requires postMessage.");
  if (!store?.writeFile || !store?.getFileSize || !store?.removeVersion || !store?.listVersions) {
    throw new Error("MDD resource worker requires the existing rich dictionary OPFS store.");
  }
  let active = null;

  function cancel(requestId) {
    if (!active || active.requestId !== normalizeRequestId(requestId)) return { cancelled: false };
    active.controller.abort();
    return { cancelled: true };
  }

  async function handleMessage(message) {
    if (message?.type === MDD_RESOURCE_WORKER_MESSAGES.CANCEL) return cancel(message.requestId);
    if (message?.type !== MDD_RESOURCE_WORKER_MESSAGES.START) {
      throw workerError("RICH_MDD_WORKER_INPUT", "Unknown MDD resource worker message.");
    }
    const requestId = normalizeRequestId(message.requestId);
    if (active) throw workerError("RICH_MDD_WORKER_BUSY", "Another MDD resource import is already running.");
    const input = validateInput(message.input);
    const { dictionaryId, requestId: ignored, resourceVersion, mdxFileName, files } = input;
    void ignored;
    const controller = new AbortController();
    active = { requestId, controller };
    try {
      const existingVersions = await store.listVersions(dictionaryId);
      if (existingVersions.includes(resourceVersion)) throw workerError("RICH_MDD_EXISTS", "This MDD resource import version is already in use.");
      const resources = [];
      let totalSourceBytes = 0;
      let totalIndexBytes = 0;
      for (let index = 0; index < files.length; index += 1) {
        assertActive(controller.signal);
        const file = files[index];
        const fileName = safeFileName(file.name);
        emitProgress(postMessage, requestId, "index", { fileName, index: index + 1, count: files.length });
        const source = fileSource(file, controller.signal);
        const builtIndex = await buildIndex({ source, signal: controller.signal });
        validateIndex(builtIndex, { sourceSize: file.size });
        const indexBytes = new TextEncoder().encode(JSON.stringify(builtIndex));
        if (!indexBytes.byteLength || indexBytes.byteLength > RICH_MDD_MAX_INDEX_BYTES) {
          throw workerError("RICH_MDD_LIMIT", "An MDD compact index exceeds the 16 MiB safety limit.");
        }
        totalSourceBytes += file.size;
        totalIndexBytes += indexBytes.byteLength;
        if (totalSourceBytes > RICH_MDD_MAX_TOTAL_SOURCE_BYTES || totalIndexBytes > RICH_MDD_MAX_TOTAL_INDEX_BYTES) {
          throw workerError("RICH_MDD_LIMIT", "MDD companions exceed the total import safety limit.");
        }
        const paths = resourceFilePaths(index);
        const indexSha256 = await sha256(indexBytes, cryptoProvider);
        emitProgress(postMessage, requestId, "store-source", { fileName, index: index + 1, count: files.length });
        await store.writeFile(dictionaryId, resourceVersion, paths.sourcePath, file);
        assertActive(controller.signal);
        emitProgress(postMessage, requestId, "store-index", { fileName, index: index + 1, count: files.length });
        await store.writeFile(dictionaryId, resourceVersion, paths.indexPath, indexBytes);
        assertActive(controller.signal);
        const sourceSize = await store.getFileSize(dictionaryId, resourceVersion, paths.sourcePath);
        const storedIndexSize = await store.getFileSize(dictionaryId, resourceVersion, paths.indexPath);
        if (sourceSize !== file.size || storedIndexSize !== indexBytes.byteLength) {
          throw workerError("RICH_MDD_STORAGE", "Stored MDD source or compact index size is inconsistent.");
        }
        resources.push({
          ...paths,
          fileName,
          sourceSize,
          indexSize: storedIndexSize,
          indexSha256,
          keyCount: builtIndex.keyCount
        });
      }
      const ordered = validateMddCompanions(resources.map((resource) => resource.fileName), mdxFileName);
      if (ordered.some((item, index) => item.fileName !== resources[index].fileName)) {
        throw workerError("RICH_MDD_CORRUPT", "MDD companions changed order during indexing.");
      }
      const result = {
        type: MDD_RESOURCE_WORKER_MESSAGES.READY,
        requestId,
        dictionaryId,
        resourceVersion,
        metadata: { mdxFileName, resources }
      };
      postMessage(result);
      return result;
    } catch (error) {
      await store.removeVersion(dictionaryId, resourceVersion).catch(() => {});
      const result = {
        type: MDD_RESOURCE_WORKER_MESSAGES.ERROR,
        requestId,
        error: error?.message || String(error),
        errorName: error?.name || "Error",
        errorCode: error?.code || ""
      };
      postMessage(result);
      return result;
    } finally {
      if (active?.requestId === requestId) active = null;
    }
  }

  return Object.freeze({ handleMessage, cancel, get activeRequestId() { return active?.requestId || ""; } });
}

function validateInput(input) {
  const dictionaryId = normalizePackId(input?.dictionaryId);
  const requestId = normalizeRequestId(input?.requestId);
  const resourceVersion = normalizeVersion(input?.resourceVersion);
  const mdxFileName = safeFileName(input?.mdxFileName);
  const files = Array.isArray(input?.files) ? input.files : [];
  if (!files.length || files.length > 16) throw workerError("RICH_MDD_INPUT", "Select up to 16 MDD files.");
  const ordered = validateMddCompanions(files.map((file) => file?.name), mdxFileName);
  const byName = new Map(files.map((file) => [safeFileName(file?.name), file]));
  const sortedFiles = ordered.map(({ fileName }) => byName.get(fileName));
  if (sortedFiles.some((file) => !file || typeof file.slice !== "function" || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > RICH_MDD_MAX_SOURCE_BYTES)) {
    throw workerError("RICH_MDD_LIMIT", "Each MDD file must be between 1 byte and 128 MiB.");
  }
  const total = sortedFiles.reduce((sum, file) => sum + file.size, 0);
  if (total > RICH_MDD_MAX_TOTAL_SOURCE_BYTES) throw workerError("RICH_MDD_LIMIT", "MDD companions exceed the 512 MiB safety limit.");
  return { dictionaryId, requestId, resourceVersion, mdxFileName, files: sortedFiles };
}

function fileSource(file, signal) {
  return {
    size: file.size,
    async read(offset, length) {
      assertActive(signal);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0 || offset > file.size || length > file.size - offset) {
        throw workerError("RICH_MDD_CORRUPT", "MDD byte range is outside the selected file.");
      }
      const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
      assertActive(signal);
      if (bytes.byteLength !== length) throw workerError("RICH_MDD_CORRUPT", "MDD range read returned a short block.");
      return bytes;
    }
  };
}

async function sha256(bytes, cryptoProvider) {
  if (!cryptoProvider?.subtle?.digest) throw workerError("RICH_MDD_STORAGE", "WebCrypto is unavailable for MDD index verification.");
  const digest = new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function emitProgress(postMessage, requestId, phase, details = {}) {
  try { postMessage({ type: MDD_RESOURCE_WORKER_MESSAGES.PROGRESS, requestId, phase, ...details }); } catch {}
}

function assertActive(signal) { if (signal?.aborted) throw richMdictAbortError(); }

function workerError(code, message) {
  return richError(code, message);
}
