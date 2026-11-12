import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  executeTranslation,
  getTranslationGatewayCapabilities
} from "../src/background/translation-gateway.js";

const config = Object.freeze({
  provider: "deepseek",
  apiKey: "test-key",
  model: "deepseek-flash",
  prompt: "Translate.",
  targetLanguage: "Simplified Chinese"
});

function jsonResponse(translations) { return new Response(JSON.stringify({choices:[{index:0,finish_reason:"stop",message:{content:JSON.stringify({translations})}}]}),{headers:{"Content-Type":"application/json"}}); }

test("gateway exposes final-result capabilities without streaming", () => {
  assert.deepEqual(getTranslationGatewayCapabilities(), {
    completionMode: "final",
    streaming: true,
    partialResults: false
  });
});

test("gateway dispatches through Provider and reports non-invasive lifecycle progress", async () => {
  const originalFetch = globalThis.fetch;
  const events = [];
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    assert.equal(options.signal instanceof AbortSignal, true);
    return jsonResponse([{ id: "1", text: "你好" }]);
  };

  try {
    const result = await executeTranslation({
      segments: [{ id: "1", text: "Hello" }],
      config,
      onProgress(event) {
        events.push(event);
      }
    });

    assert.equal(calls, 1);
    assert.deepEqual(result, [{ id: "1", text: "你好" }]);
    assert.deepEqual(events.map((event) => event.type), ["started", "completed"]);
    assert.equal(events[1].translatedCount, 1);
    assert.equal(Object.isFrozen(events[0]), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("progress observer failures never change translation semantics", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse([{ id: "1", text: "你好" }]);

  try {
    const result = await executeTranslation({
      segments: [{ id: "1", text: "Hello" }],
      config,
      onProgress() {
        throw new Error("observer failure");
      }
    });
    assert.equal(result[0].text, "你好");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gateway propagates AbortSignal cancellation to Provider execution", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const events = [];

  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    if(options.signal.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  try {
    const pending = executeTranslation({
      segments: [{ id: "1", text: "Hello" }],
      config,
      signal: controller.signal,
      onProgress(event) {
        events.push(event);
      }
    });
    controller.abort();

    await assert.rejects(pending, (error) => error?.code === "CANCELLED");
    assert.deepEqual(events.map((event) => event.type), ["started", "cancelled"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("page and subtitle request paths still converge on runTranslationRequest", () => {
  const router = fs.readFileSync(new URL("../src/background/router.js", import.meta.url), "utf8");
  const subtitles = fs.readFileSync(new URL("../src/background/subtitle-requests.js", import.meta.url), "utf8");
  const requests = fs.readFileSync(new URL("../src/background/translation-requests.js", import.meta.url), "utf8");

  assert.match(router, /runTranslationRequest/);
  assert.match(subtitles, /runTranslationRequest/);
  assert.match(requests, /executeTranslation/);
  assert.doesNotMatch(router, /translation-gateway\.js/);
  assert.doesNotMatch(subtitles, /translation-gateway\.js/);
});


test("gateway forwards aggregate Provider streaming progress without exposing raw chunks", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const encoder = new TextEncoder();
  const progress = [];
  globalThis.chrome = {
    permissions: { async contains() { return true; } }
  };
  globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        const payload = '{"translations":[{"id":"1","text":"你好"}]}';
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ index:0, delta: { content: payload } }] })}\n\n`
        ));
        controller.enqueue(encoder.encode('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      }
    }), {headers:{"Content-Type":"text/event-stream"}});

  try {
    const result = await executeTranslation({
      segments: [{ id: "1", text: "Hello" }],
      config: {
        provider: "openai-compatible",
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "",
        model: "demo-model",
        prompt: "Translate.",
        targetLanguage: "Simplified Chinese",
        streaming: true
      },
      onProgress(event) {
        progress.push(event);
      }
    });
    assert.deepEqual(result, [{ id: "1", text: "你好" }]);
    const streamEvent = progress.find((event) => event.type === "streaming");
    assert.equal(streamEvent.receivedChars > 0, true);
    assert.equal(streamEvent.completionMode, "final");
    assert.equal("chunk" in streamEvent, false);
    assert.deepEqual(progress.map((event) => event.type), ["started", "streaming", "completed"]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});
