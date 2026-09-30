import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { RICH_MDD_MAX_SOURCE_BYTES, RICH_MDD_MAX_TOTAL_SOURCE_BYTES, validateMddCompanions } from "../background/packs/rich-mdd-contract.js";
import { MDD_RESOURCE_WORKER_MESSAGES } from "./workers/mdd-resource-import-worker-protocol.js";

export function createMddResourceImportController({
  runtime = globalThis.chrome?.runtime,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
  now = Date.now,
  onProgress = () => {},
  workerUrl = runtime?.getURL?.("src/options/workers/mdd-resource-import-worker.js")
} = {}) {
  if (!runtime?.sendMessage || !runtime?.getURL) throw new Error("MDD resource controller requires chrome.runtime.");
  if (typeof WorkerCtor !== "function") throw new Error("MDD resource controller requires Web Worker support.");
  if (!workerUrl) throw new Error("MDD resource worker URL is unavailable.");

  let active = null;

  async function attachResources({ dictionaryId, mdxFileName, files } = {}) {
    if (active) throw controllerError("RICH_MDD_BUSY", "Another MDD resource import is already running.");
    const normalizedFiles = validateFiles(files, mdxFileName);
    const identity = createIdentity(cryptoProvider, now);
    const requestId = "mdd-res-" + identity.uuid;
    const current = {
      requestId,
      identity,
      dictionaryId: String(dictionaryId || ""),
      mdxFileName: String(mdxFileName || ""),
      worker: null,
      workerReject: null,
      phase: "preflight",
      cancelRequested: false,
      committed: false
    };
    active = current;
    try {
      emitProgress(onProgress, requestId, "preflight", { dictionaryId: current.dictionaryId });
      const preflight = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.RICH_MDD_RESOURCE_PREFLIGHT,
        dictionaryId: current.dictionaryId,
        requestId,
        resourceVersion: identity.resourceVersion,
        mdxFileName: current.mdxFileName,
        files: normalizedFiles.map(({ fileName, size }) => ({ fileName, size }))
      });
      if (!preflight?.ok) throw responseError(preflight, "MDD resource storage preflight failed.");
      assertCurrent(current);

      const worker = new WorkerCtor(workerUrl, { type: "module" });
      current.worker = worker;
      current.phase = "worker";
      const readyPromise = waitForReady(worker, requestId, onProgress, (reject) => { current.workerReject = reject; });
      worker.postMessage({
        type: MDD_RESOURCE_WORKER_MESSAGES.START,
        requestId,
        input: {
          dictionaryId: current.dictionaryId,
          requestId,
          resourceVersion: identity.resourceVersion,
          mdxFileName: current.mdxFileName,
          files: normalizedFiles.map(({ file }) => file)
        }
      });
      const ready = await readyPromise;
      current.workerReject = null;
      worker.terminate();
      current.worker = null;
      assertCurrent(current);

      current.phase = "commit";
      emitProgress(onProgress, requestId, "commit", { dictionaryId: current.dictionaryId });
      const commit = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.RICH_MDD_RESOURCE_COMMIT,
        dictionaryId: current.dictionaryId,
        requestId,
        resourceVersion: identity.resourceVersion,
        metadata: ready.metadata
      });
      if (!commit?.ok) {
        if (current.cancelRequested) throw abortError();
        throw responseError(commit, "MDD resource activation failed.");
      }
      current.committed = true;
      if (current.cancelRequested) throw abortError();
      emitProgress(onProgress, requestId, "done", { dictionaryId: current.dictionaryId, resources: ready.metadata.resources });
      return { requestId, ready, commit };
    } catch (error) {
      if (!current.committed) await removeStaged(current).catch(() => {});
      throw error;
    } finally {
      current.worker?.terminate?.();
      if (active === current) active = null;
    }
  }

  async function cancel() {
    const current = active;
    if (!current) return { cancelled: false, phase: "" };
    if (current.phase === "worker") {
      current.cancelRequested = true;
      current.worker?.postMessage?.({ type: MDD_RESOURCE_WORKER_MESSAGES.CANCEL, requestId: current.requestId });
      return { cancelled: true, phase: "worker" };
    }
    if (current.phase === "commit") {
      const response = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.RICH_MDD_RESOURCE_CANCEL,
        requestId: current.requestId
      });
      if (!response?.ok) return { cancelled: false, phase: "commit" };
      if (response.cancelled) current.cancelRequested = true;
      return { cancelled: Boolean(response.cancelled), phase: response.phase || "commit" };
    }
    current.cancelRequested = true;
    return { cancelled: true, phase: current.phase };
  }

  function dispose() {
    const current = active;
    if (!current) return;
    if (current.phase === "worker") {
      current.cancelRequested = true;
      current.worker?.postMessage?.({ type: MDD_RESOURCE_WORKER_MESSAGES.CANCEL, requestId: current.requestId });
      current.workerReject?.(abortError());
    } else if (current.phase === "commit") {
      void cancel().catch(() => {});
    } else {
      current.cancelRequested = true;
      void removeStaged(current).catch(() => {});
    }
  }

  async function removeStaged(current) {
    return runtime.sendMessage({
      type: BACKGROUND_MESSAGES.RICH_MDD_RESOURCE_ABORT,
      dictionaryId: current.dictionaryId,
      requestId: current.requestId,
      resourceVersion: current.identity.resourceVersion
    });
  }

  function assertCurrent(current) {
    if (active !== current || current.cancelRequested) throw abortError();
  }

  return Object.freeze({
    attachResources,
    cancel,
    dispose,
    get activeRequestId() { return active?.requestId || ""; },
    get activeDictionaryId() { return active?.dictionaryId || ""; },
    get phase() { return active?.phase || ""; }
  });
}

function validateFiles(files, mdxFileName) {
  const input = Array.isArray(files) ? files : Array.from(files || []);
  const ordered = validateMddCompanions(input.map((file) => String(file?.name || "")), mdxFileName);
  const byName = new Map(input.map((file) => [String(file?.name || ""), file]));
  let total = 0;
  return ordered.map(({ fileName }) => {
    const file = byName.get(fileName);
    if (!file || typeof file.slice !== "function" || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > RICH_MDD_MAX_SOURCE_BYTES) {
      throw controllerError("RICH_MDD_LIMIT", "Each MDD file must be between 1 byte and 128 MiB.");
    }
    total += file.size;
    if (total > RICH_MDD_MAX_TOTAL_SOURCE_BYTES) throw controllerError("RICH_MDD_LIMIT", "MDD companions exceed the 512 MiB safety limit.");
    return { fileName, size: file.size, file };
  });
}

function createIdentity(cryptoProvider, now) {
  const uuid = String(cryptoProvider?.randomUUID?.() || "").toLowerCase();
  if (!/^[a-f0-9-]{36}$/u.test(uuid)) throw controllerError("RICH_MDD_STORAGE", "Browser cannot create a secure MDD import ID.");
  const timestamp = Number(now());
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw controllerError("RICH_MDD_STORAGE", "Cannot create an MDD resource version.");
  return {
    uuid,
    resourceVersion: "import-" + timestamp.toString(36) + "-" + uuid.slice(0, 8)
  };
}

function waitForReady(worker, requestId, onProgress, setReject) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener?.("message", onMessage);
      worker.removeEventListener?.("error", onError);
    };
    setReject?.((error) => { cleanup(); reject(error); });
    const onMessage = (event) => {
      const message = event?.data;
      if (message?.requestId !== requestId) return;
      if (message.type === MDD_RESOURCE_WORKER_MESSAGES.PROGRESS) emitProgress(onProgress, requestId, message.phase || "worker", message);
      else if (message.type === MDD_RESOURCE_WORKER_MESSAGES.READY) { cleanup(); resolve(message); }
      else if (message.type === MDD_RESOURCE_WORKER_MESSAGES.ERROR) { cleanup(); reject(workerError(message)); }
    };
    const onError = (event) => {
      cleanup();
      reject(controllerError("RICH_MDD_WORKER_FAILURE", event?.message || "MDD resource worker failed."));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  });
}

function workerError(message) {
  const error = controllerError(message?.errorCode || "RICH_MDD_WORKER_FAILURE", message?.error || "MDD resource worker failed.");
  error.name = message?.errorName || error.name;
  return error;
}

function responseError(response, fallback) {
  return controllerError(response?.errorCode || "RICH_MDD_FAILURE", response?.error || fallback);
}

function emitProgress(onProgress, requestId, phase, details = {}) {
  try { onProgress({ requestId, phase, ...details }); } catch {}
}

function controllerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function abortError() { return new DOMException("MDD resource import cancelled.", "AbortError"); }
