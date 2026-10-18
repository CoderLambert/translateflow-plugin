import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { selectionDetectionSample } from "../src/shared/browser-language.js";
import * as contract from "../src/shared/browser-translation.js";
import * as language from "../src/shared/browser-language.js";
import { en, zh_CN } from "../src/i18n/catalog-browser-translation.js";
import { createBrowserNativeRuntime } from "../src/browser-native/runtime.js";

const contentSource = await readFile(new URL("../src/content/browser-translation.js", import.meta.url), "utf8");
const selectionSource = await readFile(new URL("../src/content/selection/translation-query.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../src/content/translation-client.js", import.meta.url), "utf8");
const pair = { sourceLanguage: "en", targetLanguage: "zh" };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function modelHarness(Translator) {
  const app = { modules: { browserTranslationContract: { ...contract, ...language, createBrowserNativeRuntime } } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, Translator, LanguageDetector: null,
    isSecureContext: true, setTimeout, clearTimeout, AbortController });
  vm.runInContext(contentSource, context);
  return app.modules.browserTranslation;
}
test("selection detection uses the closest safe sentence, not an unrelated page language", () => {
  const sample = selectionDetectionSample("Gift", "An unrelated English sentence. Das Gift ist giftig. Another English sentence.");
  assert.equal(sample, "Das Gift ist giftig.");
  assert.equal(selectionDetectionSample("gift", "There is no matching word here."), "gift");
  assert.equal(selectionDetectionSample("React", "React"), "React");
});
test("the existing selection context is used only when approved and non-sensitive", async () => {
  async function run(context, allowed) {
    const messages = [];
    const app = { modules: {
      runtime: { messages: { background: { CACHE_LOOKUP: "CACHE_LOOKUP" } }, sendRuntimeMessage: async request => {
        messages.push(request);
        return { ok: true, hits: [{ id: "selection", text: "poison" }] };
      } },
      contentI18n: { t: key => key },
      tasks: { transition() {}, completeTask() {} },
      selectionPopover: { setLoadingStatus() {} },
      selectionResultModel: { buildTranslationResult: () => ({}), readingTranslation: () => ({}) },
      browserTranslationContract: { ...language }
    } };
    vm.runInNewContext(selectionSource, { __TRANSLATE_FLOW_CONTENT__: app, document: { title: "fixture" } });
    const runTranslation = app.modules.selectionTranslationQuery.create({ assertCurrent() {}, showResult() {}, onResult() {} });
    const snapshot = { text: "Gift", pageUrl: "https://example.test/", sourceCapture: { context } };
    await runTranslation(snapshot, {}, 0, "", null, { browserTranslationAllowed: allowed });
    return messages[0];
  }
  const safe = { text: "Das Gift ist giftig.", sensitive: false, source: "visible-local" };
  assert.equal((await run(safe, true)).detectionText, "Das Gift ist giftig.");
  assert.equal((await run({ ...safe, sensitive: true }, true)).detectionText, "Gift");
  assert.equal(Object.hasOwn(await run(safe, false), "detectionText"), false);
});
test("AI routing never forwards local detection context into Background", async () => {
  const messages = [];
  const app = { modules: { browserTranslationContract: { ...contract, ...language, buildSubtitleCacheSource: () => "" },
    browserTranslation: { error: code => Object.assign(new Error(code), { code }), dispose() {} },
    browserTranslationView: { close() {} }, runtime: { messages: { background: {
      CACHE_LOOKUP: "CACHE_LOOKUP", TRANSLATION_ENGINE_SETTINGS: "TRANSLATION_ENGINE_SETTINGS"
    } } }, contentI18n: { t: key => key } } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, location: { href: "https://example.test/" },
    window: { addEventListener() {} }, chrome: { runtime: { onMessage: { addListener() {} } } },
    crypto, AbortController });
  vm.runInContext(clientSource, context);
  const raw = async request => {
    messages.push(request);
    if (request.type === "TRANSLATION_ENGINE_SETTINGS") return { ok: true, engine: "ai", configured: true };
    return { ok: true, engine: "ai", configSnapshotId: "ai-plan", hits: [] };
  };
  await app.modules.translationClient.send({ type: "CACHE_LOOKUP", requestId: "selected", pageUrl: "https://example.test/",
    languageSource: "selection", browserTranslationAllowed: true, detectionText: "Sensitive nearby sentence",
    segments: [{ id: "selection", text: "Gift" }] }, raw);
  assert.equal(messages[1].type, "CACHE_LOOKUP");
  assert.equal(Object.hasOwn(messages[1], "detectionText"), false);
});
test("busy translator pairs wait for an idle slot instead of failing immediately", async () => {
  const held = { en: deferred(), fr: deferred() };
  let created = 0, started = 0, destroyed = 0;
  const engine = modelHarness({ async create(options) {
    const source = options.sourceLanguage;
    created++;
    return { async translate(value) {
      if (value === "hold") { started++; await held[source].promise; }
      return source + ":" + value;
    }, destroy() { destroyed++; } };
  } });
  const fr = { ...pair, sourceLanguage: "fr" }, de = { ...pair, sourceLanguage: "de" };
  await engine.prepare(pair); await engine.prepare(fr);
  const jobEn = engine.execute({ pair, segments: [{ id: "en", text: "hold" }] });
  const jobFr = engine.execute({ pair: fr, segments: [{ id: "fr", text: "hold" }] });
  for (let i = 0; i < 12 && started !== 2; i++) await tick();
  assert.equal(started, 2);
  const third = engine.prepare(de);
  await tick(); assert.equal(created, 2);
  held.en.resolve(); await jobEn;
  await third;
  assert.equal(created, 3);
  assert.ok(destroyed >= 1);
  held.fr.resolve(); await jobFr; engine.dispose();
});
test("capacity waiting can be cancelled without creating another model", async () => {
  const held = { en: deferred(), fr: deferred() };
  let started = 0, created = 0;
  const engine = modelHarness({ async create(options) {
    created++;
    return { async translate(value) {
      if (value === "hold") { started++; await held[options.sourceLanguage].promise; }
      return "ok";
    }, destroy() {} };
  } });
  const fr = { ...pair, sourceLanguage: "fr" }, de = { ...pair, sourceLanguage: "de" };
  await engine.prepare(pair); await engine.prepare(fr);
  const a = engine.execute({ pair, segments: [{ id: "a", text: "hold" }] });
  const b = engine.execute({ pair: fr, segments: [{ id: "b", text: "hold" }] });
  for (let i = 0; i < 12 && started !== 2; i++) await tick();
  assert.equal(started, 2);
  const controller = new AbortController();
  const pending = engine.prepare(de, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: "CANCELLED" });
  assert.equal(created, 2);
  held.en.resolve(); held.fr.resolve(); await Promise.all([a, b]); engine.dispose();
});
test("model preparation verifies a real nonempty translation before declaring ready", async () => {
  const samples = [], phases = [];
  const engine = modelHarness({ async create() {
    return { async translate(text) { samples.push(text); return "礼物"; }, destroy() {} };
  } });
  const state = await engine.prepare(pair, { verifyText: "Gift", onPhase: phase => phases.push(phase) });
  assert.equal(state.state, "ready");
  assert.deepEqual(samples, ["Gift"]);
  assert.deepEqual(phases, ["verifying"]);
  engine.dispose();
});
test("failed model verification retires the instance and permits retry", async () => {
  let created = 0;
  const engine = modelHarness({ async create() {
    created++;
    return { async translate() { return created === 1 ? "" : "礼物"; }, destroy() {} };
  } });
  await assert.rejects(engine.prepare(pair, { verifyText: "Gift" }), { code: "BROWSER_VERIFY_FAILED" });
  assert.equal(engine.ready(pair), false);
  await engine.prepare(pair, { verifyText: "Gift" });
  assert.equal(engine.ready(pair), true);
  engine.dispose();
});
test("verification status has both interface languages", () => {
  for (const key of ["verifying", "BROWSER_VERIFY_FAILED"]) {
    assert.equal(typeof en["content.basic." + key], "string");
    assert.equal(typeof zh_CN["content.basic." + key], "string");
  }
});
