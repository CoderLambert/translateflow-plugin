import {
  createCuratedDictionaryWorkerHandler
} from "./curated-dictionary-worker-core.js";

const handler = createCuratedDictionaryWorkerHandler({
  postMessage(message) {
    globalThis.postMessage(message);
  }
});

globalThis.addEventListener("message", (event) => {
  handler.handleMessage(event.data).catch((error) => {
    globalThis.postMessage({
      type: "CURATED_DICTIONARY_ERROR",
      requestId: String(event.data?.requestId || ""),
      error: error?.message || String(error),
      errorName: error?.name || "Error",
      errorCode: error?.code || ""
    });
  });
});
