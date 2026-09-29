import {
  makeImportQuarantineToken
} from "../../shared/import-quarantine-contract.js";
import {
  createOpfsImportQuarantine
} from "../../shared/opfs-import-quarantine.js";
import {
  buildMdictLocalTflex
} from "../../background/packs/importers/mdict-local-adapter.js";
import {
  MDICT_WORKER_MESSAGES
} from "./mdict-import-worker-protocol.js";

const STAGE_ORDER = Object.freeze([
  "entries.dat",
  "index.dat",
  "manifest.json"
]);

export function createMdictImportWorkerHandler({
  postMessage,
  quarantine = createOpfsImportQuarantine(),
  cryptoProvider = globalThis.crypto,
  tokenFactory = makeImportQuarantineToken,
  build = buildMdictLocalTflex
} = {}) {
  if (typeof postMessage !== "function") {
    throw new Error("MDict import worker requires postMessage.");
  }
  if (!quarantine) {
    throw new Error("MDict import worker requires quarantine storage.");
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
    if (message?.type === MDICT_WORKER_MESSAGES.CANCEL) {
      return cancel(message.requestId);
    }
    if (message?.type !== MDICT_WORKER_MESSAGES.START) {
      throw new Error("Unknown MDict import worker message.");
    }

    const requestId = normalizeRequestId(message.requestId);
    if (active) {
      throw workerError(
        "MDICT_WORKER_BUSY",
        "Another MDict import is already running."
      );
    }

    const controller = new AbortController();
    active = { requestId, controller };
    let token = "";
    let ownsToken = false;

    try {
      const input = validateStartInput(message.input);
      token = tokenFactory();
      await assertFreshToken(quarantine, token);
      ownsToken = true;
      emitProgress(postMessage, requestId, "convert");

      const built = await build({
        mdxBytes: input.mdxBytes,
        recipe: input.recipe,
        signal: controller.signal,
        cryptoProvider
      });
      assertActive(controller.signal);

      for (const path of STAGE_ORDER) {
        const bytes = built?.files?.[path];
        if (!(bytes instanceof Uint8Array)) {
          throw workerError(
            "MDICT_WORKER_OUTPUT",
            "MDict worker build did not produce exact TFLex bytes."
          );
        }
        emitProgress(postMessage, requestId, "stage", { path });
        await quarantine.writeFile(token, path, bytes);
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
          "MDICT_WORKER_STAGE",
          "MDict quarantine staging did not persist exact TFLex files."
        );
      }

      const result = {
        type: MDICT_WORKER_MESSAGES.READY,
        requestId,
        token,
        packId: built.manifest.packId,
        packVersion: built.manifest.packVersion,
        fingerprint: built.manifest.fingerprint,
        metrics: built.metrics
      };
      postMessage(result);
      token = "";
      return result;
    } catch (error) {
      if (token && ownsToken) {
        await quarantine.remove(token).catch(() => {});
      }
      const payload = {
        type: MDICT_WORKER_MESSAGES.ERROR,
        requestId,
        ...serializeError(error)
      };
      postMessage(payload);
      return payload;
    } finally {
      if (active?.requestId === requestId) active = null;
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
    Array.isArray(input) ||
    !input.mdxBytes ||
    !input.recipe
  ) {
    throw workerError(
      "MDICT_WORKER_INPUT",
      "MDict import worker input is invalid."
    );
  }
  return input;
}

async function assertFreshToken(quarantine, token) {
  const existing = await quarantine.listTokens();
  if (existing.includes(token)) {
    throw workerError(
      "MDICT_WORKER_TOKEN_COLLISION",
      "Generated import quarantine token already exists."
    );
  }
}

function emitProgress(postMessage, requestId, phase, details = {}) {
  postMessage({
    type: MDICT_WORKER_MESSAGES.PROGRESS,
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
      "MDICT_WORKER_INPUT",
      "MDict import worker requestId is invalid."
    );
  }
  return text;
}

function assertActive(signal) {
  if (!signal?.aborted) return;
  throw new DOMException(
    "MDict dictionary import cancelled.",
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
