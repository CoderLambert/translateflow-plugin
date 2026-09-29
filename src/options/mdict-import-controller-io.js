import {
  MDICT_IMPORT_LIMITS
} from "../background/packs/importers/mdict-contract.js";
import {
  MDICT_WORKER_MESSAGES
} from "./workers/mdict-import-worker-protocol.js";

export async function prepareMdictWorkerInput({
  mdxFile,
  recipe
}) {
  assertBlob(mdxFile);
  if (
    !Number.isSafeInteger(mdxFile.size) ||
    mdxFile.size <= 0 ||
    mdxFile.size > MDICT_IMPORT_LIMITS.fileBytes
  ) {
    throw ioError(
      "MDICT_IMPORT_LIMIT",
      "MDX file exceeds the import safety limit."
    );
  }

  const mdxBytes = await mdxFile.arrayBuffer();
  return {
    input: { mdxBytes, recipe },
    transfer: [mdxBytes]
  };
}

export function waitForMdictWorkerReady({
  worker,
  requestId,
  onProgress,
  setReject
}) {
  return new Promise((resolve, reject) => {
    setReject?.(reject);
    const cleanup = () => {
      worker.removeEventListener?.("message", onMessage);
      worker.removeEventListener?.("error", onError);
    };
    const onMessage = (event) => {
      const message = event?.data;
      if (message?.requestId !== requestId) return;
      if (message.type === MDICT_WORKER_MESSAGES.PROGRESS) {
        try {
          onProgress?.({
            requestId,
            phase: message.phase,
            ...(message.path ? { path: message.path } : {})
          });
        } catch {}
        return;
      }
      if (message.type === MDICT_WORKER_MESSAGES.READY) {
        cleanup();
        resolve(message);
        return;
      }
      if (message.type === MDICT_WORKER_MESSAGES.ERROR) {
        cleanup();
        reject(workerResponseError(message));
      }
    };
    const onError = (event) => {
      cleanup();
      reject(
        ioError(
          "MDICT_WORKER_FAILURE",
          event?.message || "MDict import Worker failed."
        )
      );
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  });
}

function assertBlob(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    typeof value.arrayBuffer !== "function"
  ) {
    throw ioError(
      "MDICT_IMPORT_INPUT",
      "MDX file is invalid."
    );
  }
}

function workerResponseError(message) {
  const error = ioError(
    message?.errorCode || "MDICT_WORKER_FAILURE",
    message?.error || "MDict import Worker failed."
  );
  error.name = message?.errorName || error.name;
  return error;
}

function ioError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
