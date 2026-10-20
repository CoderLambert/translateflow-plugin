import test from "node:test";
import assert from "node:assert/strict";
import { createEffectiveConfigSnapshot, invalidateTranslationSnapshots, releaseEffectiveConfigSnapshot, resolveEffectiveConfigSnapshot } from "../src/background/effective-config-snapshots.js";
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

function coldStorage() {
  const memory = { provider: "openai-compatible", model: "synthetic", targetLanguage: "Japanese", prompt: "Translate",
    openAICompatible: { baseUrl: "http://localhost:1234/v1", model: "synthetic", apiKey: "" } };
  const writes = [];
  const chrome = { storage: { local: {
    get: async keys => Object.fromEntries((keys === null ? Object.keys(memory) : Array.isArray(keys) ? keys : [keys])
      .filter(key => Object.hasOwn(memory, key)).map(key => [key, memory[key]])),
    set: async patch => { writes.push(patch); Object.assign(memory, patch); invalidateTranslationSnapshots(); }
  } } };
  return { memory, writes, chrome };
}

test("first concurrent cold lookups finish migrations before pinning their config revisions", async () => {
  const original = globalThis.chrome, fixture = coldStorage(); globalThis.chrome = fixture.chrome;
  try {
    const snapshots = await Promise.all([createEffectiveConfigSnapshot("https://cold.test/one"), createEffectiveConfigSnapshot("https://cold.test/two")]);
    assert.equal(fixture.writes.length, 2, "provider and preference migrations are each written once");
    assert.equal(snapshots[0].revision, snapshots[1].revision);
    for (const [index, snapshot] of snapshots.entries()) {
      assert.equal(snapshot.config.model, "synthetic");
      assert.equal(snapshot.config.targetLanguage, "Japanese");
      assert.equal(await resolveEffectiveConfigSnapshot(snapshot.id, `https://cold.test/${index ? "two" : "one"}`), snapshot.config);
      releaseEffectiveConfigSnapshot(snapshot.id);
    }
  } finally { invalidateTranslationSnapshots(); globalThis.chrome = original; }
});

test("explicit revisions cannot cross initialization writes or later configuration changes", async () => {
  const original = globalThis.chrome, fixture = coldStorage(); globalThis.chrome = fixture.chrome;
  try {
    const first = await createEffectiveConfigSnapshot("https://cold.test/page");
    fixture.memory.translationPreferences = null;
    await assert.rejects(createEffectiveConfigSnapshot("https://cold.test/page", { configRevision: first.revision }), { code: "CONFIG_SNAPSHOT_EXPIRED" });
    const current = await createEffectiveConfigSnapshot("https://cold.test/page");
    invalidateTranslationSnapshots();
    await assert.rejects(createEffectiveConfigSnapshot("https://cold.test/page", { configRevision: current.revision }), { code: "CONFIG_SNAPSHOT_EXPIRED" });
    await assert.rejects(resolveEffectiveConfigSnapshot(current.id, "https://cold.test/page"), { code: "CONFIG_SNAPSHOT_EXPIRED" });
  } finally { invalidateTranslationSnapshots(); globalThis.chrome = original; }
});

test("a real configuration edit during resolution rejects mixed data and leaves no usable old snapshot", async () => {
  const original = globalThis.chrome, fixture = coldStorage(); globalThis.chrome = fixture.chrome;
  try {
    const initial = await createEffectiveConfigSnapshot("https://cold.test/page");
    const get = fixture.chrome.storage.local.get;
    let reads = 0;
    fixture.chrome.storage.local.get = async keys => {
      const result = await get(keys);
      // First full read belongs to initialization; the second resolves the route.
      if (Array.isArray(keys) && keys.includes("translationPreferences") && ++reads === 2) {
        fixture.memory.targetLanguage = "French";
        invalidateTranslationSnapshots();
      }
      return result;
    };
    await assert.rejects(createEffectiveConfigSnapshot("https://cold.test/page"), { code: "CONFIG_SNAPSHOT_EXPIRED" });
    await assert.rejects(resolveEffectiveConfigSnapshot(initial.id, "https://cold.test/page"), { code: "CONFIG_SNAPSHOT_EXPIRED" });
    const next = await createEffectiveConfigSnapshot("https://cold.test/page");
    assert.equal(next.config.targetLanguage, "French"); releaseEffectiveConfigSnapshot(next.id);
  } finally { invalidateTranslationSnapshots(); globalThis.chrome = original; }
});
