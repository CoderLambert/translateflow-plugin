import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const selectionSource = (name) => new URL(`../src/content/selection/${name}.js`, import.meta.url);
const miss = { ok: true, found: false, dictionaries: [], errors: [] };
const hit = (id, text = "synthetic definition") => ({ ok: true, found: true, dictionaries: [{ id, text }], errors: [] });
const failure = { ok: false, errorCode: "INDEX_UNAVAILABLE" };
const dictionary = (id, options = {}) => ({ id, title: id, status: "ready", ...options });

for (const [name, firstResult, secondResult, expectedEmpty, expectedTitle] of [
  ["structured no-hit plus rich hit", miss, hit("second"), false, ""],
  ["all executed dictionaries return no-hit", miss, miss, true, "content.selection.localEmptyTitle"],
  ["error plus no-hit", failure, miss, true, "content.rich.queryFailed"],
  ["error plus hit", failure, hit("second"), false, ""]
]) {
  test(name, async () => {
    const h = await createHarness([dictionary("preferred", { preferred: true }), dictionary("second", { expandedByDefault: true })]);
    await h.start();
    await h.complete("preferred", firstResult);
    await h.complete("second", secondResult);
    assert.equal(h.nodes("tf-selection-empty").length > 0, expectedEmpty);
    if (expectedTitle) assert.equal(h.nodes("tf-selection-empty-title")[0].textContent, expectedTitle);
    assert.equal(h.summary().allNoHit, firstResult === miss && secondResult === miss);
    assert.equal(h.summary().hasHit, secondResult.found === true);
    assert.deepEqual(h.cards().map((card) => card.dataset.state), [firstResult.ok ? "empty" : "error", secondResult.found ? "success" : "empty"]);
    if (secondResult.found) assert.match(h.cards()[1].textContent, /synthetic definition/);
  });
}

test("unexpanded dictionaries remain unqueried after a preferred no-hit, and opening the second hit clears global no-hit", async () => {
  const h = await createHarness([dictionary("preferred", { preferred: true }), dictionary("second")]);
  await h.start();
  await h.complete("preferred", miss);
  assert.equal(h.summary().counts.unqueried, 1);
  assert.equal(h.summary().allNoHit, false);
  assert.equal(h.summary().hasHit, false);
  assert.equal(h.nodes("tf-selection-empty-message")[0].textContent, "content.rich.queryOnOpen");
  assert.equal(h.sentLookups().length, 1);
  h.open("second");
  await flush();
  await h.complete("second", hit("second"));
  assert.equal(h.nodes("tf-selection-empty").length, 0);
});

test("cards alone keep the recovery surface and do not imply a lookup or success", async () => {
  const h = await createHarness([dictionary("closed")]);
  await h.start();
  assert.equal(h.sentLookups().length, 0);
  assert.equal(h.nodes("tf-selection-empty").length, 1);
  assert.equal(h.nodes("tf-selection-empty-message")[0].textContent, "content.rich.queryOnOpen");
  assert.equal(h.summary().counts.unqueried, 1);
  assert.equal(h.summary().allNoHit, false);
});

test("rich outcomes never replace the structured primary, even when every rich dictionary misses", async () => {
  const h = await createHarness([dictionary("one", { preferred: true })]);
  await h.start({ primary: true });
  await h.complete("one", miss);
  assert.equal(h.nodes("tf-selection-primary")[0].textContent, "structured meaning");
  assert.equal(h.nodes("tf-selection-empty").length, 0);
  assert.equal(h.nodes("tf-selection-result")[0].dataset.resultKind, "local");
});

test("queue summaries distinguish queued from pending and retry clears the previous error", async () => {
  const h = await createHarness(Array.from({ length: 4 }, (_, index) => dictionary(`dict-${index}`, { expandedByDefault: true })));
  await h.start();
  assert.equal(h.summary().counts.pending, 3);
  assert.equal(h.summary().counts.queued, 1);
  assert.equal(h.sentLookups().length, 3);
  await h.complete("dict-0", failure);
  assert.equal(h.summary().counts.pending, 3);
  assert.equal(h.summary().counts.error, 1);
  assert.equal(h.summary().counts.queued, 0);
  await h.complete("dict-1", miss);
  await h.complete("dict-2", miss);
  await h.complete("dict-3", miss);
  assert.equal(h.nodes("tf-selection-empty-title")[0].textContent, "content.rich.queryFailed");
  h.nodes("tf-selection-rich-retry")[0].dispatch("click");
  await flush();
  assert.equal(h.summary().counts.error, 0);
  assert.equal(h.summary().counts.pending, 1);
  await h.complete("dict-0", hit("dict-0"));
  assert.equal(h.summary().hasHit, true);
  assert.equal(h.nodes("tf-selection-empty").length, 0);
});

test("unavailable dictionaries and viewer-list failures never masquerade as no-hit", async () => {
  const h = await createHarness([dictionary("broken", { status: "missing" }), dictionary("ready", { preferred: true })]);
  await h.start();
  await h.complete("ready", miss);
  assert.equal(h.summary().counts.unavailable, 1);
  assert.equal(h.summary().allNoHit, false);
  assert.equal(h.nodes("tf-selection-empty-title")[0].textContent, "content.rich.queryFailed");
  const failedList = await createHarness([], { listResponse: { ok: false } });
  await failedList.start();
  assert.equal(failedList.summary().listState, "error");
  assert.equal(failedList.nodes("tf-selection-empty-title")[0].textContent, "content.rich.queryFailed");
});

test("cancellation responses remain cancelled, not no-hit, and can retry", async () => {
  const h = await createHarness([dictionary("one", { preferred: true })]);
  await h.start();
  await h.complete("one", { ok: true, cancelled: true, found: false });
  assert.equal(h.summary().counts.cancelled, 1);
  assert.equal(h.summary().allNoHit, false);
  assert.equal(h.nodes("tf-selection-empty-message")[0].textContent, "content.rich.selectionChanged");
  h.nodes("tf-selection-rich-retry")[0].dispatch("click");
  await flush();
  await h.complete("one", hit("one"));
  assert.equal(h.summary().hasHit, true);
});

test("a reported hit with a missing requested record is an error, never a no-hit", async () => {
  const h = await createHarness([dictionary("one", { preferred: true })]);
  await h.start();
  await h.complete("one", { ok: true, found: true, dictionaries: [], errors: [] });
  assert.equal(h.summary().counts.error, 1);
  assert.equal(h.summary().allNoHit, false);
  assert.equal(h.cards()[0].dataset.state, "error");
});

test("cancelled sessions ignore late hits while the fresh session remains authoritative", async () => {
  const h = await createHarness([dictionary("one", { preferred: true })]);
  await h.start();
  const oldRequest = h.sentLookups()[0];
  await h.module.cancel();
  await h.start({ version: 2 });
  const latestSummary = h.summary();
  const summaryCount = h.summaries.length;
  await h.completeRequest(oldRequest.requestId, hit("one", "stale gloss"));
  assert.equal(h.summaries.length, summaryCount);
  assert.equal(h.summary(), latestSummary);
  assert.equal(h.nodes("tf-selection-empty").length, 1);
  assert.doesNotMatch(h.layer.textContent, /stale gloss/);
  await h.complete("one", hit("one", "fresh gloss"));
  assert.match(h.layer.textContent, /fresh gloss/);
  assert.equal(h.nodes("tf-selection-empty").length, 0);
});

test("a changed selection generation suppresses both summary and card writes without explicit cancel", async () => {
  const h = await createHarness([dictionary("one", { preferred: true })]);
  await h.start();
  const summaryCount = h.summaries.length;
  h.invalidate();
  await h.complete("one", hit("one", "stale generation"));
  assert.equal(h.summaries.length, summaryCount);
  assert.equal(h.cards()[0].dataset.state, "loading");
  assert.doesNotMatch(h.layer.textContent, /stale generation/);
});

test("render failures clear deferred results and recover through retry without duplicating onDisplay", async () => {
  let throwRender = true;
  const h = await createHarness([dictionary("one", { preferred: true })], { renderPlainText(body, text) {
    if (throwRender) throw new Error("synthetic renderer failure");
    body.textContent = text;
  } });
  await h.start();
  await h.complete("one", hit("one"));
  assert.equal(h.cards()[0].dataset.state, "error");
  assert.equal(h.summary().counts.error, 1);
  assert.equal(h.summary().hasHit, false);
  h.open("one", false);
  h.open("one");
  assert.equal(h.cards()[0].dataset.state, "error");
  throwRender = false;
  h.nodes("tf-selection-rich-retry")[0].dispatch("click");
  await flush();
  // Collapse after requesting: a successfully delivered result can be displayed later.
  h.open("one", false);
  await h.complete("one", hit("one"));
  assert.equal(h.summary().hasHit, true);
  assert.equal(h.displayed.length, 0);
  h.open("one");
  assert.equal(h.displayed.length, 1);
  h.open("one", false);
  h.open("one");
  assert.equal(h.displayed.length, 1);
});

test("a deferred renderer failure replaces its earlier hit summary with an error and remains retryable", async () => {
  let throwRender = true;
  const h = await createHarness([dictionary("one", { preferred: true })], { renderPlainText(body, text) {
    if (throwRender) throw new Error("synthetic deferred renderer failure");
    body.textContent = text;
  } });
  await h.start();
  h.open("one", false);
  await h.complete("one", hit("one"));
  assert.equal(h.summary().hasHit, true);
  h.open("one");
  assert.equal(h.cards()[0].dataset.state, "error");
  assert.equal(h.summary().hasHit, false);
  assert.equal(h.summary().counts.error, 1);
  assert.equal(h.nodes("tf-selection-empty-title")[0].textContent, "content.rich.queryFailed");
  throwRender = false;
  h.nodes("tf-selection-rich-retry")[0].dispatch("click");
  await flush();
  await h.complete("one", hit("one"));
  assert.equal(h.summary().hasHit, true);
  assert.equal(h.displayed.length, 1);
});

async function createHarness(dictionaries, { listResponse = null, renderPlainText = (body, text) => { body.textContent = text; } } = {}) {
  const document = new FakeDocument();
  const layer = document.createElement("div");
  const sent = [], summaries = [], pending = new Map(), displayed = [];
  let currentVersion = 1;
  const app = { modules: {
    contentI18n: createContentI18nStub(),
    runtime: {
      messages: { background: { RICH_MDICT_VIEWER_LIST: "list", RICH_MDICT_LOOKUP: "lookup", RICH_MDICT_LOOKUP_CANCEL: "cancel" } },
      sendRuntimeMessage(message) {
        sent.push(message);
        if (message.type === "list") return Promise.resolve(listResponse || { ok: true, dictionaries });
        if (message.type === "cancel") return Promise.resolve({ ok: true, cancelled: true });
        return new Promise((resolve) => pending.set(message.requestId, resolve));
      }
    },
    selection: { installInteractionIsolation() {}, clearPageSelection() {}, positionPopover() {} },
    uiHost: { getLayer: () => layer, ownsNode: () => false, createFocusReturn: () => ({ capture() {}, clear() {}, restore() {} }), isEventInsidePanel: () => false },
    uiPrimitives: {
      button: ({ text, className = "" }) => { const node = document.createElement("button"); node.textContent = text; node.className = className; return node; },
      surface: ({ className }) => { const node = document.createElement("section"); node.className = className; return node; },
      status: ({ className }) => { const node = document.createElement("div"); node.className = className; return node; },
      setStatus: (node, text) => { node.textContent = text; }
    },
    selectionAiDetail: { create: () => ({ reset() {}, ensure() {}, choices() {} }) },
    selectionRichViewer: { renderPlainText }
  } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document, requestAnimationFrame: (callback) => callback() });
  for (const name of ["empty-state", "rich-result-renderer", "result-renderer", "popover", "rich-details"]) {
    vm.runInContext(await readFile(selectionSource(name), "utf8"), context);
  }
  const update = app.modules.selectionPopover.updateRichDictionarySummary;
  app.modules.selectionPopover.updateRichDictionarySummary = (snapshot, summary) => {
    assert.ok(Object.isFrozen(summary) && Object.isFrozen(summary.counts) && Object.isFrozen(summary.dictionaries));
    summaries.push(summary);
    update(snapshot, summary);
  };
  const nodes = (className) => findClass(layer, className);
  const sentLookups = () => sent.filter((message) => message.type === "lookup");
  const completeRequest = async (requestId, result) => { pending.get(requestId)(result); pending.delete(requestId); await flush(); };
  return {
    module: app.modules.selectionRichDetails, layer, summaries, displayed, nodes, sentLookups,
    summary: () => summaries.at(-1),
    cards: () => nodes("tf-selection-rich-record"),
    invalidate() { currentVersion += 1; },
    async start({ primary = false, version = currentVersion } = {}) {
      currentVersion = version;
      const snapshot = { text: "syntheticword" };
      if (primary) app.modules.selectionPopover.showResult(snapshot, { kind: "local", primaryMeaning: "structured meaning" });
      else app.modules.selectionPopover.showEmpty(snapshot, { titleKey: "content.selection.localEmptyTitle", messageKey: "content.selection.localEmptyHelp", onTranslate() {} });
      await this.module.load(snapshot, version, "page", (expected) => expected === currentVersion, (result) => displayed.push(result));
      await flush();
    },
    open(id, open = true) { const card = this.cards().find((node) => node.dataset.dictionaryId === id); card.open = open; card.dispatch("toggle"); },
    completeRequest,
    async complete(id, result) {
      const request = sentLookups().findLast((message) => message.dictionaryId === id && pending.has(message.requestId));
      assert.ok(request, `pending request for ${id}`);
      await completeRequest(request.requestId, result);
    }
  };
}

async function flush() { await new Promise((resolve) => setImmediate(resolve)); }
function findClass(root, className) {
  return [root, ...root.children.flatMap((node) => findClass(node, className))].filter((node) => node.className.split(/\s+/u).includes(className));
}
class FakeDocument {
  createElement(tag) { return new FakeElement(tag); }
  createDocumentFragment() { return new FakeElement("fragment"); }
}
class FakeElement {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.className = ""; this.text = ""; this.hidden = false; this.open = false; this.isConnected = true; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  appendChild(node) { node.remove(); this.children.push(node); node.parentNode = this; return node; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this); this.parentNode = null; }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.text = ""; this.append(...nodes); }
  set textContent(text) { this.replaceChildren(); this.text = String(text || ""); }
  get textContent() { return this.text + this.children.map((node) => node.textContent).join(""); }
  get childElementCount() { return this.children.length; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
  removeEventListener() {}
  dispatch(name) { for (const callback of this.listeners.get(name) || []) callback({ target: this, preventDefault() {}, stopPropagation() {} }); }
  focus() {}
}
