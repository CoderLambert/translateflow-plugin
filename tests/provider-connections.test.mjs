import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderProtocolUrl,
  migrateLegacyProviderState,
  normalizeProviderConnection,
  publicProviderConnection
} from "../src/shared/provider-connections.js";
import { resolveTranslationConfig } from "../src/shared/provider-config.js";
import { getConfigHash } from "../src/background/cache-db.js";
import { listProviderConnections, upsertProviderConnection } from "../src/background/provider-connections.js";

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
