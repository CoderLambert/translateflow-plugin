import {
  makeImportQuarantineToken
} from "../../shared/import-quarantine-contract.js";
import {
  createOpfsImportQuarantine
} from "../../shared/opfs-import-quarantine.js";
import {
  acquireImportQuarantineLease
} from "../../shared/import-quarantine-lock.js";
import {
  buildStarDictDictzipLocalTflex,
  buildStarDictPlainLocalTflex
} from "../../background/packs/importers/stardict-local-adapter.js";
import {
  STARDICT_WORKER_MESSAGES
} from "./stardict-import-worker-protocol.js";

export { STARDICT_WORKER_MESSAGES };

const STAGE_ORDER = Object.freeze([
  "entries.dat",
  "index.dat",
  "manifest.json"
]);

export function createStarDictImportWorkerHandler({
  postMessage,
  quarantine = createOpfsImportQuarantine(),
  cryptoProvider = globalThis.crypto,
  lockManager = globalThis.navigator?.locks,
  tokenFactory = makeImportQuarantineToken,
  buildPlain = buildStarDictPlainLocalTflex,
  buildDictzip = buildStarDictDictzipLocalTflex
} = {}) {
  if (typeof postMessage !== "function") {
    throw new Error(
      "StarDict import worker requires postMessage."
    );
  }
  if (!quarantine) {
    throw new Error(
      "StarDict import worker requires quarantine storage."
    );
  }

  let active = null;

  function cancel(requestId) {
    const id = normalizeRequestId(requestId);
    if (!active || active.requestId !== id) {
      return { cancelled: false };
    }
    active.controller.abort();
    return { cancelled: true };
  }

  async function handleMessage(message) {
    if (message?.type === STARDICT_WORKER_MESSAGES.CANCEL) {
      return cancel(message.requestId);
    }
    if (message?.type !== STARDICT_WORKER_MESSAGES.START) {
      throw new Error("Unknown StarDict import worker message.");
    }

    const requestId = normalizeRequestId(
      message.requestId
    );
    if (active) {
      throw workerError(
        "STARDICT_WORKER_BUSY",
        "Another StarDict import is already running."
      );
    }

    const controller = new AbortController();
    active = { requestId, controller };
    let token = "";
    let ownsToken = false;
    let lease = null;

    try {
      const input = validateStartInput(message.input);
      token = tokenFactory();
      await assertFreshToken(quarantine, token);
      lease = await acquireImportQuarantineLease(
        token,
        { lockManager }
      );
      ownsToken = true;
      emitProgress(postMessage, requestId, "convert");

      const built = input.format === "dictzip"
        ? await buildDictzip({
          ifoBytes: input.ifoBytes,
          idxBytes: input.idxBytes,
          dictzipBlob: input.dictzipBlob,
          synBytes: input.synBytes,
          recipe: input.recipe,
          signal: controller.signal,
          cryptoProvider
        })
        : await buildPlain({
          ifoBytes: input.ifoBytes,
          idxBytes: input.idxBytes,
          dictBytes: input.dictBytes,
          synBytes: input.synBytes,
          recipe: input.recipe,
          signal: controller.signal,
          cryptoProvider
        });

      assertActive(controller.signal);

      for (const path of STAGE_ORDER) {
        const bytes = built?.files?.[path];
        if (!(bytes instanceof Uint8Array)) {
          throw workerError(
            "STARDICT_WORKER_OUTPUT",
            "StarDict worker build did not produce exact TFLex bytes."
          );
        }
        emitProgress(
          postMessage,
          requestId,
          "stage",
          { path }
        );
        await quarantine.writeFile(
          token,
          path,
          bytes
        );
        assertActive(controller.signal);
      }

      const listed = await quarantine.listFiles(token);
      if (
        listed.length !== STAGE_ORDER.length ||
        STAGE_ORDER.some(
          (path) => !listed.some(
            (item) =>
              item.path === path &&
              item.size === built.files[path].byteLength
          )
        )
      ) {
        throw workerError(
          "STARDICT_WORKER_STAGE",
          "StarDict quarantine staging did not persist the exact TFLex files."
        );
      }

      const result = {
        type: STARDICT_WORKER_MESSAGES.READY,
        requestId,
        token,
        packId: built.manifest.packId,
        packVersion: built.manifest.packVersion,
        fingerprint: built.manifest.fingerprint,
        sourceEntryCount:
          built.manifest.sourceEntryCount,
        sourceAliasCount:
          built.manifest.sourceAliasCount || 0,
        ...(built.compression
          ? { compression: built.compression }
          : {})
      };
      postMessage(result);
      token = "";
      return result;
    } catch (error) {
      if (token && ownsToken) {
        await quarantine.remove(token).catch(() => {});
      }
      const payload = {
        type: STARDICT_WORKER_MESSAGES.ERROR,
        requestId,
        ...serializeError(error)
      };
      postMessage(payload);
      return payload;
    } finally {
      lease?.release?.();
      if (active?.requestId === requestId) {
        active = null;
      }
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

function validateStartInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw workerError(
      "STARDICT_WORKER_INPUT",
      "StarDict import worker input is invalid."
    );
  }
  if (!["plain", "dictzip"].includes(input.format)) {
    throw workerError(
      "STARDICT_WORKER_INPUT",
      "StarDict import worker format must be plain or dictzip."
    );
  }
  if (!input.recipe || typeof input.recipe !== "object") {
    throw workerError(
      "STARDICT_WORKER_INPUT",
      "StarDict import worker recipe is required."
    );
  }
  if (
    input.format === "plain" &&
    input.dictBytes === undefined
  ) {
    throw workerError(
      "STARDICT_WORKER_INPUT",
      "Plain StarDict import requires dictBytes."
    );
  }
  if (
    input.format === "dictzip" &&
    !input.dictzipBlob
  ) {
    throw workerError(
      "STARDICT_WORKER_INPUT",
      "Dictzip StarDict import requires a Blob/File."
    );
  }
  return input;
}

async function assertFreshToken(quarantine, token) {
  const existing = await quarantine.listTokens();
  if (existing.includes(token)) {
    throw workerError(
      "STARDICT_WORKER_TOKEN_COLLISION",
      "Generated import quarantine token already exists."
    );
  }
}

function emitProgress(
  postMessage,
  requestId,
  phase,
  details = {}
) {
  postMessage({
    type: STARDICT_WORKER_MESSAGES.PROGRESS,
    requestId,
    phase,
    ...details
  });
}

function normalizeRequestId(value) {
  const text = String(value || "");
  if (
    !text ||
    text.length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(text)
  ) {
    throw workerError(
      "STARDICT_WORKER_INPUT",
      "StarDict import worker requestId is invalid."
    );
  }
  return text;
}

function assertActive(signal) {
  if (!signal?.aborted) return;
  throw new DOMException(
    "StarDict dictionary import cancelled.",
    "AbortError"
  );
}

function workerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function serializeError(error) {
  return {
    error: error?.message || String(error),
    errorName: error?.name || "Error",
    errorCode: error?.code || ""
  };
}
