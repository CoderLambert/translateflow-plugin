import test from "node:test";
import assert from "node:assert/strict";
import {
  isUnsupportedStreamingError,
  requestChatCompletionsStream
} from "../src/background/providers/openai-sse.js";
import { openAICompatibleProvider } from "../src/background/providers/openai-compatible.js";

const encoder = new TextEncoder();

function makeHeaders(values = {}) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    get(name) {
      return normalized[String(name || "").toLowerCase()] ?? null;
    }
  };
}

function sseResponse(chunks) {
  return {
    ok: true,
    status: 200,
    headers: makeHeaders({ "content-type": "text/event-stream" }),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    }),
    async text() {
      return chunks.join("");
    }
  };
}

function jsonResponse(status, payload) {
  const raw = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: makeHeaders({ "content-type": "application/json" }),
    body: null,
    async text() {
      return raw;
    }
  };
}

function buildWire(content) {
  const cuts = [0, Math.ceil(content.length / 3), Math.ceil(content.length * 2 / 3), content.length];
  const events = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const piece = content.slice(cuts[index], cuts[index + 1]);
    events.push(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
  }
  return events.join("") + "data: [DONE]\n\n";
}

const streamRequest = {
  url: "https://api.example.com/v1/chat/completions",
  apiKey: "",
  providerLabel: "OpenAI-compatible",
  requireApiKey: false,
  body: { model: "demo-model", messages: [] }
};

test("SSE reader assembles content across arbitrary byte boundaries and DONE", async () => {
  const originalFetch = globalThis.fetch;
  const progress = [];
  const expected = '{"translations":[{"id":"1","text":"你好"}]}';
  const wire = buildWire(expected);
  const points = [2, 11, 29, 47, wire.length - 5];
  let start = 0;
  const chunks = [];
  for (const point of points) {
    chunks.push(wire.slice(start, point));
    start = point;
  }
  chunks.push(wire.slice(start));

  globalThis.fetch = async () => sseResponse(chunks);
  try {
    const data = await requestChatCompletionsStream({
      ...streamRequest,
      onProgress(event) {
        progress.push(event);
      }
    });
    assert.equal(data.choices[0].message.content, expected);
    assert.equal(progress.at(-1).receivedChars, expected.length);
    assert.equal(progress.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SSE reader supports multiple data events in one transport chunk", async () => {
  const originalFetch = globalThis.fetch;
  const expected = '{"translations":[]}';
  globalThis.fetch = async () => sseResponse([buildWire(expected)]);
  try {
    const data = await requestChatCompletionsStream(streamRequest);
    assert.equal(data.choices[0].message.content, expected);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SSE parser rejects malformed data events and premature EOF", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => sseResponse(["data: {not-json}\n\n"]);
    await assert.rejects(
      requestChatCompletionsStream(streamRequest),
      (error) => error?.code === "MALFORMED_RESPONSE" && /有效 JSON/.test(error.message)
    );

    globalThis.fetch = async () => sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`
    ]);
    await assert.rejects(
      requestChatCompletionsStream(streamRequest),
      (error) => error?.code === "MALFORMED_RESPONSE" && /\[DONE\]/.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stream cancellation propagates as CANCELLED after response creation", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });

  globalThis.fetch = async (_url, options) => ({
    ok: true,
    status: 200,
    headers: makeHeaders({ "content-type": "text/event-stream" }),
    body: new ReadableStream({
      start(streamController) {
        streamController.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`
        ));
        markStarted();
        options.signal.addEventListener("abort", () => {
          streamController.error(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }
    }),
    async text() { return ""; }
  });

  try {
    const pending = requestChatCompletionsStream({
      ...streamRequest,
      signal: controller.signal
    });
    await started;
    controller.abort();
    await assert.rejects(pending, (error) => error?.code === "CANCELLED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful JSON response to stream request remains compatible", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(200, {
    choices: [{ message: { content: '{"translations":[]}' } }]
  });
  try {
    const data = await requestChatCompletionsStream(streamRequest);
    assert.equal(data.choices[0].message.content, '{"translations":[]}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generic Provider falls back when endpoint explicitly rejects streaming", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const bodies = [];
  globalThis.chrome = {
    permissions: { async contains() { return true; } }
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (bodies.length === 1) {
      return jsonResponse(400, { error: { message: "streaming is not supported" } });
    }
    return jsonResponse(200, {
      choices: [{ message: { content: '{"translations":[{"id":"1","text":"你好"}]}' } }]
    });
  };

  try {
    const result = await openAICompatibleProvider.translateBatch(
      [{ id: "1", text: "Hello" }],
      {
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "",
        model: "demo-model",
        prompt: "Translate.",
        targetLanguage: "Simplified Chinese",
        streaming: true
      }
    );
    assert.deepEqual(result, [{ id: "1", text: "你好" }]);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].stream, true);
    assert.equal(bodies[1].stream, false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("local translation-specialized models ignore generic streaming toggle", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const bodies = [];
  globalThis.chrome = {
    permissions: { async contains() { return true; } }
  };
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return jsonResponse(200, {
      choices: [{ message: { content: '{"translations":{"1":"你好"}}' } }]
    });
  };

  try {
    await openAICompatibleProvider.translateBatch(
      [{ id: "1", text: "Hello" }],
      {
        apiBaseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "",
        model: "hy-mt2-7b",
        prompt: "Translate.",
        targetLanguage: "Simplified Chinese",
        streaming: true
      }
    );
    assert.equal(bodies[0].stream, false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("unsupported-streaming classifier does not hide unrelated HTTP failures", () => {
  assert.equal(isUnsupportedStreamingError({
    code: "HTTP_ERROR",
    status: 400,
    message: "streaming is not supported"
  }), true);
  assert.equal(isUnsupportedStreamingError({
    code: "HTTP_ERROR",
    status: 400,
    message: "invalid model"
  }), false);
});
