import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/shared/constants.js";
import { classifySelectionIntent } from "../src/shared/selection.js";
import { selectedTranslationMethod, normalizeTranslationPreferences } from "../src/shared/translation-preferences.js";
import { migrateTranslationPreferences, ensureTranslationPreferences, onlineConsentValid, saveTranslationPreferences } from "../src/background/translation-preferences.js";
import { resolveSelectionRequest } from "../src/background/selection/resolve.js";
import { translationEngineSettings } from "../src/background/browser-translation.js";
import { createEffectiveConfigSnapshot, resolveEffectiveConfigSnapshot, invalidateTranslationSnapshots } from "../src/background/effective-config-snapshots.js";

const prefs = (wordMethod = "free-online", textMethod = "ai") => ({ version: 1, wordMethod, textMethod });
const origin = "https://example.test";
function storage(config) {
  let value = structuredClone(config), writes = 0, probes = 0;
  globalThis.chrome = {
    runtime: { id: "test" },
    storage: { local: { get: async keys => keys === null ? structuredClone(value) : Object.fromEntries(keys.filter(key => key in value).map(key => [key, structuredClone(value[key])])),
      set: async patch => { value = { ...value, ...structuredClone(patch) }; writes++; } } },
    tabs: { query: async () => [{ id: 7 }] }, scripting: { executeScript: async () => { probes++; return [{ result: true }]; } },
    permissions: { contains: async () => true }
  };
  return { value: () => structuredClone(value), writes: () => writes, probes: () => probes };
}
function configured(extra = {}) {
  return { ...DEFAULT_CONFIG, apiKey: "synthetic-only", ...extra };
}

test("migration chooses new defaults once and preserves explicit site choices and unrelated data", () => {
  const raw = configured({ dictionaryEnabled: true, siteProfiles: {
    [origin]: { machineTranslation: { version: 2, mode: "free-online", routing: "auto", providerId: "mt-microsoft-web", sourceLanguage: "auto" }, prompt: "existing" },
    "https://ai.test": { serviceRef: { kind: "api-key", connectionId: "chosen" } },
    "https://inherit.test": { targetLanguage: "Japanese" },
    "https://legacy.test": { machineTranslation: { version: 2, mode: "legacy" } }
  } });
  const result = migrateTranslationPreferences(raw, true);
  assert.deepEqual(result.translationPreferences, prefs());
  assert.equal(result.siteProfiles[origin].textMethod, "free-online");
  assert.equal(result.siteProfiles[origin].prompt, "existing");
  assert.equal(result.siteProfiles["https://ai.test"].textMethod, "ai");
  assert.equal(result.siteProfiles["https://inherit.test"].textMethod, undefined);
  assert.equal(result.siteProfiles["https://legacy.test"].textMethod, "ai");
  assert.deepEqual(migrateTranslationPreferences({ ...DEFAULT_CONFIG }, true).translationPreferences, prefs("free-online", "browser-local"));
  assert.deepEqual(migrateTranslationPreferences({ ...DEFAULT_CONFIG }, false).translationPreferences, prefs("free-online", "free-online"));
});

test("concurrent initialization persists once; resource changes and restart do not change either choice", async () => {
  const store = storage({ ...DEFAULT_CONFIG, dictionaryEnabled: true });
  const results = await Promise.all([ensureTranslationPreferences(), ensureTranslationPreferences()]);
  assert.deepEqual(results[0], prefs("free-online", "browser-local"));
  assert.equal(store.writes(), 1); assert.equal(store.probes(), 1);
  await chrome.storage.local.set({ apiKey: "new-synthetic", browserTranslationEnabled: false, dictionaryEnabled: false });
  assert.deepEqual(await ensureTranslationPreferences(), results[0]);
  assert.equal(store.probes(), 1);
  assert.equal(onlineConsentValid(store.value(), null), false);
});

for (const word of ["dictionary", "free-online", "browser-local", "ai"]) for (const text of ["ai", "browser-local", "free-online"]) {
  test(`single choice matrix word=${word}, text=${text} ignores competing resource toggles`, async () => {
    const raw = configured({ translationPreferences: prefs(word, text), dictionaryEnabled: true, browserTranslationEnabled: false,
      siteProfiles: { [origin]: { textMethod: "browser-local" } } });
    storage(raw);
    let dictionaries = 0;
    const result = await resolveSelectionRequest({ text: "persistent", pageUrl: origin + "/article" }, {
      getConfig: async () => raw,
      runLexicalLookup: async () => { dictionaries++; return { status: "no-hit" }; },
      assessLexicalLookup: () => ({ outcome: "no-hit", candidates: [] })
    });
    assert.equal(dictionaries, word === "dictionary" ? 1 : 0);
    assert.equal(result.route, word === "dictionary" ? "unresolved" : "translation");
    const settings = await translationEngineSettings(origin + "/article", { surface: "selection-word" });
    assert.equal(settings.method, word);
    assert.equal(settings.engine, ({ dictionary: "dictionary", ai: "ai", "browser-local": "browser-translator", "free-online": "machine-translation" })[word]);
    assert.equal((await translationEngineSettings(origin, { surface: "selection-text" })).method, "browser-local");
    assert.equal(selectedTranslationMethod(raw, null, "page"), text);
  });
}

test("phrases and sentences use text preference; explicit ambiguity correction is per operation", async () => {
  const raw = configured({ translationPreferences: prefs("dictionary", "browser-local") });
  for (const text of ["terminal multiplexer", "a longer sentence.", "日本語 の文です。"])
    assert.equal(classifySelectionIntent({ text }).kind, "translation");
  for (const text of ["persistent", "弁護士", "イトマキエイ"]) assert.equal(classifySelectionIntent({ text }).kind, "lexical");
  let calls = 0;
  const deps = { getConfig: async () => raw, runLexicalLookup: async () => { calls++; return {}; }, assessLexicalLookup: () => ({ outcome: "no-hit" }) };
  assert.equal((await resolveSelectionRequest({ text: "terminal multiplexer", pageUrl: origin }, deps)).method, "browser-local");
  assert.equal(calls, 0);
  assert.equal((await resolveSelectionRequest({ text: "persistent", temporaryMethod: "ai" }, deps)).method, "ai");
  assert.equal(calls, 0);
  assert.equal(selectedTranslationMethod(raw, null, "selection-word"), "dictionary");
});

test("saving validates choices, never accepts a site word override, and preserves credentials and legacy resource state", async () => {
  const raw = configured({ translationPreferences: prefs(), dictionaryEnabled: true });
  const store = storage(raw);
  await assert.rejects(saveTranslationPreferences({ scope: "site", pageUrl: origin, textMethod: "ai", wordMethod: "dictionary" }), { code: "PREFERENCES_CONFIG" });
  assert.throws(() => normalizeTranslationPreferences({ ...prefs(), wordMethod: "legacy" }));
  await saveTranslationPreferences({ scope: "global", preferences: prefs("dictionary", "browser-local"), config: raw.machineTranslation, consent: false });
  assert.deepEqual(store.value().translationPreferences, prefs("dictionary", "browser-local"));
  assert.equal(store.value().dictionaryEnabled, true); assert.equal(store.value().apiKey, "synthetic-only");
});

test("consent is separate from a free-online default and becomes invalid on a fixed service change", () => {
  const raw = configured({ translationPreferences: prefs() });
  assert.equal(onlineConsentValid(raw, null), false);
  raw.machineTranslationConsent = { version: 1, routing: "auto", providerId: "mt-microsoft-web" };
  assert.equal(onlineConsentValid(raw, null), true);
  raw.machineTranslation = { ...raw.machineTranslation, routing: "fixed", providerId: "mt-tencent-transmart" };
  assert.equal(onlineConsentValid(raw, null), false);
});

test("preference changes fence AI, online and native snapshots without deleting cache", async () => {
  storage(configured({ translationPreferences: prefs("dictionary", "ai") }));
  const snapshot = await createEffectiveConfigSnapshot(origin);
  assert.equal((await resolveEffectiveConfigSnapshot(snapshot.id, origin)).provider.length > 0, true);
  invalidateTranslationSnapshots();
  await assert.rejects(resolveEffectiveConfigSnapshot(snapshot.id, origin), { code: "CONFIG_SNAPSHOT_EXPIRED" });
  await assert.rejects(createEffectiveConfigSnapshot(origin, { configRevision: snapshot.revision }), { code: "CONFIG_SNAPSHOT_EXPIRED" });
});

test("online consent can be withdrawn with unchanged unavailable AI; site denial blocks inherited consent", async () => {
  const store = storage({ ...DEFAULT_CONFIG, translationPreferences: prefs(), machineTranslationConsent: { version: 1, routing: "auto", providerId: "mt-microsoft-web" } });
  const state = await saveTranslationPreferences({ scope: "global", preferences: prefs(), config: store.value().machineTranslation, consent: false });
  assert.equal(state.globalConsent, false); assert.deepEqual(state.preferences, prefs());
  assert.equal(store.value().machineTranslationConsent, null);
  await chrome.storage.local.set({ machineTranslationConsent: { version: 1, routing: "auto", providerId: "mt-microsoft-web" } });
  const selected = await saveTranslationPreferences({ scope: "site", pageUrl: origin, textMethod: "free-online", consent: false });
  assert.equal(selected.consent, false); assert.equal(selected.globalConsent, true);
  assert.equal(onlineConsentValid(store.value(), store.value().siteProfiles[origin]), false);
  assert.equal(onlineConsentValid(store.value(), store.value().siteProfiles[origin], "selection-word"), true);
  const follow = await saveTranslationPreferences({ scope: "site", pageUrl: origin, inherit: true, consent: false });
  assert.equal(follow.siteOverride, false);
});

test("preference DTO exposes only bounded service cooldown state", async () => {
  const store = storage({ ...DEFAULT_CONFIG, translationPreferences: prefs(), "tfMtCooldown:mt-microsoft-web": { until: Date.now() + 120000, code: "MT_RATE_LIMIT", failures: 2, private: "not-public" } });
  const { readTranslationPreferences } = await import("../src/background/translation-preferences.js");
  const state = await readTranslationPreferences();
  assert.ok(state.health.find(item => item.providerId === "mt-microsoft-web").until > Date.now());
  assert.ok(state.health.every(item => Object.keys(item).sort().join(",") === "code,providerId,until"));
  assert.equal(store.writes(), 0);
});
