import { createOpfsPackStore } from "../../background/packs/opfs-store.js";
import { buildMddIndex, validateMddIndex, MDD_IMPORT_LIMITS } from "../../background/packs/importers/mdd.js";
import { classifyMddResource } from "../../background/packs/importers/mdd-resource-policy.js";
import { RICH_MDICT_OPFS_ROOT } from "../../background/packs/rich-mdict.js";
import {
  RICH_MDD_MAX_INDEX_BYTES,
  RICH_MDD_MAX_SOURCE_BYTES,
  RICH_MDD_MAX_TOTAL_INDEX_BYTES,
  RICH_MDD_MAX_TOTAL_SOURCE_BYTES,
  RICH_MDD_MAX_SIDECAR_FILE_BYTES,
  RICH_MDD_MAX_SIDECAR_BYTES,
  classifyMddSidecarPath,
  resourceFilePaths,
  sidecarFilePath,
  safeFileName,
  validateMddCompanions
} from "../../background/packs/rich-mdd-contract.js";
import { normalizeMddResourcePath } from "../../background/packs/importers/mdd-resource-path.js";
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
    const { dictionaryId, requestId: ignored, resourceVersion, mdxFileName, files, sidecars } = input;
    void ignored;
    const controller = new AbortController();
    active = { requestId, controller };
    try {
      const existingVersions = await store.listVersions(dictionaryId);
      if (existingVersions.includes(resourceVersion)) throw workerError("RICH_MDD_EXISTS", "This MDD resource import version is already in use.");
      const resources = [];
      const totalCopyBytes = files.reduce((sum, file) => sum + file.size, 0) + sidecars.reduce((sum, item) => sum + item.file.size, 0);
      let copiedBytes = 0;
      let totalSourceBytes = 0;
      let totalIndexBytes = 0;
      for (let index = 0; index < files.length; index += 1) {
        assertActive(controller.signal);
        const file = files[index];
        const fileName = safeFileName(file.name);
        emitProgress(postMessage, requestId, "index", { fileName, index: index + 1, count: files.length, bytesRead: 0, fileBytes: file.size });
        let lastReportedRead = 0;
        let observedBytesRead = 0;
        const source = fileSource(file, controller.signal, (bytesRead) => {
          observedBytesRead = bytesRead;
          if (bytesRead - lastReportedRead < 1024 * 1024 && bytesRead < file.size) return;
          lastReportedRead = bytesRead;
          emitProgress(postMessage, requestId, "index", { fileName, index: index + 1, count: files.length, bytesRead, fileBytes: file.size });
        });
        const builtIndex = await buildIndex({ source, signal: controller.signal });
        if (lastReportedRead !== observedBytesRead) {
          emitProgress(postMessage, requestId, "index", { fileName, index: index + 1, count: files.length, bytesRead: observedBytesRead, fileBytes: file.size });
        }
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
        emitProgress(postMessage, requestId, "store-source", {
          fileName, index: index + 1, count: files.length, bytesWritten: 0,
          fileBytes: file.size, completedBytes: copiedBytes, totalBytes: totalCopyBytes
        });
        await store.writeFile(dictionaryId, resourceVersion, paths.sourcePath, file, {
          signal: controller.signal,
          onProgress: ({ bytesWritten }) => emitProgress(postMessage, requestId, "store-source", {
            fileName, index: index + 1, count: files.length, bytesWritten,
            fileBytes: file.size, completedBytes: copiedBytes + bytesWritten, totalBytes: totalCopyBytes
          })
        });
        copiedBytes += file.size;
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
      const storedSidecars = [];
      let sidecarBytes = 0;
      for (let index = 0; index < sidecars.length; index += 1) {
        assertActive(controller.signal);
        const item = sidecars[index];
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        assertActive(controller.signal);
        if (bytes.byteLength !== item.file.size) throw workerError("RICH_MDD_CORRUPT", "A sidecar file was read incompletely.");
        const actual = classifyMddResource(item.path, bytes, MDD_IMPORT_LIMITS);
        if (actual.kind !== item.kind || actual.mime !== item.mime) throw workerError("RICH_MDD_CORRUPT", "A sidecar file does not match its declared type.");
        sidecarBytes += bytes.byteLength;
        if (sidecarBytes > RICH_MDD_MAX_SIDECAR_BYTES) throw workerError("RICH_MDD_LIMIT", "Sidecar files exceed the 64 MiB total safety limit.");
        const sourcePath = sidecarFilePath(index);
        emitProgress(postMessage, requestId, "store-sidecar", {
          fileName: item.path, index: index + 1, count: sidecars.length, bytesWritten: 0,
          fileBytes: item.file.size, completedBytes: copiedBytes, totalBytes: totalCopyBytes
        });
        await store.writeFile(dictionaryId, resourceVersion, sourcePath, item.file, {
          signal: controller.signal,
          onProgress: ({ bytesWritten }) => emitProgress(postMessage, requestId, "store-sidecar", {
            fileName: item.path, index: index + 1, count: sidecars.length, bytesWritten,
            fileBytes: item.file.size, completedBytes: copiedBytes + bytesWritten, totalBytes: totalCopyBytes
          })
        });
        copiedBytes += item.file.size;
        assertActive(controller.signal);
        const sourceSize = await store.getFileSize(dictionaryId, resourceVersion, sourcePath);
        if (sourceSize !== bytes.byteLength) throw workerError("RICH_MDD_STORAGE", "Stored sidecar size is inconsistent.");
        storedSidecars.push({
          path: item.path,
          sourcePath,
          sourceSize,
          sha256: await sha256(bytes, cryptoProvider),
          kind: actual.kind,
          mime: actual.mime
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
        metadata: { mdxFileName, resources, sidecars: storedSidecars }
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
    throw workerError("RICH_MDD_LIMIT", "Each MDD file must be between 1 byte and 4,000,000,000 bytes.");
  }
  const total = sortedFiles.reduce((sum, file) => sum + file.size, 0);
  if (total > RICH_MDD_MAX_TOTAL_SOURCE_BYTES) throw workerError("RICH_MDD_LIMIT", "MDD companions exceed the 4,000,000,000-byte safety limit.");
  const rawSidecars = Array.isArray(input?.sidecars) ? input.sidecars : [];
  if (rawSidecars.length > 32) throw workerError("RICH_MDD_LIMIT", "Select no more than 32 sidecar files.");
  const paths = new Set();
  let sidecarBytes = 0;
  const sidecars = rawSidecars.map((item) => {
    const path = normalizeMddResourcePath(String(item?.path || ""));
    const type = classifyMddSidecarPath(path);
    const file = item?.file;
    if (!type || !file || typeof file.slice !== "function" || !Number.isSafeInteger(file.size) || file.size <= 0 ||
        file.size > RICH_MDD_MAX_SIDECAR_FILE_BYTES || (type.kind === "stylesheet" && file.size > 64 * 1024)) {
      throw workerError("RICH_MDD_LIMIT", "Sidecar files exceed the supported size limit.");
    }
    const key = path.toLocaleLowerCase("en-US");
    if (paths.has(key)) throw workerError("RICH_MDD_INPUT", "Duplicate sidecar resource paths are not allowed.");
    paths.add(key);
    sidecarBytes += file.size;
    if (sidecarBytes > RICH_MDD_MAX_SIDECAR_BYTES) throw workerError("RICH_MDD_LIMIT", "Sidecar files exceed the 64 MiB total safety limit.");
    return { path, file, kind: type.kind, mime: type.mime };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (total + sidecarBytes > RICH_MDD_MAX_TOTAL_SOURCE_BYTES) {
    throw workerError("RICH_MDD_LIMIT", "MDD sources and sidecars exceed the 4,000,000,000-byte package safety limit.");
  }
  return { dictionaryId, requestId, resourceVersion, mdxFileName, files: sortedFiles, sidecars };
}

function fileSource(file, signal, onRead = () => {}) {
  let bytesRead = 0;
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
      bytesRead += bytes.byteLength;
      try { onRead(bytesRead); } catch {}
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
