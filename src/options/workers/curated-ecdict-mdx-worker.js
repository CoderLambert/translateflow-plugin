import {
  createCuratedEcdictMdxWorkerHandler
} from "./curated-ecdict-mdx-worker-core.js";

const handler = createCuratedEcdictMdxWorkerHandler({
  postMessage(message) {
    self.postMessage(message);
  }
});

self.addEventListener("message", (event) => {
  Promise.resolve(handler.handleMessage(event.data)).catch((error) => {
    self.postMessage({
      type: "curated-ecdict-mdx:error",
      requestId: event.data?.requestId || "",
      error: error?.message || String(error),
      errorName: error?.name || "Error",
      errorCode: error?.code || ""
    });
  });
});
