import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderProtocolUrl,
  migrateLegacyProviderState,
  normalizeProviderConnection,
  providerPlatformPreset,
  publicProviderConnection
} from "../src/shared/provider-connections.js";
import { resolveTranslationConfig } from "../src/shared/provider-config.js";
import { getConfigHash } from "../src/background/cache-db.js";
import { listProviderConnections, upsertProviderConnection } from "../src/background/provider-connections.js";
import { testSavedProviderConnection } from "../src/background/provider-connection-runtime.js";

test("a forbidden local Ollama connection test names the exact extension origin to allow", async () => {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  const connection = normalizeProviderConnection({ id: "ollama", platform: "ollama", protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:11434", defaultModel: "local-model", settings: { allowEmptyApiKey: true, allowInsecureHttp: true } });
  const stored = { providerConnectionsVersion: 1, providerConnections: { ollama: connection }, providerCredentials: {},
    defaultService: { kind: "api-key", connectionId: "ollama" } };
  globalThis.chrome = { runtime: { getURL: () => "chrome-extension://abcdefghijklmnopabcdefghijklmnop/" },
    permissions: { contains: async () => true }, storage: { local: { get: async () => stored, set: async () => {} } } };
  globalThis.fetch = async () => new Response("Forbidden", { status: 403 });
  try {
    await assert.rejects(testSavedProviderConnection("ollama"), error => {
      assert.equal(error.status, 403);
      assert.match(error.message, /OLLAMA_ORIGINS/u);
      assert.match(error.message, /chrome-extension:\/\/abcdefghijklmnopabcdefghijklmnop/u);
      return true;
    });
  } finally { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; }
});

test("Ollama and LM Studio presets produce usable keyless local and authenticated cloud connections", () => {
  for (const [platform, endpoint, keyless] of [
    ["ollama", "http://127.0.0.1:11434/v1/chat/completions", true],
    ["ollama-cloud", "https://ollama.com/v1/chat/completions", false],
    ["lmstudio", "http://127.0.0.1:1234/v1/chat/completions", true]
  ]) {
    const preset = providerPlatformPreset(platform);
    const connection = normalizeProviderConnection({ id: platform, platform: preset.id, protocol: preset.protocol,
      baseUrl: preset.baseUrl, defaultModel: "user/model:custom-tag", settings: {
        allowEmptyApiKey: preset.allowEmptyApiKey, allowInsecureHttp: keyless
      } });
    assert.equal(buildProviderProtocolUrl(connection), endpoint);
    const effective = resolveTranslationConfig({ providerConnections: { [platform]: connection },
      providerCredentials: { [platform]: keyless ? "" : "test-cloud-key" },
      defaultService: { kind: "api-key", connectionId: platform } });
    assert.equal(effective.model, "user/model:custom-tag");
    assert.equal(effective.allowEmptyApiKey, keyless);
    assert.equal(effective.apiKey, keyless ? "" : "test-cloud-key");
    if (!keyless) {
      assert.throws(() => resolveTranslationConfig({ providerConnections: { [platform]: connection }, providerCredentials: {},
        defaultService: { kind: "api-key", connectionId: platform } }), error => error.code === "CONFIG");
    }
  }
});

test("named local presets accept service roots and Ollama native URLs without altering custom endpoints", () => {
  for (const [platform, input, expected] of [
    ["ollama", "http://localhost:11434", "http://localhost:11434/v1"],
    ["ollama", "http://localhost:11434/api", "http://localhost:11434/v1"],
    ["ollama", "http://localhost:11434/api/chat", "http://localhost:11434/v1"],
    ["ollama-cloud", "https://ollama.com", "https://ollama.com/v1"],
    ["lmstudio", "http://localhost:1234/", "http://localhost:1234/v1"],
    ["custom", "https://selfhost.test", "https://selfhost.test"],
    ["ollama", "https://selfhost.test/proxy/v1", "https://selfhost.test/proxy/v1"],
    ["ollama", "https://selfhost.test/v1/chat/completions", "https://selfhost.test/v1/chat/completions"]
  ]) {
    const connection = normalizeProviderConnection({ id: "test", platform, protocol: "openai-chat",
      baseUrl: input, defaultModel: "custom-model", settings: { allowEmptyApiKey: true, allowInsecureHttp: true } });
    assert.equal(connection.baseUrl, expected);
  }
});

test("legacy provider settings migrate to stable connection references without losing credentials", () => {
  const migrated = migrateLegacyProviderState({ provider: "openai-compatible", apiKey: "deep-secret", model: "deep-model",
    openAICompatible: { baseUrl: "http://127.0.0.1:11434/v1/", apiKey: "local-secret", model: "local-model", streaming: true } });
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.defaultService, { kind: "api-key", connectionId: "openai-compatible" });
  assert.equal(migrated.connections["openai-compatible"].baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(migrated.credentials["openai-compatible"], "local-secret");
  assert.equal(publicProviderConnection(migrated.connections["openai-compatible"], "local-secret").hasApiKey, true);
  assert.equal("apiKey" in publicProviderConnection(migrated.connections["openai-compatible"], "local-secret"), false);
});

test("effective config resolves a site connection override without copying its credential into the profile", () => {
  const cloud = normalizeProviderConnection({ id: "cloud", revision: 3, name: "Cloud", platform: "openai", protocol: "openai-responses",
    baseUrl: "https://api.example.test/v1", credentialId: "cloud", defaultModel: "model-a", settings: { outputTokens: 2048 } });
  const local = normalizeProviderConnection({ id: "local", revision: 2, name: "Local", platform: "local", protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:11434/v1", credentialId: "local", defaultModel: "model-b", settings: { allowEmptyApiKey: true, allowInsecureHttp: true } });
  const config = resolveTranslationConfig({ providerConnectionsVersion: 1, providerConnections: { cloud, local }, providerCredentials: { cloud: "secret", local: "" },
    defaultService: { kind: "api-key", connectionId: "cloud" }, targetLanguage: "Chinese", prompt: "translate", siteProfiles: {
      "https://docs.example": { serviceRef: { kind: "api-key", connectionId: "local" }, model: "site-model" }
    } }, "https://docs.example/page");
  assert.equal(config.provider, "openai-chat");
  assert.equal(config.connectionId, "local");
  assert.equal(config.connectionRevision, 2);
  assert.equal(config.model, "site-model");
  assert.equal(config.apiKey, "");
  assert.equal(config.allowInsecureHttp, true);
});

test("missing connection references fail explicitly and never fall back to a paid default", () => {
  const connection = normalizeProviderConnection({ id: "cloud", name: "Cloud", platform: "openai", protocol: "openai-responses",
    baseUrl: "https://api.example.test/v1", credentialId: "cloud", defaultModel: "model", settings: {} });
  assert.throws(() => resolveTranslationConfig({ providerConnections: { cloud: connection }, providerCredentials: { cloud: "secret" },
    defaultService: { kind: "api-key", connectionId: "cloud" }, siteProfiles: { "https://docs.example": { serviceRef: { kind: "api-key", connectionId: "deleted" } } } }, "https://docs.example/page"), error => error.code === "CONNECTION_MISSING");
});

test("protocol URL builders cover all four first-release contracts", () => {
  const make = (protocol, baseUrl) => normalizeProviderConnection({ id: protocol, name: protocol, platform: "custom", protocol, baseUrl, defaultModel: "gemini-2.5-flash", settings: { allowEmptyApiKey: true } });
  assert.equal(buildProviderProtocolUrl(make("openai-chat", "https://api.example/v1")), "https://api.example/v1/chat/completions");
  assert.equal(buildProviderProtocolUrl(make("openai-responses", "https://api.example/v1/responses")), "https://api.example/v1/responses");
  assert.equal(buildProviderProtocolUrl(make("anthropic-messages", "https://api.example/v1")), "https://api.example/v1/messages");
  assert.equal(buildProviderProtocolUrl(make("gemini-generate", "https://api.example/v1beta")), "https://api.example/v1beta/models/gemini-2.5-flash:generateContent");
});

test("plain HTTP requires an explicit local or self-hosted opt-in", () => {
  assert.throws(() => normalizeProviderConnection({ id: "unsafe", protocol: "openai-chat", baseUrl: "http://provider.example/v1", settings: { allowEmptyApiKey: true } }), /HTTP Provider/u);
  assert.equal(normalizeProviderConnection({ id: "local", platform: "local", protocol: "openai-chat", baseUrl: "http://127.0.0.1:11434/v1", settings: { allowEmptyApiKey: true, allowInsecureHttp: true } }).baseUrl, "http://127.0.0.1:11434/v1");
});

test("connection revision and protocol participate in cache identity without credential bytes", async () => {
  const base = { provider: "openai-responses", protocol: "openai-responses", connectionId: "cloud", connectionRevision: 1,
    apiBaseUrl: "https://api.example.test/v1", model: "m", targetLanguage: "Chinese", prompt: "p", apiKey: "secret-a" };
  assert.notEqual(await getConfigHash(base), await getConfigHash({ ...base, connectionRevision: 2 }));
  assert.notEqual(await getConfigHash(base), await getConfigHash({ ...base, provider: "openai-chat", protocol: "openai-chat" }));
  assert.equal(await getConfigHash(base), await getConfigHash({ ...base, apiKey: "secret-b" }));
});

test("background connection messages never return credential values and reject stale revisions", async () => {
  const originalChrome = globalThis.chrome;
  const connection = normalizeProviderConnection({ id: "cloud", revision: 4, name: "Cloud", platform: "openai", protocol: "openai-responses",
    baseUrl: "https://api.example.test/v1", credentialId: "cloud", defaultModel: "m", settings: {} });
  const memory = { providerConnectionsVersion: 1, providerConnections: { cloud: connection }, providerCredentials: { cloud: "top-secret" }, defaultService: { kind: "api-key", connectionId: "cloud" } };
  globalThis.chrome = { storage: { local: { get: async keys => Object.fromEntries(keys.filter(key => Object.hasOwn(memory, key)).map(key => [key, memory[key]])),
    set: async patch => Object.assign(memory, patch) } } };
  try {
    const listed = await listProviderConnections();
    assert.equal(listed.connections[0].hasApiKey, true);
    assert.doesNotMatch(JSON.stringify(listed), /top-secret/u);
    await assert.rejects(upsertProviderConnection({ expectedRevision: 3, connection }), error => error.code === "CONNECTION_CONFLICT");
    await assert.rejects(upsertProviderConnection({ expectedRevision: 4, connection, updateCredential: true, apiKey: "x".repeat(16385) }), error => error.code === "CONFIG");
  } finally { globalThis.chrome = originalChrome; }
});
