import test from "node:test";
import assert from "node:assert/strict";
import {
  CURATED_DICTIONARY_IDS,
  getCuratedDictionary
} from "../src/shared/curated-dictionaries.js";
import { createCuratedEcdictMdxWorkerHandler } from "../src/options/workers/curated-ecdict-mdx-worker-core.js";
import { CURATED_ECDICT_MDX_WORKER_MESSAGES as MESSAGE } from "../src/options/workers/curated-ecdict-mdx-worker-protocol.js";

const source = getCuratedDictionary(CURATED_DICTIONARY_IDS.ECDICT_EN_ZH_MDX);

test("MDX worker download failure never returns a file or READY result", async () => {
  const posted = [];
  let extractionStarted = false;
  const handler = createCuratedEcdictMdxWorkerHandler({
    postMessage: (message) => posted.push(message),
    network: {
      async fetchSource() {
        throw Object.assign(new Error("upstream returned HTTP 503"), {
          code: "ECDICT_DOWNLOAD"
        });
      }
    },
    extract: async () => {
      extractionStarted = true;
      return fakeFile();
    }
  });

  const result = await handler.handleMessage(startMessage("mdx-download-failure"));

  assert.equal(result.type, MESSAGE.ERROR);
  assert.equal(result.errorCode, "ECDICT_DOWNLOAD");
  assert.equal(extractionStarted, false);
  assert.equal(posted.some((message) => message.type === MESSAGE.READY), false);
  assert.equal(handler.activeRequestId, "");
});

test("MDX worker cancellation during download aborts the request and returns no file", async () => {
  const posted = [];
  let downloadStarted;
  const started = new Promise((resolve) => { downloadStarted = resolve; });
  const handler = createCuratedEcdictMdxWorkerHandler({
    postMessage: (message) => posted.push(message),
    network: {
      async fetchSource(_source, { signal }) {
        downloadStarted();
        await new Promise((resolve, reject) => {
          const abort = () => reject(new DOMException("download cancelled", "AbortError"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
        return { ok: true };
      }
    },
    extract: async () => fakeFile()
  });

  const installing = handler.handleMessage(startMessage("mdx-download-cancel"));
  await started;
  assert.deepEqual(handler.cancel("mdx-download-cancel"), { cancelled: true });
  const result = await installing;

  assert.equal(result.type, MESSAGE.ERROR);
  assert.equal(result.errorName, "AbortError");
  assert.equal(posted.some((message) => message.type === MESSAGE.READY), false);
  assert.equal(handler.activeRequestId, "");
});

test("MDX worker cancellation during extraction returns no candidate file", async () => {
  const posted = [];
  let extractionStarted;
  const started = new Promise((resolve) => { extractionStarted = resolve; });
  const handler = createCuratedEcdictMdxWorkerHandler({
    postMessage: (message) => posted.push(message),
    network: {
      async fetchSource() {
        return {
          ok: true,
          status: 200,
          url: "https://release-assets.githubusercontent.com/release/reviewed.zip"
        };
      }
    },
    extract: async (_response, { signal }) => {
      extractionStarted();
      await new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("extraction cancelled", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      return fakeFile();
    }
  });

  const installing = handler.handleMessage(startMessage("mdx-extract-cancel"));
  await started;
  assert.deepEqual(handler.cancel("mdx-extract-cancel"), { cancelled: true });
  const result = await installing;

  assert.equal(result.type, MESSAGE.ERROR);
  assert.equal(result.errorName, "AbortError");
  assert.equal(posted.some((message) => message.type === MESSAGE.READY), false);
  assert.equal(handler.activeRequestId, "");
});

test("MDX worker returns only the verified MDX File to the local installer", async () => {
  const posted = [];
  let downloadArguments;
  let extractionArguments;
  const file = fakeFile();
  const handler = createCuratedEcdictMdxWorkerHandler({
    postMessage: (message) => posted.push(message),
    network: {
      async fetchSource(value, options) {
        downloadArguments = { value, options };
        return {
          ok: true,
          status: 200,
          redirected: true,
          url: "https://release-assets.githubusercontent.com/release/reviewed.zip"
        };
      }
    },
    extract: async (response, options) => {
      extractionArguments = { response, options };
      return file;
    }
  });

  const result = await handler.handleMessage(startMessage("mdx-success"));

  assert.equal(result.type, MESSAGE.READY);
  assert.equal(result.file, file);
  assert.equal(result.sourceId, source.id);
  assert.equal(downloadArguments.value, source);
  assert.ok(downloadArguments.options.signal instanceof AbortSignal);
  assert.equal(extractionArguments.options.source, source);
  assert.equal(result.metadata.archiveSha256, source.downloadSha256);
  assert.equal(result.metadata.mdxSha256, source.mdx.sha256);
  assert.equal(result.metadata.finalOrigin, "https://release-assets.githubusercontent.com");
  assert.equal(posted.filter((message) => message.type === MESSAGE.READY).length, 1);
});

test("MDX worker rejects any recipe other than the extension-declared ECDICT ID", async () => {
  const handler = createCuratedEcdictMdxWorkerHandler({
    postMessage() {},
    network: { async fetchSource() { throw new Error("network must not run"); } },
    extract: async () => fakeFile()
  });
  await assert.rejects(
    handler.handleMessage({
      ...startMessage("mdx-unknown-source"),
      sourceId: "https://evil.invalid/recipe"
    }),
    /not declared by this extension/u
  );
});

function startMessage(requestId) {
  return {
    type: MESSAGE.START,
    requestId,
    sourceId: source.id
  };
}

function fakeFile() {
  return {
    name: source.mdx.fileName,
    size: source.mdx.bytes,
    slice() { return this; }
  };
}
