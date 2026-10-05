import { WORKER_PATHS } from "../shared/runtime-assets.js";
import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import {
  assertDeclaredCuratedDictionary,
  CURATED_IMPORTER_TYPES
} from "../shared/curated-dictionaries.js";
import { RICH_MDICT_WORKER_MESSAGES } from "./workers/rich-mdict-import-worker-protocol.js";

export function createRichMdictImportController({
  runtime = globalThis.chrome?.runtime,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
  now = Date.now,
  onProgress = () => {},
  workerUrl = runtime?.getURL?.(WORKER_PATHS.richMdictImport)
} = {}) {
  if (!runtime?.sendMessage || !runtime?.getURL) {
    throw new Error("Rich MDict controller requires chrome.runtime.");
  }
  if (typeof WorkerCtor !== "function") {
    throw new Error("Rich MDict controller requires Web Worker support.");
  }
  if (!workerUrl) throw new Error("Rich MDict import worker URL is unavailable.");

  let active = null;

  async function importDictionary({
    mdxFile,
    displayMetadata = {},
    curatedRecipe = null,
    expectedActiveVersion = ""
  } = {}) {
    if (active) throw controllerError("RICH_MDICT_BUSY", "Another rich MDict import is already running.");
    validateFile(mdxFile);
    const declaredRecipe = curatedRecipe
      ? assertCuratedMdxRecipe(curatedRecipe)
      : null;
    const identity = createIdentity(
      cryptoProvider,
      now,
      declaredRecipe?.output?.packId || ""
    );
    const catalogReplacement = declaredRecipe
      ? {
          recipeId: declaredRecipe.id,
          expectedActiveVersion: String(expectedActiveVersion || "")
        }
      : null;
    const requestId = "rich-dict-" + identity.uuid;
    const current = {
      requestId,
      identity,
      worker: null,
      workerReject: null,
      phase: "preflight",
      cancelRequested: false,
      committed: false
    };
    active = current;

    try {
      emitProgress(onProgress, requestId, "preflight");
      const preflight = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_PREFLIGHT,
        sourceBytes: mdxFile.size,
        requestId,
        packId: identity.packId,
        packVersion: identity.packVersion,
        ...(catalogReplacement ? { catalogReplacement } : {})
      });
      if (!preflight?.ok) throw responseError(preflight, "Rich dictionary storage preflight failed.");
      assertCurrent(current);

      const worker = new WorkerCtor(workerUrl, { type: "module" });
      current.worker = worker;
      current.phase = "worker";
      const readyPromise = waitForReady({
        worker,
        requestId,
        onProgress,
        setReject(reject) {
          current.workerReject = reject;
        }
      });
      worker.postMessage({
        type: RICH_MDICT_WORKER_MESSAGES.START,
        requestId,
        input: {
          file: mdxFile,
          packId: identity.packId,
          packVersion: identity.packVersion,
          displayMetadata,
          ...(declaredRecipe ? { curatedRecipeId: declaredRecipe.id } : {})
        }
      });

      const ready = await readyPromise;
      current.workerReject = null;
      worker.terminate();
      current.worker = null;
      assertCurrent(current);

      current.phase = "commit";
      emitProgress(onProgress, requestId, "commit");
      const commit = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_COMMIT,
        requestId,
        packId: ready.packId,
        packVersion: ready.packVersion,
        metadata: ready.metadata,
        ...(catalogReplacement ? { catalogReplacement } : {})
      });
      if (!commit?.ok) {
        if (current.cancelRequested) throw abortError();
        throw responseError(commit, "Rich dictionary activation failed.");
      }
      current.committed = true;
      if (current.cancelRequested) {
        await runtime.sendMessage({
          type: BACKGROUND_MESSAGES.RICH_MDICT_UNINSTALL,
          packId: identity.packId
        });
        throw abortError();
      }
      emitProgress(onProgress, requestId, "done", {
        dictionary: commit.dictionary,
        metadata: ready.metadata
      });
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
      current.worker?.postMessage?.({
        type: RICH_MDICT_WORKER_MESSAGES.CANCEL,
        requestId: current.requestId
      });
      return { cancelled: true, phase: "worker" };
    }
    if (current.phase === "commit") {
      const response = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_CANCEL,
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
      current.worker?.postMessage?.({
        type: RICH_MDICT_WORKER_MESSAGES.CANCEL,
        requestId: current.requestId
      });
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
      type: BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_ABORT,
      packId: current.identity.packId,
      packVersion: current.identity.packVersion
    });
  }

  function assertCurrent(current) {
    if (active !== current || current.cancelRequested) throw abortError();
  }

  return Object.freeze({
    importDictionary,
    cancel,
    dispose,
    get activeRequestId() { return active?.requestId || ""; },
    get phase() { return active?.phase || ""; }
  });
}

function validateFile(file) {
  if (!file || typeof file.slice !== "function" || !Number.isSafeInteger(file.size) || file.size <= 0 || !/\.mdx$/iu.test(String(file.name || ""))) {
    throw controllerError("RICH_MDICT_INPUT", "请选择一个有效的 .mdx 文件。");
  }
  if (file.size > 128 * 1024 * 1024) {
    throw controllerError("RICH_MDICT_LIMIT", "MDX 文件超过当前 128 MiB 安全上限。");
  }
}

function createIdentity(cryptoProvider, now, stablePackId = "") {
  const uuid = String(cryptoProvider?.randomUUID?.() || "").toLowerCase();
  if (!/^[a-f0-9-]{36}$/u.test(uuid)) {
    throw controllerError("RICH_MDICT_STORAGE", "浏览器无法生成安全的本地词典标识。");
  }
  const timestamp = Number(now());
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw controllerError("RICH_MDICT_STORAGE", "无法生成本地词典导入标识。");
  }
  return {
    uuid,
    packId: stablePackId || "rich-mdict-" + uuid,
    packVersion: "import-" + timestamp.toString(36) + "-" + uuid.slice(0, 8)
  };
}

function assertCuratedMdxRecipe(recipe) {
  const declared = assertDeclaredCuratedDictionary(recipe);
  if (
    declared.importerType !== CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1 ||
    declared.output?.recipeId !== declared.id ||
    !/^rich-mdict-[a-f0-9-]{36}$/u.test(String(declared.output?.packId || ""))
  ) {
    throw controllerError("RICH_MDICT_PROVENANCE", "Curated rich MDict recipe is not declared by this extension.");
  }
  return declared;
}

function waitForReady({ worker, requestId, onProgress, setReject }) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener?.("message", onMessage);
      worker.removeEventListener?.("error", onError);
    };
    setReject?.((error) => {
      cleanup();
      reject(error);
    });
    const onMessage = (event) => {
      const message = event?.data;
      if (message?.requestId !== requestId) return;
      if (message.type === RICH_MDICT_WORKER_MESSAGES.PROGRESS) {
        emitProgress(onProgress, requestId, message.phase || "worker", progressDetails(message));
      } else if (message.type === RICH_MDICT_WORKER_MESSAGES.READY) {
        cleanup();
        resolve(message);
      } else if (message.type === RICH_MDICT_WORKER_MESSAGES.ERROR) {
        cleanup();
        reject(workerError(message));
      }
    };
    const onError = (event) => {
      cleanup();
      reject(controllerError("RICH_MDICT_WORKER_FAILURE", event?.message || "Rich MDict worker failed."));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  });
}

function progressDetails(message) {
  const allowed = ["fileName", "index", "count", "bytesRead", "bytesWritten", "fileBytes", "completedBytes", "totalBytes"];
  return Object.fromEntries(allowed.filter((key) => message?.[key] !== undefined).map((key) => [key, message[key]]));
}

function workerError(message) {
  const error = controllerError(message?.errorCode || "RICH_MDICT_WORKER_FAILURE", message?.error || "Rich MDict worker failed.");
  error.name = message?.errorName || error.name;
  return error;
}

function responseError(response, fallback) {
  return controllerError(response?.errorCode || "RICH_MDICT_FAILURE", response?.error || fallback);
}

function emitProgress(onProgress, requestId, phase, details = {}) {
  try { onProgress({ requestId, phase, ...details }); } catch {}
}

function controllerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function abortError() {
  return new DOMException("Rich MDict import cancelled.", "AbortError");
}
