import {
  BACKGROUND_MESSAGES
} from "../shared/constants.js";
import {
  createOpfsImportQuarantine
} from "../shared/opfs-import-quarantine.js";
import {
  reclaimStaleImportQuarantine
} from "./import-quarantine-reclaimer.js";
import {
  prepareStarDictWorkerInput,
  waitForStarDictWorkerReady
} from "./stardict-import-controller-io.js";
import {
  STARDICT_WORKER_MESSAGES
} from "./workers/stardict-import-worker-protocol.js";

export function createStarDictImportController({
  runtime = globalThis.chrome?.runtime,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
  quarantine = createOpfsImportQuarantine(),
  reclaimQuarantine = () =>
    reclaimStaleImportQuarantine({ quarantine }),
  onProgress = () => {},
  workerUrl = runtime?.getURL?.(
    "src/options/workers/stardict-import-worker.js"
  )
} = {}) {
  if (!runtime?.sendMessage || !runtime?.getURL) {
    throw new Error(
      "StarDict import controller requires chrome.runtime."
    );
  }
  if (typeof WorkerCtor !== "function") {
    throw new Error(
      "StarDict import controller requires Web Worker support."
    );
  }
  if (typeof onProgress !== "function") {
    throw new Error(
      "StarDict import progress callback must be a function."
    );
  }
  if (!workerUrl) {
    throw new Error(
      "StarDict import worker URL is unavailable."
    );
  }

  let active = null;

  async function importDictionary(input = {}) {
    if (active) {
      throw controllerError(
        "STARDICT_IMPORT_BUSY",
        "Another StarDict import is already running."
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
      await reclaimQuarantine().catch(() => {});
      assertCurrent(current);
      emitProgress(onProgress, requestId, "read");
      const prepared =
        await prepareStarDictWorkerInput(input);
      assertCurrent(current);

      current.phase = "worker";
      const readyPromise =
        waitForStarDictWorkerReady({
          worker,
          requestId,
          onProgress,
          setReject(reject) {
            current.workerReject = reject;
          }
        });

      worker.postMessage(
        {
          type: STARDICT_WORKER_MESSAGES.START,
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
        await quarantine.remove(
          ready.token
        ).catch(() => {});
        throw abortError();
      }
      assertCurrent(current);

      const commitRequestId =
        makeRequestId(cryptoProvider);
      current.phase = "commit";
      current.commitRequestId = commitRequestId;
      emitProgress(
        onProgress,
        requestId,
        "commit",
        { token: ready.token }
      );

      const commit = await runtime.sendMessage({
        type:
          BACKGROUND_MESSAGES.DICTIONARY_LOCAL_IMPORT_COMMIT,
        token: ready.token,
        requestId: commitRequestId
      });
      if (!commit?.ok) {
        throw responseError(
          commit,
          "StarDict dictionary activation failed."
        );
      }
      assertCurrent(current);

      emitProgress(
        onProgress,
        requestId,
        "done",
        {
          packId: ready.packId,
          packVersion: ready.packVersion
        }
      );
      return {
        requestId,
        ready,
        commit
      };
    } finally {
      current.worker?.terminate?.();
      if (active === current) {
        active = null;
      }
    }
  }

  async function cancel({
    hard = false
  } = {}) {
    const current = active;
    if (!current) {
      return {
        cancelled: false,
        phase: ""
      };
    }

    current.cancelRequested = true;

    if (current.phase === "commit") {
      const response = await runtime.sendMessage({
        type:
          BACKGROUND_MESSAGES.DICTIONARY_PACK_CANCEL,
        requestId: current.commitRequestId
      });
      return {
        cancelled: Boolean(response?.cancelled),
        phase: "commit"
      };
    }

    if (current.phase === "worker") {
      if (hard) {
        current.worker?.terminate?.();
        current.workerReject?.(abortError());
      } else {
        current.worker?.postMessage?.({
          type: STARDICT_WORKER_MESSAGES.CANCEL,
          requestId: current.requestId
        });
      }
      return {
        cancelled: true,
        phase: "worker",
        hard
      };
    }

    return {
      cancelled: true,
      phase: "read",
      hard: false
    };
  }

  function dispose() {
    const current = active;
    if (!current) return;
    current.cancelRequested = true;
    current.worker?.terminate?.();
    current.workerReject?.(abortError());
    active = null;
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

  function assertCurrent(current) {
    if (
      active !== current ||
      current.cancelRequested
    ) {
      throw abortError();
    }
  }
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
    onProgress({
      requestId,
      phase,
      ...details
    });
  } catch {
    // Progress observers must never control import correctness.
  }
}

function responseError(response, fallback) {
  return controllerError(
    response?.errorCode || "STARDICT_IMPORT_COMMIT",
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
    "StarDict dictionary import cancelled.",
    "AbortError"
  );
}
