import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalTranslationRequestBody,
  decodeLocalMarkers,
  encodeLocalMarkers,
  isLocalTranslationModel,
  parseLocalTranslationResult,
  splitLocalTranslationBatches
} from "../src/background/providers/local-translation.js";
import { openAICompatibleProvider } from "../src/background/providers/openai-compatible.js";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(payload); }
  };
}

test("translation-specialized local model detection is conservative", () => {
  assert.equal(isLocalTranslationModel("Tencent-HY-MT2-7B"), true);
  assert.equal(isLocalTranslationModel("translate-gemma-4b"), true);
  assert.equal(isLocalTranslationModel("qwen2.5-7b-instruct"), false);
});

test("local batches cap segment count and approximate source characters", () => {
  const countBatches = splitLocalTranslationBatches(
    Array.from({ length: 9 }, (_, index) => ({ id: index + 1, text: "a" }))
  );
  assert.deepEqual(countBatches.map((batch) => batch.length), [8, 1]);

  const charBatches = splitLocalTranslationBatches([
    { id: "a", text: "x".repeat(2000) },
    { id: "b", text: "y".repeat(1500) },
    { id: "c", text: "z" }
  ]);
  assert.deepEqual(charBatches.map((batch) => batch.map((item) => item.id)), [["a"], ["b", "c"]]);
});

test("local marker encoding round-trips TranslateFlow structured markers", () => {
  const source = "before ⟦TF:12:S⟧code⟦TF:12:E⟧ after";
  const encoded = encodeLocalMarkers(source);
  assert.equal(encoded, "before [[TF_12_S]]code[[TF_12_E]] after");
  assert.equal(decodeLocalMarkers(encoded), source);
});

test("local request is user-only and constrains translation ids with json_schema", () => {
  const body = buildLocalTranslationRequestBody({
    model: "hy-mt2-7b",
    config: {
      prompt: "Translate naturally.",
      targetLanguage: "Simplified Chinese"
    },
    segments: [
      { id: "1", text: "Hello" },
      { id: "2", text: "⟦TF:0:S⟧API⟦TF:0:E⟧" }
    ]
  });

  assert.deepEqual(body.messages.map((item) => item.role), ["user"]);
  assert.equal(body.stream, false);
  assert.equal(body.response_format.type, "json_schema");
  assert.deepEqual(
    body.response_format.json_schema.schema.properties.translations.required,
    ["1", "2"]
  );
  assert.match(body.messages[0].content, /\[\[TF_0_S\]\]API\[\[TF_0_E\]\]/);
  assert.match(body.messages[0].content, /Return every input id exactly once/);
});

test("local parser accepts canonical arrays, translation maps and segment arrays", () => {
  const segments = [{ id: "1" }, { id: "2" }];

  assert.deepEqual(
    parseLocalTranslationResult({
      choices: [{ message: { content: JSON.stringify({
        translations: [{ id: "1", text: "甲" }, { id: "2", text: "乙" }]
      }) } }]
    }, segments),
    [{ id: "1", text: "甲" }, { id: "2", text: "乙" }]
  );

  assert.deepEqual(
    parseLocalTranslationResult({
      choices: [{ message: { content: JSON.stringify({
        translations: { "1": "甲", "2": "[[TF_0_S]]API[[TF_0_E]]" }
      }) } }]
    }, segments),
    [{ id: "1", text: "甲" }, { id: "2", text: "⟦TF:0:S⟧API⟦TF:0:E⟧" }]
  );

  assert.deepEqual(
    parseLocalTranslationResult({
      choices: [{ message: { content: JSON.stringify({
        segments: [{ id: "1", text: "甲" }, { id: "2", text: "乙" }]
      }) } }]
    }, segments),
    [{ id: "1", text: "甲" }, { id: "2", text: "乙" }]
  );
});

test("local parser rejects missing, duplicate and unknown ids", () => {
  const segments = [{ id: "1" }, { id: "2" }];

  assert.throws(
    () => parseLocalTranslationResult({
      choices: [{ message: { content: '{"translations":{"1":"甲"}}' } }]
    }, segments),
    (error) => error?.code === "MALFORMED_RESPONSE" && /缺少翻译 id/.test(error.message)
  );

  assert.throws(
    () => parseLocalTranslationResult({
      choices: [{ message: { content: '{"translations":[{"id":"1","text":"甲"},{"id":"1","text":"乙"}]}' } }]
    }, segments),
    (error) => error?.code === "MALFORMED_RESPONSE" && /重复返回 id/.test(error.message)
  );

  assert.throws(
    () => parseLocalTranslationResult({
      choices: [{ message: { content: '{"translations":{"1":"甲","2":"乙","3":"丙"}}' } }]
    }, segments),
    (error) => error?.code === "MALFORMED_RESPONSE" && /未知 id/.test(error.message)
  );
});

test("local provider falls back when endpoint rejects json_schema", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const bodies = [];
  let calls = 0;

  globalThis.chrome = {
    permissions: {
      async contains() { return true; }
    }
  };
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    bodies.push(JSON.parse(options.body));
    if (calls === 1) {
      return response(400, { error: { message: "response_format json_schema is unsupported" } });
    }
    return response(200, {
      choices: [{ message: { content: '{"translations":{"1":"你好"}}' } }]
    });
  };

  try {
    const result = await openAICompatibleProvider.translateBatch(
      [{ id: "1", text: "Hello" }],
      {
        apiBaseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "",
        model: "hy-mt2-7b",
        prompt: "Translate naturally.",
        targetLanguage: "Simplified Chinese"
      }
    );

    assert.deepEqual(result, [{ id: "1", text: "你好" }]);
    assert.equal(calls, 2);
    assert.equal(bodies[0].response_format.type, "json_schema");
    assert.equal(bodies[1].response_format, undefined);
    assert.deepEqual(bodies[0].messages.map((item) => item.role), ["user"]);
    assert.deepEqual(bodies[1].messages.map((item) => item.role), ["user"]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});
