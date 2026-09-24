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

test("Hy-MT2 uses JSON-schema structured output, chunks batches and shields rich-text markers", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.chrome = {
    permissions: {
      contains: async () => true
    }
  };

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const input = JSON.parse(body.messages[0].content.split("Input JSON:\n").at(-1));
    const translations = Object.fromEntries(
      input.segments.map((segment) => [
        segment.id,
        segment.text
          .replace("Hello", "你好")
          .replace("world", "世界")
      ])
    );
    return response(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({ translations })
          }
        }
      ]
    });
  };

  try {
    const segments = [
      { id: "1", text: "Hello ⟦TF:0:S⟧world⟦TF:0:E⟧." },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: String(index + 2),
        text: `Hello world ${index + 2}.`
      }))
    ];

    const result = await openAICompatibleProvider.translateBatch(
      segments,
      {
        apiBaseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "",
        model: "hy-mt2-7b",
        prompt: [
          "You are a professional translator.",
          "Translate the provided English web-page segments into natural Simplified Chinese.",
          'Return valid JSON only, exactly in this shape: {"translations":[{"id":"...","text":"..."}] }.',
          "Every input id must appear exactly once in the output.",
          "TranslateFlow structured-marker protocol: Preserve every marker."
        ].join("\n"),
        targetLanguage: "Simplified Chinese"
      }
    );

    assert.equal(requests.length, 2);
    for (const body of requests) {
      assert.deepEqual(body.messages.map((message) => message.role), ["user"]);
      assert.equal(body.stream, false);
      assert.equal(body.response_format?.type, "json_schema");
      assert.equal(body.response_format?.json_schema?.strict, true);
      assert.equal(body.max_tokens, 4096);
      assert.doesNotMatch(body.messages[0].content, /Return valid JSON only, exactly in this shape/);
    }

    assert.match(requests[0].messages[0].content, /\[\[TF_0_S\]\]world\[\[TF_0_E\]\]/);
    assert.deepEqual(
      requests[0].response_format.json_schema.schema.properties.translations.required,
      ["1", "2", "3", "4", "5", "6", "7", "8"]
    );
    assert.equal(result.length, 9);
    assert.equal(result[0].text, "你好 ⟦TF:0:S⟧世界⟦TF:0:E⟧.");
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

test("Hy-MT2 falls back when an OpenAI-compatible server rejects response_format", async () => {
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
    const body = JSON.parse(options.body);
    requests.push(body);
    call += 1;

    if (call === 1) {
      return response(400, { error: { message: "response_format is not supported" } });
    }

    return response(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: { "1": "你好。" }
            })
          }
        }
      ]
    });
  };

  try {
    const result = await openAICompatibleProvider.translateBatch(
      [{ id: "1", text: "Hello." }],
      {
        apiBaseUrl: "http://127.0.0.1:9999/v1",
        apiKey: "",
        model: "hy-mt2-7b",
        prompt: "Translate to Simplified Chinese.",
        targetLanguage: "Simplified Chinese"
      }
    );

    assert.equal(requests.length, 2);
    assert.ok(requests[0].response_format);
    assert.equal(requests[1].response_format, undefined);
    assert.deepEqual(result, [{ id: "1", text: "你好。" }]);
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
