import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const RENDERER = new URL("../src/content/selection/result-renderer.js", import.meta.url);
const RICH_RENDERER = new URL("../src/content/selection/rich-result-renderer.js", import.meta.url);
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

test("derived personal preference opens first while preserving other expanded choices", async () => {
  const { renderer, document } = await loadRenderer();
  const container = document.createElement("div");
  const opened = [];
  renderer.appendRichDictionaryCards(container, [
    { id: "preferred", title: "Preferred", order: 0, preferred: true, expandedByDefault: false },
    { id: "also-expanded", title: "Also expanded", order: 1, preferred: false, expandedByDefault: true }
  ], (dictionary) => opened.push(dictionary.id));

  const cards = findClass(container, "tf-selection-rich-record");
  assert.deepEqual(cards.map((card) => card.open), [true, true]);
  assert.deepEqual(opened, ["preferred", "also-expanded"]);
  assert.equal(findClass(cards[0], "tf-selection-rich-preference")[0].textContent, "你的首选 · 个人偏好");
  assert.equal(findClass(cards[1], "tf-selection-rich-preference").length, 0);
});

test("structured Selection shows its primary dictionary entry and collapses additional detail", async () => {
  const { renderer, document } = await loadRenderer();
  const container = document.createElement("div");

  renderer.render(container, {
    kind: "local",
    headword: "persistent",
    pronunciation: "/pərˈsɪstənt/",
    partOfSpeech: "adjective",
    primaryMeaning: "持久的",
    dictionaryEntries: [
      {
        primary: true,
        kind: "lexical",
        headword: "persistent",
        partOfSpeech: "adjective",
        translations: ["持久的", "持续的"],
        examples: ["A real example from the source."],
        provenanceLabel: "本地词典"
      },
      {
        primary: false,
        kind: "lexical",
        headword: "persistent",
        partOfSpeech: "noun",
        translations: ["顽强的"],
        provenanceLabel: "本地词典"
      }
    ],
    moreEntryCount: 0,
    badges: [{ label: "本地词典", kind: "local" }]
  });

  assert.equal(findClass(container, "tf-selection-headword")[0].textContent, "persistent");
  assert.equal(findClass(container, "tf-selection-headword-meta")[0].textContent, "/pərˈsɪstənt/ · adjective");
  assert.equal(findClass(container, "tf-selection-primary")[0].textContent, "持久的");
  assert.equal(findClass(container, "tf-selection-example")[0].textContent, "A real example from the source.");
  assert.equal(findClass(container, "tf-selection-result-badge")[0].textContent, "本地词典");

  const disclosure = findClass(container, "tf-selection-dictionary-disclosure")[0];
  assert.equal(disclosure.open, false);
  assert.equal(findClass(disclosure, "tf-selection-dictionary-disclosure-summary")[0].textContent, "查看完整词典词条");
  assert.equal(findClass(disclosure, "tf-selection-dictionary-entry").length, 2);
});

test("expanded dictionary entries preserve every source example as text and leave missing examples empty", async () => {
  const { renderer, document } = await loadRenderer();
  const container = document.createElement("div");

  renderer.render(container, {
    kind: "local",
    headword: "persistent",
    primaryMeaning: "持久的",
    dictionaryEntries: [
      {
        primary: true,
        headword: "persistent",
        translations: ["持久的"],
        examples: ["Primary source example one.", "<img src=x onerror=alert(1)>", "Primary source example three."]
      },
      {
        primary: false,
        headword: "persistent",
        partOfSpeech: "noun",
        translations: ["顽强的"],
        examples: ["Secondary source example one.", "Secondary source example two."]
      },
      {
        primary: false,
        headword: "persistent",
        partOfSpeech: "adverb",
        translations: ["坚定地"]
      }
    ],
    moreEntryCount: 0
  });

  const summaryExamples = findClass(container, "tf-selection-example");
  assert.equal(summaryExamples[0].textContent, "Primary source example one.");
  const disclosure = findClass(container, "tf-selection-dictionary-disclosure")[0];
  assert.ok(disclosure);
  assert.equal(disclosure.open, false);

  disclosure.open = true;
  const entries = findClass(disclosure, "tf-selection-dictionary-entry");
  assert.equal(entries.length, 3);
  const examplesByEntry = entries.map((entry) =>
    findClass(entry, "tf-selection-entry-example").map((node) => node.textContent)
  );
  assert.deepEqual(examplesByEntry, [
    ["Primary source example one.", "<img src=x onerror=alert(1)>", "Primary source example three."],
    ["Secondary source example one.", "Secondary source example two."],
    []
  ]);
  assert.equal(findClass(entries[0], "tf-selection-entry-example")[1].children.length, 0);
});

test("a single-entry disclosure appears only when source details are hidden from the summary", async () => {
  const { renderer, document } = await loadRenderer();
  const renderSingleEntry = ({ entryExamples, resultExamples } = {}) => {
    const container = document.createElement("div");
    const entry = { primary: true, translations: ["core sense"] };
    if (entryExamples !== undefined) entry.examples = entryExamples;
    renderer.render(container, {
      kind: "local",
      headword: "word",
      dictionaryEntries: [entry],
      examples: resultExamples
    });
    return container;
  };

  const oneExample = renderSingleEntry({ entryExamples: ["Only source example."] });
  assert.equal(findClass(oneExample, "tf-selection-example").length, 1);
  assert.equal(findClass(oneExample, "tf-selection-dictionary-disclosure").length, 0);

  const multipleEntryExamples = renderSingleEntry({ entryExamples: ["First source example.", "Second source example."] });
  const entryDisclosure = findClass(multipleEntryExamples, "tf-selection-dictionary-disclosure")[0];
  assert.ok(entryDisclosure);
  assert.equal(findClass(multipleEntryExamples, "tf-selection-example")[0].textContent, "First source example.");
  entryDisclosure.open = true;
  assert.deepEqual(findClass(entryDisclosure, "tf-selection-entry-example").map((node) => node.textContent), [
    "First source example.", "Second source example."
  ]);

  const multipleFallbackExamples = renderSingleEntry({ resultExamples: ["Fallback example one.", "Fallback example two."] });
  const fallbackDisclosure = findClass(multipleFallbackExamples, "tf-selection-dictionary-disclosure")[0];
  assert.ok(fallbackDisclosure);
  assert.deepEqual(findClass(fallbackDisclosure, "tf-selection-entry-example").map((node) => node.textContent), [
    "Fallback example one.", "Fallback example two."
  ]);

  const noExamples = renderSingleEntry({ entryExamples: [] });
  assert.equal(findClass(noExamples, "tf-selection-example").length, 0);
  assert.equal(findClass(noExamples, "tf-selection-dictionary-disclosure").length, 0);
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
    options: { preserveNewlines: false, dictionaryId: "curated-pack", packageVersion: "" }
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

test("Selection change cancels active lookup IDs, drops old queued work, and starts fresh work at the shared cap", async () => {
  const dictionaries = Array.from({ length: 5 }, (_, index) => ({
    id: `dict-${index + 1}`,
    title: `Dictionary ${index + 1}`,
    status: "ready"
  }));
  const pending = new Map();
  const sent = [];
  const generations = new Map();
  let generation = 0;
  let active = 0;
  let maximumActive = 0;
  const messages = {
    background: {
      RICH_MDICT_VIEWER_LIST: "RICH_MDICT_VIEWER_LIST",
      RICH_MDICT_LOOKUP: "RICH_MDICT_LOOKUP",
      RICH_MDICT_LOOKUP_CANCEL: "RICH_MDICT_LOOKUP_CANCEL"
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
        if (message.type === messages.background.RICH_MDICT_LOOKUP_CANCEL) {
          return Promise.resolve({ ok: true, cancelled: true });
        }
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        return new Promise((resolve) => {
          pending.set(message.requestId, {
            message,
            generation,
            resolve(result) {
              active -= 1;
              resolve(result);
            }
          });
        });
      }
    },
    selectionPopover: {
      appendRichDictionaryCards(items, onLookup) {
        const cards = new Map(items.map((dictionary) => [dictionary.id, createCardState()]));
        generations.set(generation, { cards, onLookup });
      }
    }
  } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app });
  vm.runInContext(await readFile(DETAILS, "utf8"), context);
  const module = app.modules.selectionRichDetails;

  generation = 1;
  await module.load({ text: "old selection" }, 10, "page", () => true);
  const old = generations.get(1);
  for (const dictionary of dictionaries) old.onLookup(dictionary, old.cards.get(dictionary.id));
  await flushMicrotasks();

  const oldLookups = sent.filter((message) => message.type === messages.background.RICH_MDICT_LOOKUP);
  assert.equal(oldLookups.length, 3);
  assert.match(oldLookups[0].ownerToken, /^[a-f0-9]{32}$/u);
  assert.ok(oldLookups.every((message) => message.ownerToken === oldLookups[0].ownerToken));
  assert.equal(active, 3);
  await module.cancel();
  const cancellationIds = sent
    .filter((message) => message.type === messages.background.RICH_MDICT_LOOKUP_CANCEL)
    .map((message) => message.requestId);
  assert.deepEqual(cancellationIds.sort(), oldLookups.map((message) => message.requestId).sort());
  const cancellationMessages = sent.filter((message) => message.type === messages.background.RICH_MDICT_LOOKUP_CANCEL);
  assert.ok(cancellationMessages.every((message) => message.ownerToken === oldLookups[0].ownerToken));

  generation = 2;
  await module.load({ text: "fresh selection" }, 11, "page", () => true);
  const fresh = generations.get(2);
  for (const dictionary of dictionaries) fresh.onLookup(dictionary, fresh.cards.get(dictionary.id));
  await flushMicrotasks();
  assert.equal(
    sent.filter((message) => message.type === messages.background.RICH_MDICT_LOOKUP).length,
    3,
    "old queued lookups are discarded and fresh work waits for aborted active responses"
  );

  for (const message of oldLookups) {
    pending.get(message.requestId).resolve({
      ok: true,
      found: true,
      dictionaries: [{ id: message.dictionaryId, title: "Old", text: "stale selection result" }],
      errors: []
    });
  }
  await flushMicrotasks();
  assert.equal(active, 3);
  const freshLookups = sent.filter((message) =>
    message.type === messages.background.RICH_MDICT_LOOKUP && message.text === "fresh selection"
  );
  assert.equal(freshLookups.length, 3);
  assert.equal(maximumActive, 3);
  assert.deepEqual([...old.cards.values()].map((card) => card.results.length), [0, 0, 0, 0, 0]);

  pending.get(freshLookups[0].requestId).resolve({
    ok: true,
    found: true,
    dictionaries: [{ id: freshLookups[0].dictionaryId, title: "Fresh", text: "fresh selection result" }],
    errors: []
  });
  await flushMicrotasks();
  assert.equal(fresh.cards.get(freshLookups[0].dictionaryId).state, "success");
  assert.equal(fresh.cards.get(freshLookups[0].dictionaryId).results.length, 1);
});

test("content runtime exposes the independent viewer-list message", async () => {
  const source = await readFile(RUNTIME, "utf8");
  assert.match(source, /RICH_MDICT_VIEWER_LIST:\s*"RICH_MDICT_VIEWER_LIST"/u);
  assert.match(source, /RICH_MDICT_LOOKUP_CANCEL:\s*"RICH_MDICT_LOOKUP_CANCEL"/u);
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
  const app = { modules: { contentI18n: createContentI18nStub({ messages: {
    "content.rich.order": "词典顺序 {index}",
    "content.rich.preferred": "你的首选 · 个人偏好",
    "content.rich.trust": "来源 / 信任：{trust}",
    "content.selection.dictionaryDetails": "查看完整词典词条"
  } }), selectionRichSanitizer: sanitizer, selectionRichViewer: viewer } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document });
  vm.runInContext(await readFile(RICH_RENDERER, "utf8"), context);
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
