import test from "node:test";
import assert from "node:assert/strict";
import { getEffectiveConfigForSite } from "../src/background/config.js";

test("stored site identity resolves profile, preset, glossary and global inheritance without a return URL", async () => {
  globalThis.chrome = { storage: {
    local: { get: async () => ({
      translationPreferences: { version: 1, wordMethod: "dictionary", textMethod: "ai" }, provider: "deepseek", apiKey: "global-cloud-secret", model: "global-model", prompt: "global prompt",
      targetLanguage: "Japanese",
      openAICompatible: { baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", model: "local-model", streaming: true },
      siteProfiles: { "https://local.test": { provider: "openai-compatible", preset: "technical" } },
      glossary: { entries: [{ id: "global", source: "runtime", target: "运行时", enabled: true }] },
      siteGlossaries: { sites: { "https://local.test": [{ id: "site", source: "repository", target: "仓库", enabled: true }] } }
    }) },
    session: { get: async () => ({}) }
  } };
  const config = await getEffectiveConfigForSite("https://local.test:8443");
  assert.equal(config.provider, "openai-compatible");
  assert.equal(config.apiKey, "");
  assert.equal(config.apiBaseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(config.model, "local-model");
  assert.equal(config.targetLanguage, "Japanese");
  assert.match(config.prompt, /Translation style preset: Technical/);
  assert.match(config.prompt, /runtime.*运行时/su);
  assert.match(config.prompt, /repository.*仓库/su);
  assert.deepEqual(config.glossaryIdentity.map(entry => entry.source), ["repository", "runtime"]);
});

test("site config routing rejects an invalid identity before reading storage", async () => {
  let reads = 0;
  globalThis.chrome = { storage: { local: { get: async () => { reads++; return {}; } }, session: { get: async () => ({}) } } };
  await assert.rejects(() => getEffectiveConfigForSite("https://user:pass@example.test"), error => error.code === "READING_BAD_DTO");
  assert.equal(reads, 0);
});

test("subtitle context reports AI independently of the page free-online method", async () => {
  const { getEffectiveContext } = await import("../src/background/config.js");
  const original = globalThis.chrome;
  const { normalizeProviderConnection } = await import("../src/shared/provider-connections.js");
  const connection = normalizeProviderConnection({ id: "fixture", platform: "local", protocol: "openai-chat", baseUrl: "http://127.0.0.1:1234/v1", defaultModel: "local-model", settings: { allowInsecureHttp: true, allowEmptyApiKey: true } });
  const memory = {
    providerConnectionsVersion: 1, providerConnections: { fixture: connection }, providerCredentials: {}, defaultService: { kind: "api-key", connectionId: "fixture" },
    dictionaryEnabled: true, translationPreferences: { version: 1, wordMethod: "dictionary", textMethod: "free-online" },
    provider: "openai-compatible", targetLanguage: "Japanese", model: "local-model", prompt: "Translate",
    openAICompatible: { baseUrl: "http://127.0.0.1:1234/v1", apiKey: "", model: "local-model" }
  };
  globalThis.chrome = { storage: { local: { get: async () => ({ ...memory }), set: async patch => Object.assign(memory, patch) }, session: { get: async () => ({}) } } };
  try {
    const context = await getEffectiveContext("https://www.youtube.com/watch?v=fixture", { surface: "subtitle" });
    assert.equal(context.textMethod, "ai"); assert.equal(context.provider, "openai-chat"); assert.equal(context.model, "local-model"); assert.equal(context.targetLanguage, "Japanese");
  } finally { globalThis.chrome = original; }
});
