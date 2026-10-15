import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as contract from "../src/shared/browser-translation.js";
import * as language from "../src/shared/browser-language.js";
const text = await readFile(new URL("../src/content/browser-translation.js", import.meta.url), "utf8");
const pair = { sourceLanguage: "en", targetLanguage: "zh" };
function setup(Translator, LanguageDetector) {
  const app = { modules: { browserTranslationContract: { ...contract, ...language } } };
  const host = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, Translator, LanguageDetector, isSecureContext: true,
    AbortController, setTimeout, clearTimeout });
  vm.runInContext(text, host);
  return { engine: app.modules.browserTranslation, host };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("load, capability and a downloadable detector never trigger hidden downloads", async () => {
  let creates = 0;
  const api = { availability: async () => "downloadable", create: () => { creates++; throw new Error("unexpected"); } };
  const { engine } = setup(api, api);
  assert.equal(await engine.capability(pair), "downloadable");
  assert.equal((await engine.detectDecision("A sentence in English")).language, "");
  assert.equal(creates, 0); engine.dispose();
});
test("preparation starts within click stack, shares creation and separates caller/instance lifetime", async () => {
  let creates = 0, modelSignal, destroyed = 0;
  const pending = deferred();
  const { engine } = setup({ create(options) { creates++; modelSignal = options.signal; return pending.promise; } });
  const first = new AbortController(), second = new AbortController();
  const a = engine.prepare(pair, { signal: first.signal });
  assert.equal(creates, 1);
  const b = engine.prepare(pair, { signal: second.signal }); assert.equal(creates, 1);
  first.abort(); await assert.rejects(a, { code: "CANCELLED" }); assert.equal(modelSignal.aborted, false);
  pending.resolve({ translate: async value => value, destroy() { destroyed++; } }); await b;
  second.abort(); assert.equal(engine.ready(pair), true); assert.equal(modelSignal.aborted, false);
  engine.dispose(); assert.equal(destroyed, 1);
});
test("cancelling all preparation consumers releases late resources", async () => {
  let destroyed = 0; const pending = deferred(), controller = new AbortController();
  const { engine } = setup({ create: () => pending.promise });
  const preparing = engine.prepare(pair, { signal: controller.signal }); controller.abort();
  await assert.rejects(preparing, { code: "CANCELLED" });
  pending.resolve({ destroy() { destroyed++; } }); await tick();
  assert.equal(destroyed, 1); assert.equal(engine.ready(pair), false); engine.dispose();
});
test("one caller cancels without interrupting a shared translator's queued peer", async () => {
  const gate = deferred(); let entered = 0, active = 0, maxActive = 0, destroyed = 0;
  const { engine } = setup({ create: async () => ({ async translate(value) { entered++; active++; maxActive = Math.max(maxActive, active); if (value === "one") await gate.promise; active--; return value + " translated"; }, destroy() { destroyed++; } }) });
  await engine.prepare(pair);
  const first = new AbortController();
  const a = engine.execute({ pair, signal: first.signal, segments: [{ id: "a", text: "one" }] });
  const b = engine.execute({ pair, segments: [{ id: "b", text: "two" }] });
  await tick(); assert.equal(entered, 1); first.abort(); await assert.rejects(a, { code: "CANCELLED" });
  assert.equal(entered, 1); gate.resolve(); const result = await b;
  assert.equal(result.translations[0].text, "two translated"); assert.equal(maxActive, 1); assert.equal(destroyed, 0); engine.dispose();
});
test("at most two translator pairs are retained, idle eviction does not delete browser language packs", async () => {
  let created = 0, destroyed = 0;
  const { engine } = setup({ create: async () => { created++; return { destroy() { destroyed++; } }; } });
  for (const sourceLanguage of ["en", "fr", "de"]) await engine.prepare({ ...pair, sourceLanguage });
  assert.equal(created, 3); assert.equal(destroyed, 1); assert.equal(engine.ready(pair), false); engine.dispose();
});
test("short selections use native confidence and cannot inherit the page locale", async () => {
  let created = 0, detected = 0;
  const { engine } = setup({}, { availability: async () => "available", create: async () => { created++; return { detect: async () => { detected++; return [{ detectedLanguage: "en", confidence: .71 }]; }, destroy() {} }; } });
  assert.equal(await engine.detect("Actually", "zh-CN"), "en");
  assert.equal(await engine.detect("Actually", "es"), "en");
  assert.equal(created, 1); assert.equal(detected, 1); engine.dispose();
});
test("cancelling detection rejects immediately and does not publish late decisions", async () => {
  const pending = deferred(), controller = new AbortController();
  const { engine } = setup({}, { availability: async () => "available", create: async () => ({ detect: () => pending.promise, destroy() {} }) });
  const p = engine.detectDecision("long English sample", { signal: controller.signal }); await tick(); controller.abort();
  await assert.rejects(p, { code: "CANCELLED" }); pending.resolve([{ detectedLanguage: "en", confidence: .99 }]); await tick(); engine.dispose();
});
test("same-language requests use no model; protected spans never enter translation input", async () => {
  const inputs = [];
  const { engine } = setup({ create: async () => ({ translate: async value => { inputs.push(value); return "译"; }, destroy() {} }) });
  await engine.execute({ pair: { sourceLanguage: "zh", targetLanguage: "zh" }, segments: [{ id: "a", text: "原文" }] });
  assert.equal(inputs.length, 0); await engine.prepare(pair);
  const result = await engine.execute({ pair, segments: [{ id: "b", text: "Read ⟦TF:0:S⟧npm test⟦TF:0:E⟧ now", protectedIds: [0] }] });
  assert.deepEqual(inputs, ["Read", "now"]); assert.match(result.translations[0].text, /npm test/); engine.dispose();
});
test("invalid model results fail rather than entering translation caches", async () => {
  const { engine } = setup({ create: async () => ({ translate: async () => undefined, destroy() {} }) });
  await engine.prepare(pair);
  await assert.rejects(engine.execute({ pair, segments: [{ id: "x", text: "text" }] }), { code: "BROWSER_RESULT" }); engine.dispose();
});
test("progress ignores NaN/out-of-range values and never moves backwards", async () => {
  const values = [];
  const { engine } = setup({ create: async options => { options.monitor({ addEventListener(_type, fn) { for (const loaded of [NaN, -.1, .4, .2, 1.2, 1]) fn({ loaded }); } }); return { destroy() {} }; } });
  await engine.prepare(pair, { progress: value => values.push(value) }); assert.deepEqual(values, [.4, .4, 1]); engine.dispose();
});
