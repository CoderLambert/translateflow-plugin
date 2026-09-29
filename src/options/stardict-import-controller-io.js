import {
  STARDICT_IMPORT_LIMITS
} from "../background/packs/importers/stardict-contract.js";
import {
  STARDICT_WORKER_MESSAGES
} from "./workers/stardict-import-worker-protocol.js";

export async function prepareStarDictWorkerInput({
  format,
  ifoFile,
  idxFile,
  dictFile,
  synFile,
  recipe
}) {
  if (!["plain", "dictzip"].includes(format)) {
    throw ioError(
      "STARDICT_IMPORT_INPUT",
      "StarDict format must be plain or dictzip."
    );
  }
  assertBlob(ifoFile, "IFO");
  assertBlob(idxFile, "IDX");
  assertBlob(
    dictFile,
    format === "dictzip" ? "DICT.DZ" : "DICT"
  );
  if (
    format === "dictzip" &&
    (
      typeof dictFile.slice !== "function" ||
      typeof dictFile.stream !== "function"
    )
  ) {
    throw ioError(
      "STARDICT_IMPORT_INPUT",
      "DICT.DZ file must support Blob streaming."
    );
  }
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
    ...(synBytes ? { synBytes } : {}),
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

export function waitForStarDictWorkerReady({
  worker,
  requestId,
  onProgress,
  setReject
}) {
  return new Promise((resolve, reject) => {
    setReject?.(reject);

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
        onProgress?.({
          requestId,
          phase: message.phase,
          ...(message.path
            ? { path: message.path }
            : {})
        });
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
        ioError(
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
    throw ioError(
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
    throw ioError(
      "STARDICT_IMPORT_LIMIT",
      label + " file exceeds the import safety limit."
    );
  }
}

function workerResponseError(message) {
  const error = ioError(
    message?.errorCode || "STARDICT_WORKER_FAILURE",
    message?.error || "StarDict import Worker failed."
  );
  error.name =
    message?.errorName || error.name;
  return error;
}

function ioError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
