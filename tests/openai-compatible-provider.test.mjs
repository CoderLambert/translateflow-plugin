import test from "node:test";
import assert from "node:assert/strict";
import { openAICompatibleProvider } from "../src/background/providers/openai-compatible.js";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test("Hy-MT2 uses a user-only structured prompt and accepts echoed segments JSON", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.chrome = {
    permissions: {
      contains: async () => true
    }
  };
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              segments: [
                { id: "a", text: "你好，世界。" },
                { id: "b", text: "本地翻译。" }
              ]
            })
          }
        }
      ]
    });
  };

  try {
    const result = await openAICompatibleProvider.translateBatch(
      [
        { id: "a", text: "Hello world." },
        { id: "b", text: "Local translation." }
      ],
      {
        apiBaseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "",
        model: "hy-mt2-7b",
        prompt: "Translate to Simplified Chinese.",
        targetLanguage: "Simplified Chinese"
      }
    );

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].messages.map((message) => message.role), ["user"]);
    assert.match(requests[0].messages[0].content, /Keep every id exactly unchanged/);
    assert.deepEqual(result, [
      { id: "a", text: "你好，世界。" },
      { id: "b", text: "本地翻译。" }
    ]);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

test("generic OpenAI-compatible model falls back to inline prompt after malformed JSON", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const requests = [];
  let call = 0;

  globalThis.chrome = {
    permissions: {
      contains: async () => true
    }
  };
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    call += 1;
    if (call === 1) {
      return response(200, {
        choices: [{ message: { content: "I translated it, but not as JSON." } }]
      });
    }
    return response(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: [{ id: "a", text: "你好。" }]
            })
          }
        }
      ]
    });
  };

  try {
    const result = await openAICompatibleProvider.translateBatch(
      [{ id: "a", text: "Hello." }],
      {
        apiBaseUrl: "https://example.test/v1",
        apiKey: "test",
        model: "generic-chat-model",
        prompt: "Translate to Simplified Chinese.",
        targetLanguage: "Simplified Chinese"
      }
    );

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].messages.map((message) => message.role), ["system", "user"]);
    assert.deepEqual(requests[1].messages.map((message) => message.role), ["user"]);
    assert.deepEqual(result, [{ id: "a", text: "你好。" }]);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
