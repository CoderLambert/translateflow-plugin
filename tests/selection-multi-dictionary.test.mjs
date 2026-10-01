import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const RENDERER = new URL("../src/content/selection/result-renderer.js", import.meta.url);
const DETAILS = new URL("../src/content/selection/rich-details.js", import.meta.url);
const RUNTIME = new URL("../src/content/runtime.js", import.meta.url);

test("rich dictionary cards keep configured order and lazily follow expandedByDefault", async () => {
  const { renderer, document } = await loadRenderer();
  const container = document.createElement("div");
  const opened = [];
  const dictionaries = [
    { id: "second", title: "Second", order: 20, expandedByDefault: false },
    { id: "first", title: "First", order: 10, expandedByDefault: true },
    { id: "third", title: "Third", order: 30, expandedByDefault: false }
  ];

  const cards = renderer.appendRichDictionaryCards(container, dictionaries, (dictionary) => {
    opened.push(dictionary.id);
  });

  const cardNodes = findClass(container, "tf-selection-rich-record");
  assert.deepEqual(cardNodes.map((node) => node.dataset.dictionaryId), ["first", "second", "third"]);
  assert.deepEqual(cardNodes.map((node) => findClass(node, "tf-selection-rich-order")[0].textContent), ["1", "2", "3"]);
  assert.deepEqual(cardNodes.map((node) => findClass(node, "tf-selection-rich-order")[0].attributes.get("aria-label")), [
    "词典顺序 1", "词典顺序 2", "词典顺序 3"
  ]);
  assert.deepEqual(cardNodes.map((node) => node.open), [true, false, false]);
  assert.deepEqual(opened, ["first"]);
  assert.deepEqual(cardNodes.map((node) => node.dataset.state), ["idle", "idle", "idle"]);

  cardNodes[1].open = true;
  cardNodes[1].dispatch("toggle");
  assert.deepEqual(opened, ["first", "second"]);
  assert.equal(cards.length, 3);
});

test("rich card results pass through the reviewed sanitizer and keep resource lookup on that dictionary", async () => {
  const sanitizerCalls = [];
  const viewerCalls = [];
  const { renderer, document } = await loadRenderer({
    sanitizer: {
      sanitizeRichDictionaryRecord(record) {
        sanitizerCalls.push(record);
        return { nodes: [{ type: "text", text: "safe tree" }], truncated: false };
      }
    },
    viewer: {
      render(body, tree, fallback, options) {
        viewerCalls.push({ tree, fallback, options });
        body.textContent = "safe tree";
        return true;
      },
      renderPlainText(body, text) {
        body.textContent = text;
        return true;
      }
    }
  });
  const container = document.createElement("div");
  const cards = renderer.appendRichDictionaryCards(container, [{
    id: "curated-pack",
    title: "<img onerror=alert(1)>",
    trustLabel: "Curated provenance",
    format: "MDX",
    order: 1,
    expandedByDefault: true
  }]);
  const rawRecord = { rawRecord: "<b>untrusted</b>", format: "HTML", styleSheetRules: [] };

  cards[0].setResult({ id: "curated-pack", headword: "word", text: "safe fallback", richRecord: rawRecord }, "curated-pack");

  assert.deepEqual(sanitizerCalls, [rawRecord]);
  assert.deepEqual(JSON.parse(JSON.stringify(viewerCalls)), [{
    tree: { nodes: [{ type: "text", text: "safe tree" }], truncated: false },
    fallback: "safe fallback",
    options: { preserveNewlines: false, dictionaryId: "curated-pack" }
  }]);
  const card = findClass(container, "tf-selection-rich-record")[0];
  assert.equal(card.dataset.state, "success");
  assert.equal(findClass(card, "tf-selection-rich-title")[0].textContent, "<img onerror=alert(1)>");
  assert.equal(findClass(card, "tf-selection-rich-trust")[0].textContent, "来源 / 信任：Curated provenance");
  assert.equal(findClass(card, "tf-selection-rich-format")[0].textContent, "MDX");
});

test("dictionary lookups carry dictionaryId and isolate loading, errors, and stale responses", async () => {
  const pending = new Map();
  const sent = [];
  const cards = new Map();
  let lookupHandler;
  let current = true;
  const messages = {
    background: {
      RICH_MDICT_VIEWER_LIST: "RICH_MDICT_VIEWER_LIST",
      RICH_MDICT_LOOKUP: "RICH_MDICT_LOOKUP"
    }
  };
  const app = { modules: {
    runtime: {
      messages,
      sendRuntimeMessage(message) {
        sent.push(message);
        if (message.type === messages.background.RICH_MDICT_VIEWER_LIST) {
          return Promise.resolve({ ok: true, dictionaries: [
            { id: "alpha", title: "Alpha", order: 1, status: "ready" },
            { id: "beta", title: "Beta", order: 2, status: "ready" }
          ] });
        }
        return new Promise((resolve, reject) => pending.set(message.dictionaryId, { resolve, reject }));
      }
    },
    selectionPopover: {
      appendRichDictionaryCards(dictionaries, onLookup) {
        for (const dictionary of dictionaries) cards.set(dictionary.id, createCardState());
        lookupHandler = onLookup;
        return true;
      }
    }
  } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app });
  vm.runInContext(await readFile(DETAILS, "utf8"), context);
  const module = app.modules.selectionRichDetails;
  const snapshot = { text: "word" };
  await module.load(snapshot, 4, "page", () => current);

  lookupHandler({ id: "alpha", status: "ready" }, cards.get("alpha"));
  lookupHandler({ id: "beta", status: "ready" }, cards.get("beta"));
  await flushMicrotasks();
  assert.deepEqual(sent.slice(1).map((message) => message.dictionaryId), ["alpha", "beta"]);
  assert.deepEqual([...cards.values()].map((card) => card.state), ["loading", "loading"]);

  pending.get("beta").resolve({ ok: false, errorCode: "INDEX_UNAVAILABLE" });
  await flushMicrotasks();
  assert.equal(cards.get("beta").state, "error");
  assert.equal(cards.get("alpha").state, "loading");

  current = false;
  pending.get("alpha").resolve({
    ok: true,
    found: true,
    dictionaries: [{ id: "alpha", title: "Alpha", text: "stale result" }],
    errors: []
  });
  await flushMicrotasks();
  assert.equal(cards.get("alpha").state, "loading");
  assert.equal(cards.get("alpha").results.length, 0);
});


test("rich dictionary lookup scheduler caps concurrency and drops stale queued work", async () => {
  const pending = new Map();
  const sent = [];
  const cards = new Map();
  let lookupHandler;
  let current = true;
  const dictionaries = Array.from({ length: 8 }, (_, index) => ({
    id: `dictionary-${index + 1}`,
    title: `Dictionary ${index + 1}`,
    order: index,
    status: "ready"
  }));
  const messages = {
    background: {
      RICH_MDICT_VIEWER_LIST: "RICH_MDICT_VIEWER_LIST",
      RICH_MDICT_LOOKUP: "RICH_MDICT_LOOKUP"
    }
  };
  const app = { modules: {
    runtime: {
      messages,
      sendRuntimeMessage(message) {
        sent.push(message);
        if (message.type === messages.background.RICH_MDICT_VIEWER_LIST) {
          return Promise.resolve({ ok: true, dictionaries });
        }
        return new Promise((resolve) => pending.set(message.dictionaryId, resolve));
      }
    },
    selectionPopover: {
      appendRichDictionaryCards(items, onLookup) {
        for (const dictionary of items) cards.set(dictionary.id, createCardState());
        lookupHandler = onLookup;
        return true;
      }
    }
  } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app });
  vm.runInContext(await readFile(DETAILS, "utf8"), context);
  await app.modules.selectionRichDetails.load({ text: "word" }, 5, "page", () => current);

  for (const dictionary of dictionaries) {
    lookupHandler(dictionary, cards.get(dictionary.id));
  }
  await flushMicrotasks();

  const lookupMessages = () => sent.filter((message) => message.type === messages.background.RICH_MDICT_LOOKUP);
  assert.equal(lookupMessages().length, 3, "only three rich lookups may run concurrently");

  pending.get("dictionary-1")({ ok: true, found: false, dictionaries: [], errors: [] });
  await flushMicrotasks();
  assert.equal(lookupMessages().length, 4, "one queued lookup starts when a slot is released");

  current = false;
  for (const id of ["dictionary-2", "dictionary-3", "dictionary-4"]) {
    pending.get(id)({ ok: true, found: false, dictionaries: [], errors: [] });
  }
  await flushMicrotasks();
  assert.equal(lookupMessages().length, 4, "stale queued selection work must not issue new background lookups");
});

test("content runtime exposes the independent viewer-list message", async () => {
  const source = await readFile(RUNTIME, "utf8");
  assert.match(source, /RICH_MDICT_VIEWER_LIST:\s*"RICH_MDICT_VIEWER_LIST"/u);
});

async function loadRenderer({
  sanitizer = { sanitizeRichDictionaryRecord: () => ({ nodes: [], truncated: false }) },
  viewer = {
    render(body, tree, fallback) {
      body.textContent = fallback;
      return true;
    },
    renderPlainText(body, text) {
      body.textContent = text;
      return true;
    }
  }
} = {}) {
  const document = new FakeDocument();
  const app = { modules: { selectionRichSanitizer: sanitizer, selectionRichViewer: viewer } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document });
  vm.runInContext(await readFile(RENDERER, "utf8"), context);
  return { renderer: app.modules.selectionResultRenderer, document };
}

function createCardState() {
  return {
    state: "idle",
    results: [],
    setLoading() { this.state = "loading"; },
    setError(message) { this.state = "error"; this.message = message; },
    setEmpty(message) { this.state = "empty"; this.message = message; },
    setResult(record, dictionaryId) { this.state = "success"; this.results.push({ record, dictionaryId }); }
  };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function findClass(root, className) {
  const matches = [];
  const visit = (node) => {
    if (String(node.className || "").split(/\s+/u).includes(className)) matches.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return matches;
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.text = "";
    this.open = false;
    this.className = "";
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.text = "";
    this.append(...nodes);
  }

  set textContent(value) {
    this.children = [];
    this.text = String(value ?? "");
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent || "").join("");
  }

  get childElementCount() { return this.children.length; }

  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ preventDefault() {}, stopPropagation() {}, ...event });
  }
}
