import { WORKER_PATHS } from "../shared/runtime-assets.js";
import {
  BACKGROUND_MESSAGES
} from "../shared/constants.js";
import {
  createOpfsImportQuarantine
} from "../shared/opfs-import-quarantine.js";
import {
  prepareMdictWorkerInput,
  waitForMdictWorkerReady
} from "./mdict-import-controller-io.js";
import {
  MDICT_WORKER_MESSAGES
} from "./workers/mdict-import-worker-protocol.js";

export function createMdictImportController({
  runtime = globalThis.chrome?.runtime,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
  quarantine = createOpfsImportQuarantine(),
  onProgress = () => {},
  workerUrl = runtime?.getURL?.(
    WORKER_PATHS.mdictImport
  )
} = {}) {
  if (!runtime?.sendMessage || !runtime?.getURL) {
    throw new Error(
      "MDict import controller requires chrome.runtime."
    );
  }
  if (typeof WorkerCtor !== "function") {
    throw new Error(
      "MDict import controller requires Web Worker support."
    );
  }
  if (!workerUrl) {
    throw new Error("MDict import worker URL is unavailable.");
  }

  let active = null;

  async function importDictionary(input = {}) {
    if (active) {
      throw controllerError(
        "MDICT_IMPORT_BUSY",
        "Another MDict import is already running."
      );
    }

    const requestId = makeRequestId(cryptoProvider);
    const worker = new WorkerCtor(
      workerUrl,
      { type: "module" }
    );
    const current = {
      requestId,
      worker,
      workerReject: null,
      phase: "read",
      commitRequestId: "",
      cancelRequested: false
    };
    active = current;

    try {
      emitProgress(onProgress, requestId, "read");
      const prepared = await prepareMdictWorkerInput(input);
      assertCurrent(current);

      current.phase = "worker";
      const readyPromise = waitForMdictWorkerReady({
        worker,
        requestId,
        onProgress,
        setReject(reject) {
          current.workerReject = reject;
        }
      });
      worker.postMessage(
        {
          type: MDICT_WORKER_MESSAGES.START,
          requestId,
          input: prepared.input
        },
        prepared.transfer
      );

      const ready = await readyPromise;
      current.workerReject = null;
      worker.terminate();
      current.worker = null;
      if (current.cancelRequested) {
        await quarantine.remove(ready.token).catch(() => {});
        throw abortError();
      }
      assertCurrent(current);

      const commitRequestId = makeRequestId(cryptoProvider);
      current.phase = "commit";
      current.commitRequestId = commitRequestId;
      emitProgress(onProgress, requestId, "commit", {
        token: ready.token
      });

      const commit = await runtime.sendMessage({
        type:
          BACKGROUND_MESSAGES.DICTIONARY_LOCAL_IMPORT_COMMIT,
        token: ready.token,
        requestId: commitRequestId,
        ...(input.displayMetadata
          ? { displayMetadata: input.displayMetadata }
          : {})
      });
      if (!commit?.ok) {
        if (current.cancelRequested) throw abortError();
        throw responseError(
          commit,
          "MDict dictionary activation failed."
        );
      }
      current.phase = "done";
      emitProgress(onProgress, requestId, "done", {
        packId: ready.packId,
        packVersion: ready.packVersion,
        metrics: ready.metrics
      });
      return { requestId, ready, commit };
    } finally {
      current.worker?.terminate?.();
      if (active === current) active = null;
    }
  }

  async function cancel({ hard = false } = {}) {
    const current = active;
    if (!current) return { cancelled: false, phase: "" };
    if (current.phase === "done") return { cancelled: false, phase: "done" };
    if (current.phase === "commit") {
      const response = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.DICTIONARY_PACK_CANCEL,
        requestId: current.commitRequestId
      });
      const cancelled = Boolean(response?.cancelled);
      if (cancelled) current.cancelRequested = true;
      return {
        cancelled,
        phase: cancelled ? "commit" : String(response?.phase || "")
      };
    }

    current.cancelRequested = true;
    if (current.phase === "worker") {
      if (hard) {
        current.worker?.terminate?.();
        current.workerReject?.(abortError());
      } else {
        current.worker?.postMessage?.({
          type: MDICT_WORKER_MESSAGES.CANCEL,
          requestId: current.requestId
        });
      }
      return { cancelled: true, phase: "worker", hard };
    }
    return { cancelled: true, phase: "read", hard: false };
  }

  function dispose() {
    const current = active;
    if (!current) return;
    current.cancelRequested = true;
    current.worker?.terminate?.();
    current.workerReject?.(abortError());
    active = null;
  }

  function assertCurrent(current) {
    if (active !== current || current.cancelRequested) {
      throw abortError();
    }
  }

  return Object.freeze({
    importDictionary,
    cancel,
    dispose,
    get activeRequestId() {
      return active?.requestId || "";
    },
    get phase() {
      return active?.phase || "";
    }
  });
}

function makeRequestId(cryptoProvider) {
  const id = cryptoProvider?.randomUUID?.();
  if (!id) {
    throw new Error(
      "WebCrypto randomUUID is required for dictionary import."
    );
  }
  return "dict-" + id;
}

function emitProgress(
  onProgress,
  requestId,
  phase,
  details = {}
) {
  try {
    onProgress({ requestId, phase, ...details });
  } catch {}
}

function responseError(response, fallback) {
  return controllerError(
    response?.errorCode || "MDICT_IMPORT_COMMIT",
    response?.error || fallback
  );
}

function controllerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function abortError() {
  return new DOMException(
    "MDict dictionary import cancelled.",
    "AbortError"
  );
}
