import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { browserLanguage, browserConfig, hasConfiguredAi, BROWSER_TRANSLATION_ACTIONS, BROWSER_ENGINE, languageHintMatchesText } from "../src/shared/browser-translation.js";
import { getConfigHash } from "../src/background/cache-db.js";
import { buildSubtitleCacheSource } from "../src/shared/subtitle-cache.js";
import { BACKGROUND_MESSAGES as M } from "../src/shared/constants.js";

const source = path => readFile(new URL(path, import.meta.url), "utf8");
function engineContext(Translator) {
  const app = { modules: { browserTranslationContract: { browserLanguage, languageHintMatchesText, BROWSER_TRANSLATION_ACTIONS } } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, Translator, isSecureContext: true, AbortController });
  return { app, context };
}

test("browser languages preserve AI custom targets while mapping standard names and locales", () => {
  for (const [input, expected] of [["Simplified Chinese", "zh"], ["zh-CN", "zh"], ["zh-TW", "zh-Hant"], ["English", "en"], ["de-DE", "de"], ["简体中文", "zh"]]) assert.equal(browserLanguage(input), expected);
  assert.equal(browserLanguage("Use a friendly custom style"), "");
  assert.throws(() => browserConfig({ targetLanguage: "custom style" }, null, "en"), { code: "BROWSER_LANGUAGE" });
  assert.equal(browserConfig({ targetLanguage: "English" }, { targetLanguage: "Japanese" }, "en").targetLanguage, "ja");
});

test("AI choice is determined from saved configuration, including empty-key local services and broken references", () => {
  assert.equal(hasConfiguredAi({}), false);
  const seed = { id: "deepseek", revision: 1, platform: "deepseek", baseUrl: "https://api.deepseek.com", credentialId: "deepseek" };
  const stored = { defaultService: { kind: "api-key", connectionId: "deepseek" }, providerConnections: { deepseek: seed }, providerCredentials: {} };
  assert.equal(hasConfiguredAi(stored), false);
  assert.equal(hasConfiguredAi({ ...stored, aiServiceConfigured: true }), true);
  assert.equal(hasConfiguredAi({ ...stored, providerCredentials: { deepseek: "synthetic-key" } }), true);
  assert.equal(hasConfiguredAi({ defaultService: { kind: "api-key", connectionId: "deleted" } }), true);
  assert.equal(hasConfiguredAi({ ...stored, providerConnections: { deepseek: { ...seed, revision: 2 } } }), true);
  assert.equal(hasConfiguredAi({ defaultService: { kind: "api-key", connectionId: "local" }, providerConnections: { local: { id: "local", settings: { allowEmptyApiKey: true } } } }), true);
  assert.equal(hasConfiguredAi({}, { serviceRef: { kind: "chatgpt-plan" } }), true);
});

test("browser cache fingerprints isolate engine and explicit source/target pairs without schema changes", async () => {
  const en = browserConfig({ targetLanguage: "Simplified Chinese" }, null, "en");
  const hash = await getConfigHash(en);
  assert.notEqual(hash, await getConfigHash({ ...en, sourceLanguage: "fr" }));
  assert.notEqual(hash, await getConfigHash({ ...en, targetLanguage: "ja" }));
  assert.notEqual(hash, await getConfigHash({ ...en, provider: "deepseek" }));
  assert.equal(hash, await getConfigHash(browserConfig({ targetLanguage: "zh-CN" }, null, "en-US")));
});

test("engine never initializes on load/capability, and keeps markers and code out of model input", async () => {
  let creates = 0, destroyed = 0; const inputs = [];
  const { app, context } = engineContext({ availability: async () => "downloadable", create: async () => { creates++; return { translate: async text => { inputs.push(text); return `translated:${text}`; }, destroy: () => destroyed++ }; } });
  vm.runInContext(await source("../src/content/browser-translation.js"), context);
  const engine = app.modules.browserTranslation, pair = { sourceLanguage: "en", targetLanguage: "zh" };
  assert.equal(creates, 0); assert.equal(await engine.capability(pair), "downloadable"); assert.equal(creates, 0);
  await engine.prepare(pair);
  const result = await engine.execute({ pair, segments: [{ id: "a", text: "Read ⟦TF:0:S⟧cacheKey⟦TF:0:E⟧ with ⟦TF:1:S⟧care⟦TF:1:E⟧.", protectedIds: [0] }] });
  assert.equal(result.engine, BROWSER_ENGINE);
  assert.equal(result.translations[0].text.includes("⟦TF:0:S⟧cacheKey⟦TF:0:E⟧"), true);
  assert.equal(inputs.some(text => /TF:|cacheKey/.test(text)), false);
  engine.dispose(); assert.equal(destroyed, 1); assert.equal(engine.ready(pair), false);
});

test("cancelling preparation destroys a late instance; cancelling translation rejects late output", async () => {
  let finish, destroyed = 0;
  const { app, context } = engineContext({ create: () => new Promise(resolve => { finish = resolve; }) });
  vm.runInContext(await source("../src/content/browser-translation.js"), context);
  const engine = app.modules.browserTranslation, pair = { sourceLanguage: "en", targetLanguage: "zh" };
  const pending = engine.prepare(pair); engine.dispose();
  finish({ destroy: () => destroyed++ }); await assert.rejects(pending, { code: "CANCELLED" }); assert.equal(destroyed, 1);
  let translateDone;
  context.Translator.create = async () => ({ destroy() {}, translate: () => new Promise(resolve => { translateDone = resolve; }) });
  await engine.prepare(pair);
  const controller = new AbortController();
  const running = engine.execute({ pair, signal: controller.signal, segments: [{ id: "1", text: "hello" }] });
  controller.abort(); translateDone("late"); await assert.rejects(running, { code: "CANCELLED" });
});

async function clientContext({ settings = { ok: true, engine: BROWSER_ENGINE, enabled: true, sourceLanguage: "auto", targetLanguage: "Chinese" }, prompt = async () => true } = {}) {
  const calls = [], events = {}, model = { creates: 0, executions: [], disposed: 0 };
  const engine = { detect: async () => "en", capability: async () => "downloadable", ready: () => true,
    execute: async input => { model.executions.push(input); return { translations: input.segments.map(item => ({ id: item.id, text: `译:${item.text}` })) }; },
    dispose: () => model.disposed++, error: code => Object.assign(new Error(code), { code }) };
  const app = { modules: { browserTranslationContract: { BROWSER_ENGINE, browserLanguage, buildSubtitleCacheSource }, browserTranslation: engine,
    browserTranslationView: { prompt, close() {} }, runtime: { messages: { background: M } }, contentI18n: { t: key => key } } };
  let notify;
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, location: { href: "https://example.test/" }, document: { documentElement: { lang: "en" } }, window: { addEventListener: (type, fn) => { events[type] = fn; } }, chrome: { runtime: { onMessage: { addListener: fn => { notify = fn; } } } }, crypto, AbortController });
  vm.runInContext(await source("../src/content/translation-client.js"), context);
  const raw = async payload => {
    calls.push(payload);
    if (payload.type === M.TRANSLATION_ENGINE_SETTINGS) return settings;
    if (payload.type === M.CACHE_LOOKUP) return { ok: true, engine: BROWSER_ENGINE, sourceLanguage: payload.browserTranslation.sourceLanguage, targetLanguage: "zh", configSnapshotId: "snapshot", hits: [] };
    if (payload.type === M.TRANSLATE_BATCH) return { ok: false, errorCode: "PROVIDER_HTTP" };
    return { ok: true };
  };
  return { client: app.modules.translationClient, raw, calls, model, events, notify, engine };
}

test("disabled basic translation does not query models or execute; settings notification releases instances", async () => {
  const state = await clientContext({ settings: { ok: true, engine: BROWSER_ENGINE, enabled: false } });
  state.engine.detect = () => assert.fail("must not detect while disabled");
  await assert.rejects(state.client.send({ type: M.CACHE_LOOKUP, pageUrl: "https://example.test/" }, state.raw), { code: "BROWSER_DISABLED" });
  assert.equal(state.model.executions.length, 0);
  state.notify({ type: M.PUBLIC_SETTINGS_CHANGED, changes: { browserTranslationEnabled: { newValue: false } } });
  assert.equal(state.model.disposed, 1);
});

test("subtitle track language takes precedence and uses the shared subtitle cache source", async () => {
  const state = await clientContext();
  const unit = { id: "cue", mediaId: "video", text: "bonjour", track: { language: "fr" }, cue: { startTime: 1, endTime: 2 } };
  const result = await state.client.send({ type: M.SUBTITLE_TRANSLATE_BATCH, requestId: "task", pageUrl: "https://example.test/", units: [unit] }, state.raw);
  assert.equal(result.ok, true);
  assert.equal(state.model.executions[0].pair.sourceLanguage, "fr");
  const stored = state.calls.find(item => item.type === M.CACHE_STORE);
  assert.equal(stored.items[0].sourceText, buildSubtitleCacheSource(unit));
  assert.equal(state.calls.some(item => item.type === M.TRANSLATE_BATCH), false);
});

test("AI error waits for explicit fallback choice and requires a fresh task", async () => {
  let choose; const prompts = [];
  const state = await clientContext({ prompt: options => { prompts.push(options); return new Promise(resolve => { choose = resolve; }); } });
  const pending = state.client.send({ type: M.TRANSLATE_BATCH, requestId: "ai-task", pageUrl: "https://example.test/", segments: [{ id: "1", text: "hello" }] }, state.raw);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prompts[0].action.label, "useBasic"); assert.equal(state.model.executions.length, 0);
  choose(true); await assert.rejects(pending, { code: "ENGINE_SWITCH" });
  const fresh = await state.client.send({ type: M.CACHE_LOOKUP, pageUrl: "https://example.test/", segments: [{ id: "1", text: "hello" }] }, state.raw);
  assert.equal(fresh.ok, true);
  assert.equal(state.calls.findLast(item => item.type === M.CACHE_LOOKUP).browserTranslation.forceBrowser, true);
});

test("capability distinguishes HTTP, missing API and site/language policy denial without initializing", async () => {
  const { app, context } = engineContext({ availability: async () => "unavailable", create: () => assert.fail("capability must not create") });
  vm.runInContext(await source("../src/content/browser-translation.js"), context);
  const pair = { sourceLanguage: "en", targetLanguage: "zh" };
  assert.equal(await app.modules.browserTranslation.capability(pair), "unavailable");
  context.isSecureContext = false; assert.equal(await app.modules.browserTranslation.capability(pair), "insecure");
  context.isSecureContext = true; context.Translator = undefined;
  assert.equal(await app.modules.browserTranslation.capability(pair), "unsupported");
});

test("new install dictionaries default off; existing installed/enabled dictionaries and explicit disable survive defaults", async () => {
  const { getConfig, ensureConfigDefaults } = await import("../src/background/config.js");
  const previous = globalThis.chrome;
  let memory = {};
  globalThis.chrome = { storage: { local: { get: async keys => Object.fromEntries(keys.filter(key => Object.hasOwn(memory, key)).map(key => [key, memory[key]])), set: async patch => Object.assign(memory, patch) } } };
  try {
    assert.equal((await getConfig()).dictionaryEnabled, false);
    memory.tfRichMdictStateV1 = { packs: { imported: { status: "healthy", active: { packVersion: "1" } } } };
    memory.tfRichMdictPreferencesV1 = { dictionaries: { imported: { enabled: true } } };
    assert.equal((await getConfig()).dictionaryEnabled, true);
    await ensureConfigDefaults(); assert.equal(memory.dictionaryEnabled, true);
    memory.dictionaryEnabled = false; await ensureConfigDefaults(); assert.equal((await getConfig()).dictionaryEnabled, false);
    delete memory.dictionaryEnabled; memory.tfRichMdictPreferencesV1.dictionaries.imported.enabled = false;
    assert.equal((await getConfig()).dictionaryEnabled, false);
  } finally { globalThis.chrome = previous; }
});

test("automatic cache restoration never opens a preparation or settings prompt", async () => {
  const state = await clientContext({ settings: { ok: true, engine: BROWSER_ENGINE, enabled: false }, prompt: () => assert.fail("automatic cache restore must remain silent") });
  const result = await state.client.send({ type: M.CACHE_LOOKUP, cacheOnly: true, pageUrl: "https://example.test/" }, state.raw);
  assert.equal(result.ok, true); assert.equal(result.hits.length, 0);
  assert.equal(state.model.executions.length, 0);
});

test("subtitle cancellation rejects late local output before cache writes, and a fresh task can retry", async () => {
  const state = await clientContext();
  let release, started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  state.engine.execute = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const payload = { type: M.SUBTITLE_TRANSLATE_BATCH, requestId: "old-media-task", pageUrl: "https://example.test/", units: [{ id: "cue", mediaId: "old", text: "hello", track: { language: "en" }, cue: { startTime: 1, endTime: 2 } }] };
  const pending = state.client.send(payload, state.raw);
  await startedPromise;
  await state.client.send({ type: M.CANCEL_TRANSLATION, requestId: "old-media-task" }, state.raw);
  release({ translations: [{ id: "cue", text: "late" }] });
  await assert.rejects(pending, { code: "CANCELLED" });
  assert.equal(state.calls.some(item => item.type === M.CACHE_STORE), false);
  state.engine.execute = async input => ({ translations: input.segments.map(item => ({ id: item.id, text: "new" })) });
  const result = await state.client.send({ ...payload, requestId: "new-media-task", units: payload.units.map(unit => ({ ...unit, mediaId: "new" })) }, state.raw);
  assert.equal(result.translations[0].text, "new");
});

test("navigation aborts an active browser translation and rejects its late result", async () => {
  const state = await clientContext();
  await state.client.send({ type: M.CACHE_LOOKUP, pageUrl: "https://example.test/", segments: [{ id: "1", text: "hello" }] }, state.raw);
  let release, started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  state.engine.execute = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const pending = state.client.send({ type: M.TRANSLATE_BATCH, configSnapshotId: "snapshot", requestId: "page-task", pageUrl: "https://example.test/", segments: [{ id: "1", text: "hello" }] }, state.raw);
  await startedPromise; state.events.popstate(); release({ translations: [{ id: "1", text: "late" }] });
  await assert.rejects(pending, { code: "CANCELLED" }); assert.equal(state.model.disposed, 1);
});

test("denied language detection falls back to page hints or manual choice without starting a download", async () => {
  const { app, context } = engineContext({});
  context.LanguageDetector = { availability: async () => { throw new Error("permission denied"); }, create: () => assert.fail("must not create") };
  vm.runInContext(await source("../src/content/browser-translation.js"), context);
  assert.equal(await app.modules.browserTranslation.detect("a short sentence", "de"), "de");
  assert.equal(await app.modules.browserTranslation.detect("a short sentence"), "");
});

test("English words on a Chinese UI do not inherit Chinese source language, and Latin does not imply English", async () => {
  const { app, context } = engineContext({});
  vm.runInContext(await source("../src/content/browser-translation.js"), context);
  assert.equal(await app.modules.browserTranslation.detect("Actually", "zh-CN"), "");
  assert.equal(await app.modules.browserTranslation.detect("Actually", "en"), "en");
  assert.equal(await app.modules.browserTranslation.detect("bonjour", "fr"), "fr");
  assert.equal(await app.modules.browserTranslation.detect("中文词语", "en"), "");
});
test("a high-confidence browser detection is used for a short word despite the site's UI language", async () => {
  const { app, context } = engineContext({});
  context.LanguageDetector = { availability: async () => "available", create: async () => ({ detect: async () => [{ detectedLanguage: "en", confidence: 0.95 }], destroy() {} }) };
  vm.runInContext(await source("../src/content/browser-translation.js"), context);
  assert.equal(await app.modules.browserTranslation.detect("Actually", "zh-CN"), "en");
});
test("an explicit website translator policy denial is distinct from unavailable models", async () => {
  const { app, context } = engineContext({ availability: () => assert.fail("policy denial must not query model availability") });
  context.document = { featurePolicy: { features: () => ["translator"], allowsFeature: () => false } };
  vm.runInContext(await source("../src/content/browser-translation.js"), context);
  assert.equal(await app.modules.browserTranslation.capability({ sourceLanguage: "en", targetLanguage: "zh" }), "policy-denied");
});
test("Selection detection receives no page language hint, even on a Latin-language page", async () => {
  const state = await clientContext();
  let hint;
  state.engine.detect = async (_text, pageHint) => { hint = pageHint; return "en"; };
  const response = await state.client.send({ type: M.CACHE_LOOKUP, requestId: "selection", languageSource: "selection", pageUrl: "https://example.test/", segments: [{ id: "1", text: "Actually" }] }, state.raw);
  assert.equal(hint, ""); assert.equal(response.sourceLanguage, "en");
});
