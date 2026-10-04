import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import { waitFor } from "@testing-library/dom";
import { CONTENT_SCRIPT_FILES } from "../src/shared/constants.js";
import { preSwitchRuntimeMapping } from "../e2e/support/runtime-mapping.mjs";

async function load(files) {
  const errors = [], requests = [], virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><main><p id="source">This is a synthetic ordinary sentence.</p></main>',
    { url: "https://fixture.invalid/article", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  Object.defineProperty(window, "crypto", { value: webcrypto });
  Object.assign(window, { TextEncoder, TextDecoder,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    chrome: { runtime: { getURL: (path) => `chrome-extension://synthetic/${path}`, onMessage: { addListener() {} },
      sendMessage(request, callback) {
        requests.push(request);
        callback(request.type === "SELECTION_RESOLVE"
          ? { ok: true, route: "translation", intent: { sourceLanguage: "en" } }
          : { ok: true, context: {} });
      } }, storage: { local: { async get() { return {}; }, async set() {} }, onChanged: { addListener() {} } } }
  });
  window.Range.prototype.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 30, width: 90, height: 20 });
  const reads = await Promise.allSettled(files.map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));
  for (let index = 0; index < reads.length; index++) {
    assert.equal(reads[index].status, "fulfilled", files[index]);
    window.eval(reads[index].value);
  }
  return { dom, window, requests, errors, app: window.__TRANSLATE_FLOW_CONTENT__ };
}

test("immutable old registration loading new bytes keeps required content modules and a recoverable translation path", async () => {
  const h = await load(preSwitchRuntimeMapping.contentScripts);
  try {
    for (const name of ["runtime", "appearance", "tasks", "dom", "processor", "auto", "selectionController", "quickControl", "subtitleController"]) {
      assert.ok(h.app.modules[name], `${name} must register during the old-list/new-bytes window`);
    }
    assert.equal(h.app.loaded, true); assert.equal(h.app.modules.selectionTranslationQuery, undefined);
    assert.equal(h.app.modules.selectionRichResultRenderer, undefined); assert.deepEqual(h.errors, []);
    const node = h.window.document.querySelector("#source").firstChild, range = h.window.document.createRange();
    range.selectNodeContents(node); h.window.getSelection().addRange(range);
    h.window.document.dispatchEvent(new h.window.Event("selectionchange"));
    const root = h.app.modules.uiHost.getShadowRoot();
    await waitFor(() => assert.ok(root.querySelector(".tf-selection-chip")), { container: h.window.document });
    root.querySelector(".tf-selection-chip").click();
    await waitFor(() => assert.match(root.textContent, /扩展已更新，请刷新网页后重新查询。/u), { container: h.window.document });
    assert.equal(h.requests.some((request) => ["TRANSLATE_BATCH", "CACHE_LOOKUP", "CACHE_STORE"].includes(request.type)), false);
    assert.equal(h.requests.some((request) => request.method?.startsWith("reading.")), false);
    assert.deepEqual(h.errors, []);
    const result = h.window.document.createElement("div");
    h.app.modules.selectionResultRenderer.render(result, { primaryMeaning: "Existing visible result" });
    let lookups = 0;
    assert.equal(h.app.modules.selectionResultRenderer.appendRichDictionaryCards(result, [{ id: "synthetic" }], () => lookups++).length, 0);
    assert.equal(h.app.modules.selectionResultRenderer.appendRichDictionaryDetails(result,
      { dictionaries: [{ id: "synthetic", richRecord: { rawRecord: "PRIVATE_RAW" } }] }), false);
    assert.match(result.textContent, /Existing visible result/u);
    assert.match(result.textContent, /扩展已更新，请刷新网页后查看详细词典释义。/u);
    assert.doesNotMatch(result.textContent, /PRIVATE_RAW/u); assert.equal(lookups, 0);
  } finally { h.dom.window.close(); }
});

test("fresh current registration includes the current Selection projection and delivers the actual Rich display hook", async () => {
  const h = await load(CONTENT_SCRIPT_FILES);
  try {
    assert.ok(h.app.modules.selectionTranslationQuery); assert.ok(h.app.modules.selectionRichResultRenderer);
    assert.equal(h.app.loaded, true); assert.deepEqual(h.errors, []);
    const container = h.window.document.createElement("div"), displayed = [];
    const [card] = h.app.modules.selectionResultRenderer.appendRichDictionaryCards(container,
      [{ id: "synthetic", expandedByDefault: true }]);
    card.setResult({ id: "synthetic", headword: "term", packVersion: "actual-v1", text: "Actual safe summary" },
      "synthetic", (record) => displayed.push(record));
    assert.equal(displayed.length, 1); assert.equal(displayed[0].text, "Actual safe summary");
    assert.equal(displayed[0].packVersion, "actual-v1");
  } finally { h.dom.window.close(); }
});
