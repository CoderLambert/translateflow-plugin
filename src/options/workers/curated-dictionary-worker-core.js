import {
  getCuratedDictionary
} from "../../shared/curated-dictionaries.js";
import {
  makeImportQuarantineToken
} from "../../shared/import-quarantine-contract.js";
import {
  createOpfsImportQuarantine
} from "../../shared/opfs-import-quarantine.js";
import {
  buildEcdictCuratedLocalTflex
} from "../../background/packs/importers/ecdict-local-adapter.js";
import {
  fetchCuratedDictionarySource
} from "../../background/providers/curated-dictionary-network.js";
import {
  responseByteChunks
} from "../../background/packs/importers/ecdict-csv.js";
import {
  CURATED_WORKER_MESSAGES
} from "./curated-dictionary-worker-protocol.js";

const STAGE_ORDER = Object.freeze([
  "entries.dat",
  "index.dat",
  "manifest.json"
]);

export function createCuratedDictionaryWorkerHandler({
  postMessage,
  quarantine = createOpfsImportQuarantine(),
  network = {
    fetchSource: fetchCuratedDictionarySource
  },
  cryptoProvider = globalThis.crypto,
  tokenFactory = makeImportQuarantineToken
} = {}) {
  if (typeof postMessage !== "function") {
    throw new Error("Curated dictionary worker requires postMessage.");
  }
  if (typeof network?.fetchSource !== "function") {
    throw new Error(
      "Curated dictionary worker requires a network provider."
    );
  }

  let active = null;

  async function handleMessage(message) {
    if (message?.type === CURATED_WORKER_MESSAGES.CANCEL) {
      return cancel(message.requestId);
    }
    if (message?.type !== CURATED_WORKER_MESSAGES.START) {
      throw new Error("Unknown curated dictionary worker message.");
    }

    const requestId = normalizeRequestId(message.requestId);
    if (active) {
      throw workerError(
        "CURATED_WORKER_BUSY",
        "Another curated dictionary install is already running."
      );
    }

    const source = getCuratedDictionary(message.sourceId);
    if (!source) {
      throw workerError(
        "CURATED_SOURCE_UNKNOWN",
        "Curated dictionary source is not declared by this extension."
      );
    }

    const controller = new AbortController();
    active = { requestId, controller };
    let token = "";
    let ownsToken = false;

    try {
      emit(postMessage, requestId, "download", {
        inputBytes: 0,
        expectedBytes: source.downloadBytes
      });

      const response = await network.fetchSource(source, {
        signal: controller.signal
      });
      validateResponse(response, source);

      token = tokenFactory();
      await assertFreshToken(quarantine, token);
      ownsToken = true;

      const built = await buildEcdictCuratedLocalTflex({
        chunks: responseByteChunks(response, {
          signal: controller.signal
        }),
        source,
        signal: controller.signal,
        cryptoProvider,
        onProgress(details) {
          emit(postMessage, requestId, details.phase, details);
        }
      });
      assertActive(controller.signal);

      emit(postMessage, requestId, "convert", {
        retainedRecords:
          built.projection.stats.retainedRecords
      });

      for (const path of STAGE_ORDER) {
        const bytes = built.files?.[path];
        if (!(bytes instanceof Uint8Array)) {
          throw workerError(
            "CURATED_WORKER_OUTPUT",
            "Curated dictionary build did not produce exact TFLex bytes."
          );
        }
        emit(postMessage, requestId, "stage", { path });
        await quarantine.writeFile(token, path, bytes);
        assertActive(controller.signal);
      }

      const listed = await quarantine.listFiles(token);
      if (
        listed.length !== STAGE_ORDER.length ||
        STAGE_ORDER.some((path) =>
          !listed.some((item) =>
            item.path === path &&
            item.size === built.files[path].byteLength
          )
        )
      ) {
        throw workerError(
          "CURATED_WORKER_STAGE",
          "Curated dictionary quarantine staging is incomplete."
        );
      }

      const outputBytes = STAGE_ORDER.reduce(
        (sum, path) => sum + built.files[path].byteLength,
        0
      );
      const result = {
        type: CURATED_WORKER_MESSAGES.READY,
        requestId,
        token,
        packId: built.manifest.packId,
        packVersion: built.manifest.packVersion,
        fingerprint: built.manifest.fingerprint,
        stats: {
          ...built.projection.stats,
          outputBytes
        }
      };
      postMessage(result);
      token = "";
      return result;
    } catch (error) {
      if (token && ownsToken) {
        await quarantine.remove(token).catch(() => {});
      }
      const payload = {
        type: CURATED_WORKER_MESSAGES.ERROR,
        requestId,
        error: error?.message || String(error),
        errorName: error?.name || "Error",
        errorCode: error?.code || ""
      };
      postMessage(payload);
      return payload;
    } finally {
      if (active?.requestId === requestId) {
        active = null;
      }
    }
  }

  function cancel(requestId) {
    const id = normalizeRequestId(requestId);
    if (!active || active.requestId !== id) {
      return { cancelled: false };
    }
    active.controller.abort();
    return { cancelled: true };
  }

  return Object.freeze({
    handleMessage,
    cancel,
    get activeRequestId() {
      return active?.requestId || "";
    }
  });
}

function validateResponse(response, source) {
  if (!response?.ok) {
    throw workerError(
      "CURATED_DOWNLOAD",
      `ECDICT download failed with HTTP ${response?.status || "error"}.`
    );
  }
  if (response.url && response.url !== source.downloadUrl) {
    throw workerError(
      "CURATED_DOWNLOAD_REDIRECT",
      "Curated dictionary download did not remain on the locked artifact URL."
    );
  }
  const length = Number(
    response.headers?.get?.("content-length")
  );
  if (
    Number.isFinite(length) &&
    length > 0 &&
    length !== source.downloadBytes
  ) {
    throw workerError(
      "CURATED_DOWNLOAD_SIZE",
      `ECDICT content length mismatch: expected ${source.downloadBytes}, got ${length}.`
    );
  }
}

async function assertFreshToken(quarantine, token) {
  const existing = await quarantine.listTokens();
  if (existing.includes(token)) {
    throw workerError(
      "CURATED_WORKER_TOKEN_COLLISION",
      "Generated import quarantine token already exists."
    );
  }
}

function emit(postMessage, requestId, phase, details = {}) {
  postMessage({
    type: CURATED_WORKER_MESSAGES.PROGRESS,
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
      "CURATED_WORKER_INPUT",
      "Curated dictionary worker requestId is invalid."
    );
  }
  return text;
}

function assertActive(signal) {
  if (!signal?.aborted) return;
  throw new DOMException(
    "Curated dictionary install cancelled.",
    "AbortError"
  );
}

function workerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
