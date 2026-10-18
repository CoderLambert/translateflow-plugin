import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as contract from "../src/shared/browser-translation.js";
import * as language from "../src/shared/browser-language.js";
import { en, zh_CN } from "../src/i18n/catalog-browser-translation.js";
const source = await readFile(new URL("../src/content/browser-translation-view.js", import.meta.url), "utf8");
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.attrs = {}; this.isConnected = true; this.value = ""; }
  append(...nodes) { this.children.push(...nodes); for (const node of nodes) node.parent = this; }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  remove() { this.isConnected = false; }
  focus() { this.focused = true; }
}
function all(element, tag) { return [...(element.tagName === tag ? [element] : []), ...element.children.flatMap(child => all(child, tag))]; }
function setup(engine) {
  const root = new Element("root"), document = { createElement: tag => new Element(tag), activeElement: new Element("button") };
  const app = { modules: { browserTranslationContract: { ...contract, ...language }, browserTranslation: { error: code => Object.assign(new Error(code), { code }), ...engine },
    contentI18n: { t: key => key.split(".").at(-1), get: () => ({ locale: "zh_CN" }) },
    uiPrimitives: { button: ({ text }) => { const button = new Element("button"); button.textContent = text; return button; }, surface: () => new Element("section") },
    uiHost: { getShadowRoot: () => ({}), getLayer: () => root } } };
  vm.runInNewContext(source, { __TRANSLATE_FLOW_CONTENT__: app, document, window: { addEventListener() {}, removeEventListener() {} },
    LanguageDetector: { create() {} }, AbortController, Intl });
  return { prompt: app.modules.browserTranslationView.prompt, root, byText: value => all(root, "button").find(button => button.textContent === value) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test("the primary first-use action initializes detection then continues automatically, without manual language confirmation", async () => {
  let calls = 0;
  const ui = setup({ prepareDetector() { calls++; return Promise.resolve(); }, detectDecision: async () => ({ language: "en", source: "detector", scriptKnown: true }) });
  const p = ui.prompt({ title: "prepareDetection", pair: { sourceLanguage: "", targetLanguage: "zh" }, detectText: "Actually" });
  assert.equal(calls, 0);
  const clicking = ui.byText("detectContinue").onclick({ isTrusted: true });
  assert.equal(calls, 1); await clicking;
  const result = await p; assert.equal(result.sourceLanguage, "en"); assert.equal(result.automatic, true);
});
test("uncertain detection remains in one panel and exposes an explicit manual fallback", async () => {
  const ui = setup({ prepareDetector: async () => {}, detectDecision: async () => ({ language: "", source: "unknown" }) });
  const p = ui.prompt({ title: "language", pair: { sourceLanguage: "", targetLanguage: "zh" }, detectText: "chat" });
  await ui.byText("detectContinue").onclick({ isTrusted: true });
  assert.equal(all(ui.root, "details")[0].open, true);
  assert.equal(all(ui.root, "p").some(node => node.textContent === "uncertain"), true);
  const select = all(ui.root, "select")[0]; select.value = "fr"; select.onchange();
  await ui.byText("continue").onclick({ isTrusted: true }); assert.equal((await p).sourceLanguage, "fr");
});
test("synthetic click cannot start model preparation", async () => {
  const ui = setup({ prepareDetector: () => assert.fail("untrusted click must not create") });
  const p = ui.prompt({ title: "language", pair: { sourceLanguage: "", targetLanguage: "zh" }, detectText: "a text" });
  await ui.byText("detectContinue").onclick({ isTrusted: false });
  ui.byText("cancel").onclick(); await assert.rejects(p, { code: "CANCELLED" });
});
test("cancelling during language detection ignores its late completion", async () => {
  let done;
  const ui = setup({ prepareDetector: async () => {}, detectDecision: () => new Promise(resolve => { done = resolve; }) });
  const p = ui.prompt({ title: "language", pair: { sourceLanguage: "", targetLanguage: "zh" }, detectText: "a text" });
  const click = ui.byText("detectContinue").onclick({ isTrusted: true }); await tick();
  ui.byText("cancel").onclick(); await assert.rejects(p, { code: "CANCELLED" });
  done({ language: "en", scriptKnown: true }); await click;
  assert.equal(all(ui.root, "section")[0].isConnected, false);
});
test("a manual same-language correction does not try to create an identity translator", async () => {
  const ui = setup({ prepare: () => assert.fail("same-language correction should restart and skip") });
  const p = ui.prompt({ title: "prepare", pair: { sourceLanguage: "en", targetLanguage: "zh" }, allowPrepare: true });
  all(ui.root, "select")[0].value = "zh";
  await ui.byText("prepareContinue").onclick({ isTrusted: true }); assert.equal((await p).sourceLanguage, "zh");
});
test("new interaction and error strings exist in both locales", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh_CN).sort());
  for (const code of ["prepareDetection", "detectContinue", "prepareContinue", "uncertain", "BROWSER_TIMEOUT", "BROWSER_RESULT", "alreadyTarget"]) {
    assert.equal(typeof en[`content.basic.${code}`], "string"); assert.equal(typeof zh_CN[`content.basic.${code}`], "string");
  }
});
