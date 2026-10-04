import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("Reading return never inserts a stored quote before the live Range text is reverified", async () => {
  const source = await readFile(new URL("../src/content/reading-return-card.js", import.meta.url), "utf8");
  const dom = new JSDOM('<!doctype html><main><p id="actual">changed</p></main><div id="layer"></div>', {
    url: "https://example.test/article",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const layer = window.document.getElementById("layer");
  const actual = window.document.querySelector("#actual").firstChild;
  const range = window.document.createRange();
  range.selectNodeContents(actual);
  const exact = "stored-secret";
  const addedText = [];
  const collect = (records) => {
    for (const record of records) {
      for (const node of record.addedNodes || []) {
        if (node.nodeType === window.Node.TEXT_NODE) addedText.push(node.nodeValue || "");
      }
    }
  };
  const observer = new window.MutationObserver(collect);
  observer.observe(layer, { subtree: true, childList: true, characterData: true });

  const locale = {
    t: (key) => key,
    bindText(node, key) { node.textContent = key; },
    bindAttribute(node, name, key) { node.setAttribute(name, key); },
    unbindTree() {}
  };
  const button = ({ text = "", label = "", className = "" } = {}) => {
    const node = window.document.createElement("button");
    node.textContent = text;
    if (label) node.setAttribute("aria-label", label);
    if (className) node.className = className;
    return node;
  };
  const surface = ({ className = "", role = "" } = {}) => {
    const node = window.document.createElement("div");
    node.className = className;
    if (role) node.setAttribute("role", role);
    return node;
  };
  const status = ({ className = "" } = {}) => {
    const node = window.document.createElement("div");
    node.className = className;
    return node;
  };
  const setStatus = (node, text, kind) => {
    node.textContent = text;
    node.dataset.kind = kind;
  };

  window.__TRANSLATE_FLOW_CONTENT__ = { modules: {
    readingHandoff: { ready: Promise.resolve({ state: "consumed", summary: {
      recordId: "record-1", anchor: { quote: { exact, prefix: "", suffix: "" } }
    } }) },
    readingAnchorResolver: { resolve: async () => ({ status: "resolved", range, verifiedText: exact }) },
    readingContract: {
      READING_METHOD: { OPEN_LEARNING_CENTER: "reading.open-learning-center" },
      READING_LIMITS: { scanRetryCount: 3, mutationDebounceMs: 150 },
      validateReadingRequest: (value) => value,
      validateReadingResponse: (_method, value) => value
    },
    runtime: { sendRuntimeMessage: async () => ({ ok: true, data: { opened: true } }) },
    contentI18n: locale,
    uiHost: { getLayer: () => layer, ownsNode: () => false },
    uiPrimitives: { button, surface, status, setStatus }
  } };

  window.eval(source);
  await window.__TRANSLATE_FLOW_CONTENT__.modules.readingReturnCard.ready;
  collect(observer.takeRecords());
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  collect(observer.takeRecords());

  const card = layer.querySelector(".tf-reading-return-card");
  const quote = card.querySelector("blockquote");
  assert.equal(card.dataset.state, "missing");
  assert.equal(quote.hidden, true);
  assert.equal(quote.textContent, "");
  assert.equal(addedText.includes(exact), false, "stored quote must never enter the page DOM before live Range verification");

  observer.disconnect();
  dom.window.close();
});
