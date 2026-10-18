import test from "node:test";
import assert from "node:assert/strict";
import { createEffectiveConfigSnapshot, releaseEffectiveConfigSnapshot, resolveEffectiveConfigSnapshot } from "../src/background/effective-config-snapshots.js";
import { normalizeProviderConnection } from "../src/shared/provider-connections.js";

test("effective config snapshots keep cache, Provider and store on one connection revision", async () => {
  const originalChrome = globalThis.chrome;
  const connection = normalizeProviderConnection({ id: "cloud", revision: 1, name: "Cloud", platform: "openai", protocol: "openai-responses",
    baseUrl: "https://api.example.test/v1", credentialId: "cloud", defaultModel: "model-one", settings: {} });
  const memory = { providerConnectionsVersion: 1, providerConnections: { cloud: connection }, providerCredentials: { cloud: "secret" },
    defaultService: { kind: "api-key", connectionId: "cloud" }, siteProfiles: {}, prompt: "Translate", targetLanguage: "Chinese" };
  globalThis.chrome = { storage: { local: {
    get: async keys => keys === null ? { ...memory } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(memory, key)).map(key => [key, memory[key]])),
    set: async patch => Object.assign(memory, patch)
  } } };
  let firstId = "", secondId = "";
  try {
    const first = await createEffectiveConfigSnapshot("https://docs.example/page"); firstId = first.id;
    memory.providerConnections = { cloud: normalizeProviderConnection({ ...connection, revision: 2, defaultModel: "model-two" }) };
    const frozen = await resolveEffectiveConfigSnapshot(first.id, "https://docs.example/page");
    assert.equal(frozen.connectionRevision, 1);
    assert.equal(frozen.model, "model-one");
    const second = await createEffectiveConfigSnapshot("https://docs.example/page"); secondId = second.id;
    assert.equal(second.config.connectionRevision, 2);
    assert.equal(second.config.model, "model-two");
    await assert.rejects(resolveEffectiveConfigSnapshot(first.id, "https://other.example/page"), error => error.code === "CONFIG_SNAPSHOT_EXPIRED");
  } finally {
    releaseEffectiveConfigSnapshot(firstId); releaseEffectiveConfigSnapshot(secondId); globalThis.chrome = originalChrome;
  }
});
