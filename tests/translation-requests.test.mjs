import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTranslationRequestKey,
  cancelTranslationRequest,
  runTranslationRequest
} from "../src/background/translation-requests.js";

function delayedTranslationResponse(signal, delayMs = 20) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        async text() {
          return JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  translations: [{ id: "1", text: "你好" }]
                })
              }
            }]
          });
        }
      });
    }, delayMs);

    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
}

const config = Object.freeze({
  provider: "deepseek",
  apiKey: "test-key",
  model: "deepseek-flash",
  prompt: "Translate.",
  targetLanguage: "Simplified Chinese"
});

const segments = Object.freeze([{ id: "1", text: "Hello" }]);

test("request key changes when effective translation behavior changes", () => {
  const a = buildTranslationRequestKey(segments, config);
  const b = buildTranslationRequestKey(segments, { ...config, model: "other-model" });
  assert.notEqual(a, b);
});

test("identical in-flight requests share one provider call", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (_url, options) => {
    calls += 1;
    return delayedTranslationResponse(options.signal);
  };

  try {
    const [a, b] = await Promise.all([
      runTranslationRequest({ requestId: "coalesce-a", segments, config }),
      runTranslationRequest({ requestId: "coalesce-b", segments, config })
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
    assert.equal(a[0].text, "你好");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cancelling one shared consumer does not abort the remaining consumer", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (_url, options) => {
    calls += 1;
    return delayedTranslationResponse(options.signal, 30);
  };

  try {
    const first = runTranslationRequest({
      requestId: "shared-cancel-a",
      segments,
      config
    });
    const second = runTranslationRequest({
      requestId: "shared-cancel-b",
      segments,
      config
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(cancelTranslationRequest("shared-cancel-a").cancelled, true);

    await assert.rejects(first, (error) => error?.code === "CANCELLED");
    const result = await second;

    assert.equal(calls, 1);
    assert.equal(result[0].text, "你好");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
