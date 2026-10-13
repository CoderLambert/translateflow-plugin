import test from "node:test";
import assert from "node:assert/strict";
import { openAIChatProvider } from "../src/background/providers/openai-compatible.js";
import { openAIResponsesProvider } from "../src/background/providers/openai-responses.js";
import { anthropicMessagesProvider } from "../src/background/providers/anthropic-messages.js";
import { geminiGenerateProvider } from "../src/background/providers/gemini-generate.js";

const segments = [{ id: "1", text: "Hello" }];
const translated = JSON.stringify({ translations: [{ id: "1", text: "你好" }] });

for (const scenario of [
  { name: "OpenAI Chat Completions", provider: openAIChatProvider, protocol: "openai-chat", response: { choices: [{ message: { content: translated } }] },
    path: "/v1/chat/completions", header: "authorization", inspect: body => assert.equal(body.messages[1].role, "user") },
  { name: "OpenAI Responses", provider: openAIResponsesProvider, protocol: "openai-responses", response: { output: [{ content: [{ type: "output_text", text: translated }] }] },
    path: "/v1/responses", header: "authorization", inspect: body => assert.equal(typeof body.input, "string") },
  { name: "Anthropic Messages", provider: anthropicMessagesProvider, protocol: "anthropic-messages", response: { content: [{ type: "text", text: translated }] },
    path: "/v1/messages", header: "x-api-key", inspect: body => assert.equal(body.messages[0].role, "user") },
  { name: "Gemini generateContent", provider: geminiGenerateProvider, protocol: "gemini-generate", response: { candidates: [{ content: { parts: [{ text: translated }] } }] },
    path: "/v1/models/test-model:generateContent", header: "x-goog-api-key", inspect: body => assert.equal(body.contents[0].role, "user") }
]) {
  test(`${scenario.name} translates through its native request and response contract`, async () => {
    const originalFetch = globalThis.fetch, originalChrome = globalThis.chrome;
    let request;
    globalThis.chrome = { permissions: { contains: async () => true } };
    globalThis.fetch = async (url, init) => {
      request = { url: String(url), init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify(scenario.response), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      const result = await scenario.provider.translateBatch(segments, { provider: scenario.protocol, protocol: scenario.protocol, connectionId: "test", connectionRevision: 1,
        providerLabel: scenario.name, platform: "custom", apiBaseUrl: "https://provider.example/v1", apiKey: "test-secret", model: "test-model",
        prompt: "Return JSON", targetLanguage: "Chinese", outputTokens: 1024, temperature: null, streaming: false, allowEmptyApiKey: false });
      assert.deepEqual(result, [{ id: "1", text: "你好" }]);
      assert.equal(new URL(request.url).pathname, scenario.path);
      assert.ok(new Headers(request.init.headers).get(scenario.header));
      assert.equal("temperature" in request.body, false);
      scenario.inspect(request.body);
    } finally { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; }
  });
}

test("OpenAI-compatible connection test rejects an empty successful response", async () => {
  const originalFetch = globalThis.fetch, originalChrome = globalThis.chrome;
  globalThis.chrome = { permissions: { contains: async () => true } };
  globalThis.fetch = async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    await assert.rejects(openAIChatProvider.test({ apiBaseUrl: "https://provider.example/v1", apiKey: "", model: "test", allowEmptyApiKey: true }), error => error.code === "MALFORMED_RESPONSE");
  } finally { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; }
});

test("native connection tests require the exact OK sentinel", async () => {
  const originalFetch = globalThis.fetch, originalChrome = globalThis.chrome;
  globalThis.chrome = { permissions: { contains: async () => true } };
  globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: "text", text: "authenticated" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    await assert.rejects(anthropicMessagesProvider.test({ connectionId: "anthropic", apiBaseUrl: "https://provider.example/v1", apiKey: "key", model: "test" }), error => error.code === "MALFORMED_RESPONSE");
  } finally { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; }
});

test("Gemini model paths accept the API's models/ prefix", async () => {
  const originalFetch = globalThis.fetch, originalChrome = globalThis.chrome;
  let requestUrl = "";
  globalThis.chrome = { permissions: { contains: async () => true } };
  globalThis.fetch = async (url) => {
    requestUrl = String(url);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: translated }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await geminiGenerateProvider.translateBatch(segments, { connectionId: "gemini", protocol: "gemini-generate", apiBaseUrl: "https://provider.example/v1", apiKey: "key", model: "models/gemini-2.5-flash", prompt: "Return JSON", targetLanguage: "Chinese" });
    assert.equal(new URL(requestUrl).pathname, "/v1/models/gemini-2.5-flash:generateContent");
  } finally { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; }
});

test("Azure OpenAI v1 Responses uses the api-key header", async () => {
  const originalFetch = globalThis.fetch, originalChrome = globalThis.chrome;
  let headers;
  globalThis.chrome = { permissions: { contains: async () => true } };
  globalThis.fetch = async (_url, init) => {
    headers = new Headers(init.headers);
    return new Response(JSON.stringify({ output_text: translated }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await openAIResponsesProvider.translateBatch(segments, { connectionId: "azure", platform: "azure-v1", apiBaseUrl: "https://resource.openai.azure.com/openai/v1", apiKey: "azure-secret", model: "deployment-name", prompt: "Return JSON", targetLanguage: "Chinese", outputTokens: 1024 });
    assert.equal(headers.get("api-key"), "azure-secret");
    assert.equal(headers.get("authorization"), null);
  } finally { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; }
});
