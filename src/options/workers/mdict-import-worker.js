import {
  createMdictImportWorkerHandler
} from "./mdict-import-worker-core.js";

const handler = createMdictImportWorkerHandler({
  postMessage: (message) => globalThis.postMessage(message)
});

globalThis.addEventListener("message", (event) => {
  Promise.resolve(
    handler.handleMessage(event.data)
  ).catch((error) => {
    globalThis.postMessage({
      type: "mdict-import:error",
      requestId: String(event?.data?.requestId || ""),
      error: error?.message || String(error),
      errorName: error?.name || "Error",
      errorCode: error?.code || ""
    });
  });
});
