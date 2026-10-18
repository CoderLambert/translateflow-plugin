import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as contract from "../src/shared/browser-translation.js";
import * as language from "../src/shared/browser-language.js";
const code = await readFile(new URL("../src/content/translation-client.js", import.meta.url), "utf8");
const M = Object.fromEntries(["TRANSLATION_ENGINE_SETTINGS", "CACHE_LOOKUP", "CACHE_STORE", "TRANSLATE_BATCH", "SUBTITLE_TRANSLATE_BATCH", "CANCEL_TRANSLATION", "OPEN_OPTIONS", "PUBLIC_SETTINGS_CHANGED"].map(key => [key, key]));
const pageUrl = "https://example.test/article";
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup({ prompt = async () => { throw new Error("Unexpected prompt"); }, selected = "auto" } = {}) {
  const calls = [], executions = [], detected = [], backend = new Map(), cache = new Map(), events = {};
  const settings = { ok: true, engine: contract.BROWSER_ENGINE, enabled: true, sourceLanguage: selected, targetLanguage: "zh" };
  let sequence = 0, notify;
  const engine = {
    async detectDecision(text) { detected.push(text); return { language: /^Bonjour/.test(text) ? "fr" : /^这/.test(text) ? "zh" : /^これは/.test(text) ? "ja" : "en", source: "detector", scriptKnown: true }; },
    capability: async () => "available", prepare: async () => {}, ready: () => true, dispose() {}, error: code => Object.assign(new Error(code), { code }),
    async execute({ pair, segments }) { executions.push({ pair, segments }); return { translations: segments.map(({ id, text }) => ({ id, text: `translated[${pair.sourceLanguage}]:${text}` })) }; }
  };
  const buildSubtitleCacheSource = unit => JSON.stringify({ media: unit.mediaId, track: unit.track, text: unit.text });
  const app = { modules: { browserTranslationContract: { ...contract, ...language, buildSubtitleCacheSource }, browserTranslation: engine,
    browserTranslationView: { prompt, close() {} }, runtime: { messages: { background: M } }, contentI18n: { t: key => key } } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, location: { href: pageUrl }, document: { documentElement: { lang: "es" } },
    window: { addEventListener: (key, fn) => { events[key] = fn; } }, chrome: { runtime: { onMessage: { addListener: fn => { notify = fn; } } } }, crypto, AbortController });
  vm.runInContext(code, context);
  const raw = async payload => {
    calls.push(payload);
    if (payload.type === M.TRANSLATION_ENGINE_SETTINGS) return { ...settings };
    if (payload.type === M.CACHE_LOOKUP) {
      if (!payload.browserTranslation) return { ok: true, engine: "ai", configSnapshotId: "ai-snapshot", hits: [] };
      const sourceLanguage = payload.browserTranslation.sourceLanguage, id = `backend-${++sequence}`;
      backend.set(id, sourceLanguage);
      return { ok: true, engine: contract.BROWSER_ENGINE, sourceLanguage, targetLanguage: settings.targetLanguage, configSnapshotId: id,
        hits: payload.segments.filter(item => cache.has(`${sourceLanguage}:${item.text}`)).map(item => ({ id: item.id, text: cache.get(`${sourceLanguage}:${item.text}`) })),
        writeTokens: payload.segments.map(item => ({ id: item.id, token: { namespace: 'translation', source: item.text, language: sourceLanguage } })) };
    }
    if (payload.type === M.CACHE_STORE) {
      const lang = backend.get(payload.configSnapshotId);
      if (!lang) return { ok: false, errorCode: "CONFIG_SNAPSHOT_EXPIRED" };
      if (payload.items.some(item => !item.cacheToken || item.cacheToken.language !== lang))
        return { ok: false, errorCode: "CACHE_INVALID_TOKEN" };
      for (const item of payload.items) cache.set(`${lang}:${item.sourceText}`, item.translation);
      return { ok: true, stored: payload.items.length };
    }
    if (payload.type === M.TRANSLATE_BATCH) return { ok: false, errorCode: "PROVIDER_HTTP" };
    return { ok: true };
  };
  return { client: app.modules.translationClient, engine, raw, calls, executions, detected, backend, cache, settings, events, notify: message => notify(message) };
}
async function translate(state, segments, extras = {}) {
  const requestId = extras.requestId || crypto.randomUUID();
  const lookup = await state.client.send({ type: M.CACHE_LOOKUP, pageUrl, requestId, segments, ...extras }, state.raw);
  const hitIds = new Set(lookup.hits.map(hit => hit.id));
  const missing = segments.filter(item => !hitIds.has(item.id));
  const result = missing.length ? await state.client.send({ type: M.TRANSLATE_BATCH, pageUrl, requestId, configSnapshotId: lookup.configSnapshotId, segments: missing }, state.raw) : { translations: [] };
  return { lookup, result, requestId };
}

test("mixed-language batches get separate model pairs AND separate native cache snapshots", async () => {
  const s = setup(), segments = [{ id: "en", text: "Hello world" }, { id: "fr", text: "Bonjour le monde" }];
  const { lookup, result } = await translate(s, segments);
  assert.deepEqual(s.executions.map(x => x.pair.sourceLanguage), ["en", "fr"]);
  const items = result.translations.map(item => ({ sourceText: segments.find(segment => segment.id === item.id).text, translation: item.text }));
  const saved = await s.client.send({ type: M.CACHE_STORE, pageUrl, configSnapshotId: lookup.configSnapshotId, items }, s.raw);
  assert.equal(saved.stored, 2); assert.equal(s.cache.has("en:Hello world"), true); assert.equal(s.cache.has("fr:Bonjour le monde"), true);
  assert.equal(s.calls.some(call => call.type === M.TRANSLATE_BATCH), false);
});
test("a later page batch is detected independently rather than inheriting the first batch's language", async () => {
  const s = setup();
  const first = await translate(s, [{ id: "a", text: "Hello world" }]);
  await translate(s, [{ id: "b", text: "Bonjour le monde" }], { configSnapshotId: first.lookup.configSnapshotId });
  assert.deepEqual(s.executions.map(x => x.pair.sourceLanguage), ["en", "fr"]);
});
test("target-language content is marked skipped without creating a model or persistent translation", async () => {
  const s = setup(), result = await translate(s, [{ id: "chinese", text: "这是中文段落" }]);
  assert.equal(result.lookup.skippedIds[0], "chinese"); assert.equal(s.executions.length, 0);
  assert.equal(s.calls.some(call => call.type === M.CACHE_STORE || call.type === M.CACHE_LOOKUP), false);
});
test("already available language packs are warmed automatically without a preparation prompt", async () => {
  const s = setup(); let prepared = 0;
  s.engine.ready = () => false; s.engine.prepare = async () => { prepared++; };
  await translate(s, [{ id: "a", text: "Hello world" }]); assert.equal(prepared, 1);
});
test("explicit source setting overrides subtitle track metadata", async () => {
  const s = setup({ selected: "ja" });
  await s.client.send({ type: M.SUBTITLE_TRANSLATE_BATCH, requestId: "sub", pageUrl, units: [{ id: "c", text: "Hello", mediaId: "video", track: { id: "t", language: "en" } }] }, s.raw);
  assert.equal(s.executions[0].pair.sourceLanguage, "ja"); assert.equal(s.detected.length, 0);
});
test("with automatic source, subtitles use per-track language and never detect serialized cache envelopes", async () => {
  const s = setup();
  await s.client.send({ type: M.SUBTITLE_TRANSLATE_BATCH, requestId: "sub", pageUrl, units: [{ id: "c", text: "Bonjour", mediaId: "video", track: { id: "t", language: "fr" } }] }, s.raw);
  assert.equal(s.executions[0].pair.sourceLanguage, "fr"); assert.equal(s.detected.length, 0);
  assert.equal(s.executions[0].segments[0].text, "Bonjour");
});
test("manual selection corrections do not poison another selection on the same page", async () => {
  let prompts = 0;
  const s = setup({ prompt: async options => { prompts++; return { ...options.pair, sourceLanguage: "de", automatic: false }; } });
  s.engine.detectDecision = async text => ({ language: text === "ambiguous" ? "" : "fr", source: "detector", scriptKnown: true });
  await translate(s, [{ id: "a", text: "ambiguous" }], { languageSource: "selection" });
  await translate(s, [{ id: "b", text: "Bonjour" }], { languageSource: "selection" });
  assert.equal(prompts, 1); assert.deepEqual(s.executions.map(x => x.pair.sourceLanguage), ["de", "fr"]);
});
test("silent cache restoration cannot open a language prompt or call a translator", async () => {
  const s = setup(); s.engine.detectDecision = async () => ({ language: "", source: "unknown" });
  const result = await s.client.send({ type: M.CACHE_LOOKUP, pageUrl, cacheOnly: true, segments: [{ id: "a", text: "ambiguous" }] }, s.raw);
  assert.equal(result.hits.length, 0); assert.equal(s.executions.length, 0);
});
test("worker snapshot loss recovers exactly once with the same language pair, never an AI fallback", async () => {
  const s = setup(), segments = [{ id: "fr", text: "Bonjour le monde" }];
  const { lookup, result } = await translate(s, segments); s.backend.clear();
  const saved = await s.client.send({ type: M.CACHE_STORE, pageUrl, configSnapshotId: lookup.configSnapshotId,
    items: [{ sourceText: segments[0].text, translation: result.translations[0].text }] }, s.raw);
  assert.equal(saved.stored, 1); assert.equal(s.cache.has("fr:Bonjour le monde"), true);
  assert.equal(s.calls.filter(call => call.type === M.CACHE_STORE).length, 2);
});
test("expired local native plan never routes a request to a cloud provider", async () => {
  const s = setup();
  await assert.rejects(s.client.send({ type: M.TRANSLATE_BATCH, pageUrl, requestId: "x", configSnapshotId: "browser-plan:missing", segments: [] }, s.raw), { code: "CONFIG_SNAPSHOT_EXPIRED" });
  assert.equal(s.calls.length, 0);
});
test("cancellation between native translation and cache storage prevents writes", async () => {
  const s = setup(), segments = [{ id: "a", text: "Hello" }];
  const { lookup, result, requestId } = await translate(s, segments);
  await s.client.send({ type: M.CANCEL_TRANSLATION, requestId }, s.raw);
  await assert.rejects(s.client.send({ type: M.CACHE_STORE, pageUrl, configSnapshotId: lookup.configSnapshotId,
    items: [{ sourceText: "Hello", translation: result.translations[0].text }] }, s.raw), { code: "CANCELLED" });
  assert.equal(s.cache.size, 0);
});
test("closing or navigating during a native call rejects late results and leaves no cache writes", async () => {
  const s = setup(); let release;
  s.engine.execute = () => new Promise(resolve => { release = resolve; });
  const p = translate(s, [{ id: "a", text: "Hello" }]); await tick(); s.events.popstate();
  release({ translations: [{ id: "a", text: "late" }] }); await assert.rejects(p, { code: "CANCELLED" }); assert.equal(s.cache.size, 0);
});
test("AI configuration still takes priority and its snapshot is passed through unchanged", async () => {
  const s = setup(); s.settings.engine = "ai";
  s.engine.detectDecision = () => assert.fail("AI request must not detect locally");
  const result = await s.client.send({ type: M.CACHE_LOOKUP, pageUrl, requestId: "ai", segments: [{ id: "a", text: "Hello" }] }, s.raw);
  assert.equal(result.configSnapshotId, "ai-snapshot"); assert.equal(result.engine, "ai");
});

test("snapshot recovery refuses a changed target instead of relabeling old results", async () => {
  const s = setup(), segments = [{ id: "a", text: "Hello" }];
  const { lookup, result } = await translate(s, segments); s.backend.clear(); s.settings.targetLanguage = "ja";
  await assert.rejects(s.client.send({ type: M.CACHE_STORE, pageUrl, configSnapshotId: lookup.configSnapshotId,
    items: [{ sourceText: "Hello", translation: result.translations[0].text }] }, s.raw), { code: "CONFIG_SNAPSHOT_EXPIRED" });
  assert.equal(s.cache.size, 0);
});
test("a native plan cannot be reused by a different request", async () => {
  const s = setup(), original = await s.client.send({ type: M.CACHE_LOOKUP, pageUrl, requestId: "owner", segments: [{ id: "a", text: "Hello" }] }, s.raw);
  await assert.rejects(s.client.send({ type: M.TRANSLATE_BATCH, pageUrl, requestId: "other", configSnapshotId: original.configSnapshotId,
    segments: [{ id: "a", text: "Hello" }] }, s.raw), { code: "CONFIG_SNAPSHOT_EXPIRED" });
  assert.equal(s.executions.length, 0);
});


test("native selection retains model result when the Background reports a cache persistence failure", async () => {
  for (const code of ["CACHE_QUOTA", "CACHE_STORAGE", "CACHE_STORAGE_BLOCKED", "CACHE_STORAGE_TIMEOUT"]) {
    const s = setup(), segments = [{ id: "a", text: "Hello world" }];
    const { lookup, result, requestId } = await translate(s, segments);
    const raw = async payload => payload.type === M.CACHE_STORE
      ? { ok: false, errorCode: code } : s.raw(payload);
    const saved = await s.client.send({
      type: M.CACHE_STORE, pageUrl, requestId, configSnapshotId: lookup.configSnapshotId,
      items: [{ sourceText: segments[0].text, translation: result.translations[0].text }]
    }, raw);
    assert.equal(saved.ok, true);
    assert.equal(saved.stored, 0);
    assert.equal(saved.cacheWarning, code);
    assert.equal(result.translations[0].text, "translated[en]:Hello world");
    assert.equal(s.executions.length, 1, "do not execute the native model again");
    assert.equal(s.cache.size, 0, "failed persistence cannot become a hit");
  }
});

test("native lookup passes cache read failures to the UI and never attempts a tokenless save", async () => {
  const s = setup(), segments = [{ id: "a", text: "Hello world" }];
  const raw = async payload => {
    const response = await s.raw(payload);
    return payload.type === M.CACHE_LOOKUP && payload.browserTranslation
      ? { ...response, cacheWarning: "CACHE_STORAGE", writeTokens: [] }
      : response;
  };
  const requestId = "native-cache-outage";
  const lookup = await s.client.send({ type: M.CACHE_LOOKUP, pageUrl, requestId, segments, cacheOnly: false }, raw);
  assert.equal(lookup.ok, true);
  assert.equal(lookup.cacheWarning, "CACHE_STORAGE");
  const translated = await s.client.send({ type: M.TRANSLATE_BATCH, pageUrl, requestId,
    configSnapshotId: lookup.configSnapshotId, segments }, raw);
  const saved = await s.client.send({ type: M.CACHE_STORE, pageUrl, requestId,
    configSnapshotId: lookup.configSnapshotId, items: [{
      sourceText: "Hello world", translation: translated.translations[0].text
    }] }, raw);
  assert.equal(saved.cacheWarning, "CACHE_STORAGE");
  assert.equal(saved.stored, 0);
  assert.equal(s.calls.some(call => call.type === M.CACHE_STORE), false);
  assert.equal(s.executions.length, 1);
});

test("native subtitle delivery survives a failed cache write and does not run the model twice", async () => {
  const s = setup();
  const raw = async payload => payload.type === M.CACHE_STORE
    ? { ok: false, errorCode: "CACHE_QUOTA" } : s.raw(payload);
  const reply = await s.client.send({ type: M.SUBTITLE_TRANSLATE_BATCH, requestId: "native-subtitle-outage",
    pageUrl, units: [{ id: "sub", text: "Bonjour", mediaId: "public-video", track: { id: "en", language: "en" } }] }, raw);
  assert.equal(reply.ok, true);
  assert.equal(reply.translations.length, 1);
  assert.equal(reply.translations[0].text, "translated[en]:Bonjour");
  assert.equal(reply.cacheWarning, "CACHE_QUOTA");
  assert.equal(s.executions.length, 1);
  assert.equal(s.cache.size, 0);
});

test("native store still rejects invalid tokens and stale configuration", async () => {
  const s = setup(), segments = [{ id: "a", text: "Hello world" }];
  const { lookup, result, requestId } = await translate(s, segments);
  const rejectedRaw = async payload => payload.type === M.CACHE_STORE
    ? { ok: false, errorCode: "CACHE_INVALID_TOKEN" } : s.raw(payload);
  await assert.rejects(s.client.send({ type: M.CACHE_STORE, pageUrl, requestId,
    configSnapshotId: lookup.configSnapshotId, items: [{ sourceText: "Hello world", translation: result.translations[0].text }] }, rejectedRaw),
  { code: "CACHE_INVALID_TOKEN" });
  assert.equal(s.cache.size, 0);
});
