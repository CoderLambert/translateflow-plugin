import {
  BACKGROUND_MESSAGES
} from "../shared/constants.js";
import {
  STARDICT_IMPORT_LIMITS
} from "../background/packs/importers/stardict-contract.js";
import {
  STARDICT_WORKER_MESSAGES
} from "./workers/stardict-import-worker-protocol.js";

export function createStarDictImportController({
  runtime = globalThis.chrome?.runtime,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
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

  async function importDictionary({
    format,
    ifoFile,
    idxFile,
    dictFile,
    synFile,
    recipe
  } = {}) {
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
      emitProgress(
        onProgress,
        requestId,
        "read"
      );
      const prepared = await prepareWorkerInput({
        format,
        ifoFile,
        idxFile,
        dictFile,
        synFile,
        recipe
      });
      assertCurrent(current);

      current.phase = "worker";
      const readyPromise = waitForWorkerReady({
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

async function prepareWorkerInput({
  format,
  ifoFile,
  idxFile,
  dictFile,
  synFile,
  recipe
}) {
  if (!["plain", "dictzip"].includes(format)) {
    throw controllerError(
      "STARDICT_IMPORT_INPUT",
      "StarDict format must be plain or dictzip."
    );
  }
  assertBlob(ifoFile, "IFO");
  assertBlob(idxFile, "IDX");
  assertBlob(dictFile, format === "dictzip"
    ? "DICT.DZ"
    : "DICT");
  if (synFile !== undefined && synFile !== null) {
    assertBlob(synFile, "SYN");
  }

  assertSize(
    ifoFile.size,
    STARDICT_IMPORT_LIMITS.ifoBytes,
    "IFO"
  );
  assertSize(
    idxFile.size,
    STARDICT_IMPORT_LIMITS.idxBytes,
    "IDX"
  );
  assertSize(
    dictFile.size,
    format === "dictzip"
      ? STARDICT_IMPORT_LIMITS.dictArchiveBytes
      : STARDICT_IMPORT_LIMITS.dictBytes,
    format === "dictzip" ? "DICT.DZ" : "DICT"
  );
  if (synFile) {
    assertSize(
      synFile.size,
      STARDICT_IMPORT_LIMITS.synBytes,
      "SYN"
    );
  }

  const [ifoBytes, idxBytes, synBytes] =
    await Promise.all([
      ifoFile.arrayBuffer(),
      idxFile.arrayBuffer(),
      synFile
        ? synFile.arrayBuffer()
        : Promise.resolve(null)
    ]);

  const transfer = [
    ifoBytes,
    idxBytes,
    ...(synBytes ? [synBytes] : [])
  ];
  const input = {
    format,
    ifoBytes,
    idxBytes,
    ...(synBytes
      ? { synBytes }
      : {}),
    recipe
  };

  if (format === "plain") {
    const dictBytes = await dictFile.arrayBuffer();
    input.dictBytes = dictBytes;
    transfer.push(dictBytes);
  } else {
    input.dictzipBlob = dictFile;
  }

  return {
    input,
    transfer
  };
}

function waitForWorkerReady({
  worker,
  requestId,
  onProgress,
  setReject
}) {
  return new Promise((resolve, reject) => {
    setReject(reject);

    const cleanup = () => {
      worker.removeEventListener?.(
        "message",
        onMessage
      );
      worker.removeEventListener?.(
        "error",
        onError
      );
    };

    const onMessage = (event) => {
      const message = event?.data;
      if (message?.requestId !== requestId) {
        return;
      }
      if (
        message.type ===
        STARDICT_WORKER_MESSAGES.PROGRESS
      ) {
        emitProgress(
          onProgress,
          requestId,
          message.phase,
          {
            ...(message.path
              ? { path: message.path }
              : {})
          }
        );
        return;
      }
      if (
        message.type ===
        STARDICT_WORKER_MESSAGES.READY
      ) {
        cleanup();
        resolve(message);
        return;
      }
      if (
        message.type ===
        STARDICT_WORKER_MESSAGES.ERROR
      ) {
        cleanup();
        reject(workerResponseError(message));
      }
    };

    const onError = (event) => {
      cleanup();
      reject(
        controllerError(
          "STARDICT_WORKER_FAILURE",
          event?.message ||
            "StarDict import Worker failed."
        )
      );
    };

    worker.addEventListener(
      "message",
      onMessage
    );
    worker.addEventListener(
      "error",
      onError
    );
  });
}

function assertBlob(value, label) {
  if (
    !value ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    typeof value.arrayBuffer !== "function"
  ) {
    throw controllerError(
      "STARDICT_IMPORT_INPUT",
      label + " file is invalid."
    );
  }
}

function assertSize(actual, maximum, label) {
  if (
    !Number.isSafeInteger(actual) ||
    actual <= 0 ||
    actual > maximum
  ) {
    throw controllerError(
      "STARDICT_IMPORT_LIMIT",
      label + " file exceeds the import safety limit."
    );
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
  onProgress({
    requestId,
    phase,
    ...details
  });
}

function responseError(response, fallback) {
  return controllerError(
    response?.errorCode || "STARDICT_IMPORT_COMMIT",
    response?.error || fallback
  );
}

function workerResponseError(message) {
  const error = controllerError(
    message?.errorCode || "STARDICT_WORKER_FAILURE",
    message?.error || "StarDict import Worker failed."
  );
  error.name =
    message?.errorName || error.name;
  return error;
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
