import {
  CURATED_DICTIONARY_IDS,
  CURATED_IMPORTER_TYPES,
  getCuratedDictionary
} from "../../shared/curated-dictionaries.js";
import {
  extractPinnedEcdictMdx
} from "../../background/packs/importers/ecdict-mdx-zip.js";
import {
  fetchCuratedDictionarySource
} from "../../background/providers/curated-dictionary-network.js";
import {
  CURATED_ECDICT_MDX_WORKER_MESSAGES
} from "./curated-ecdict-mdx-worker-protocol.js";

export function createCuratedEcdictMdxWorkerHandler({
  postMessage,
  network = { fetchSource: fetchCuratedDictionarySource },
  extract = extractPinnedEcdictMdx,
  cryptoProvider = globalThis.crypto
} = {}) {
  if (typeof postMessage !== "function") {
    throw new Error("Curated ECDICT MDX worker requires postMessage.");
  }
  if (typeof network?.fetchSource !== "function" || typeof extract !== "function") {
    throw new Error("Curated ECDICT MDX worker requires its declared network and extractor.");
  }

  let active = null;

  async function handleMessage(message) {
    if (message?.type === CURATED_ECDICT_MDX_WORKER_MESSAGES.CANCEL) {
      return cancel(message.requestId);
    }
    if (message?.type !== CURATED_ECDICT_MDX_WORKER_MESSAGES.START) {
      throw workerError("ECDICT_MDX_WORKER_INPUT", "Unknown curated ECDICT MDX worker message.");
    }

    const requestId = normalizeRequestId(message.requestId);
    if (active) {
      throw workerError("ECDICT_MDX_WORKER_BUSY", "Another curated ECDICT MDX install is already running.");
    }
    if (message.sourceId !== CURATED_DICTIONARY_IDS.ECDICT_EN_ZH_MDX) {
      throw workerError("ECDICT_MDX_SOURCE_UNKNOWN", "ECDICT MDX recipe is not declared by this extension.");
    }
    const source = getCuratedDictionary(message.sourceId);
    if (source?.importerType !== CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1) {
      throw workerError("ECDICT_MDX_SOURCE_UNKNOWN", "ECDICT MDX recipe is not declared by this extension.");
    }

    const controller = new AbortController();
    active = { requestId, controller };
    try {
      emit(postMessage, requestId, "download", {
        inputBytes: 0,
        expectedBytes: source.downloadBytes
      });
      const response = await network.fetchSource(source, {
        signal: controller.signal
      });
      assertActive(controller.signal);

      const file = await extract(response, {
        source,
        signal: controller.signal,
        cryptoProvider,
        onProgress(details = {}) {
          emit(postMessage, requestId, details.phase || "extract", details);
        }
      });
      assertActive(controller.signal);
      if (
        !file || typeof file.slice !== "function" ||
        Number(file.size) !== source.mdx.bytes
      ) {
        throw workerError("ECDICT_MDX_WORKER_OUTPUT", "Pinned ECDICT extractor returned an unexpected MDX file.");
      }

      const result = {
        type: CURATED_ECDICT_MDX_WORKER_MESSAGES.READY,
        requestId,
        sourceId: source.id,
        file,
        metadata: {
          archiveBytes: source.downloadBytes,
          archiveSha256: source.downloadSha256,
          mdxBytes: source.mdx.bytes,
          mdxSha256: source.mdx.sha256,
          upstreamRevision: source.upstreamRevision,
          redirected: Boolean(response?.redirected),
          finalOrigin: response?.url ? new URL(response.url).origin : ""
        }
      };
      postMessage(result);
      return result;
    } catch (error) {
      const payload = {
        type: CURATED_ECDICT_MDX_WORKER_MESSAGES.ERROR,
        requestId,
        error: error?.message || String(error),
        errorName: error?.name || "Error",
        errorCode: error?.code || ""
      };
      postMessage(payload);
      return payload;
    } finally {
      if (active?.requestId === requestId) active = null;
    }
  }

  function cancel(requestId) {
    const id = normalizeRequestId(requestId);
    if (!active || active.requestId !== id) return { cancelled: false };
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

function emit(postMessage, requestId, phase, details = {}) {
  postMessage({
    type: CURATED_ECDICT_MDX_WORKER_MESSAGES.PROGRESS,
    requestId,
    phase,
    ...details
  });
}

function normalizeRequestId(value) {
  const text = String(value || "");
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw workerError("ECDICT_MDX_WORKER_INPUT", "Curated ECDICT MDX worker request ID is invalid.");
  }
  return text;
}

function assertActive(signal) {
  if (signal?.aborted) {
    throw new DOMException("ECDICT MDX download or extraction cancelled.", "AbortError");
  }
}

function workerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
