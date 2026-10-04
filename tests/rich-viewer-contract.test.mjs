import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const VIEWER = new URL("../src/content/selection/rich-viewer.js", import.meta.url);
const RENDERER = new URL("../src/content/selection/result-renderer.js", import.meta.url);
const RICH_RENDERER = new URL("../src/content/selection/rich-result-renderer.js", import.meta.url);
const SANITIZER_MODULES = [
  "../src/content/selection/rich-sanitizer-style.js",
  "../src/content/selection/rich-sanitizer-tokenizer.js",
  "../src/content/selection/rich-sanitizer.js"
].map((path) => new URL(path, import.meta.url));

test("rich viewer builds a bounded, scoped tree with safe compact styles and media placeholders", async () => {
  const { viewer, document } = await loadModules();
  const host = document.createElement("div");
  const ast = {
    nodes: [
      {
        type: "element", tag: "div", children: [
          {
            type: "element", tag: "b", attrs: { "data-compact-id": 1, onclick: "alert(1)" },
            style: { "font-size": "180%", color: "dodgerblue", position: "fixed" },
            children: [{ type: "text", text: "Heading" }]
          },
          { type: "element", tag: "br", attrs: { "data-compact-id": 2 }, children: [] },
          { type: "element", tag: "span", attrs: { "data-rich-placeholder": "image", src: "https://attacker.invalid/a.png" }, children: [{ type: "text", text: "[图片资源未导入]" }] },
          { type: "element", tag: "script", children: [{ type: "text", text: "window.__executed = true" }] },
          { type: "element", tag: "img", attrs: { src: "https://attacker.invalid/a.png", onerror: "alert(1)" }, children: [] },
          { type: "element", tag: "table", children: [{ type: "element", tag: "tr", children: [{ type: "element", tag: "td", attrs: { colspan: "2", href: "javascript:alert(1)" }, children: [{ type: "text", text: "cell" }] }] }] }
        ]
      }
    ],
    truncated: false
  };

  assert.equal(viewer.render(host, ast, "safe fallback"), true);
  assert.equal(host.shadowRoot.mode, "open");
  const viewport = findClass(host.shadowRoot, "tf-rich-viewer");
  assert.ok(viewport);
  assert.equal(viewport.tabIndex, 0);
  assert.equal(viewport.attributes.get("role"), "region");
  assert.equal(findTag(host.shadowRoot, "script"), null);
  assert.equal(findTag(host.shadowRoot, "img"), null);
  assert.equal(findTag(host.shadowRoot, "table")?.childNodes[0]?.tagName, "TR");
  assert.equal(findTag(host.shadowRoot, "td")?.attributes.has("href"), false);
  const heading = findTag(host.shadowRoot, "b");
  assert.equal(heading.attributes.get("data-compact-id"), "1");
  assert.equal(heading.style.values.get("font-size"), "clamp(8px, 180%, 48px)");
  assert.equal(heading.style.values.get("color"), "var(--tf-rich-blue, dodgerblue)");
  assert.equal(heading.style.values.has("position"), false);
  assert.ok(findClass(host.shadowRoot, "tf-rich-placeholder"));
  assert.doesNotMatch(textContent(host.shadowRoot), /window\.__executed|attacker\.invalid|javascript:/u);
  assert.equal(host.textContent, "safe fallback");
  assert.doesNotMatch(await readFile(VIEWER, "utf8"), /DOMParser|innerHTML|outerHTML/u);
  const staticCss = findTag(host.shadowRoot, "style").textContent;
  assert.doesNotMatch(staticCss, /@import|url\s*\(/iu);
});

test("rich result renderer sends only bounded payload to sanitizer and preserves text fallback", async () => {
  const calls = [];
  const sanitizer = {
    sanitizeRichDictionaryRecord(input) {
      calls.push(input);
      return { nodes: [{ type: "text", text: "alpha\nbeta" }], truncated: false };
    }
  };
  const { renderer, document } = await loadModules({ sanitizer });
  const container = document.createElement("div");
  assert.equal(renderer.appendRichDictionaryDetails(container, {
    dictionaries: [{
      id: "fixture", title: "Fixture", headword: "term", text: "safe fallback",
      richRecord: { rawRecord: "<p>untrusted</p>", format: "Text", styleSheetRules: [] }
    }]
  }), true);

  assert.deepEqual(calls, [{ rawRecord: "<p>untrusted</p>", format: "Text", styleSheetRules: [] }]);
  const body = findClass(container, "tf-selection-rich-text");
  const viewport = findClass(body.shadowRoot, "tf-rich-viewer");
  assert.equal(textContent(viewport), "alpha\nbeta");
  assert.equal(viewport.style.values.get("white-space"), "pre-wrap");
  assert.equal(body.textContent, "safe fallback");

  sanitizer.sanitizeRichDictionaryRecord = () => { throw new Error("parser failure"); };
  const fallbackContainer = document.createElement("div");
  renderer.appendRichDictionaryDetails(fallbackContainer, {
    dictionaries: [{ text: "plain safe result", richRecord: { rawRecord: "<script>attack</script>" } }]
  });
  const fallbackBody = findClass(fallbackContainer, "tf-selection-rich-text");
  assert.equal(textContent(findClass(fallbackBody.shadowRoot, "tf-rich-viewer")), "plain safe result");
  assert.equal(fallbackBody.textContent, "plain safe result");

  const errorContainer = document.createElement("div");
  renderer.appendRichDictionaryDetails(errorContainer, {
    errors: [{ title: "Fixture", message: "SECRET_PROVIDER_RAW", code: "RICH_INTERNAL_CODE" }]
  });
  assert.match(textContent(errorContainer), /content\.rich\.unavailable/u);
  assert.doesNotMatch(textContent(errorContainer), /SECRET_PROVIDER_RAW|RICH_INTERNAL_CODE/u);
});

test("viewer caps AST traversal and uses no network or HTML parser APIs", async () => {
  const source = await readFile(VIEWER, "utf8");
  assert.match(source, /MAX_NODES = 8192/u);
  assert.match(source, /MAX_DEPTH = 32/u);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|DOMParser|innerHTML|outerHTML/u);
  assert.match(source, /attachShadow\(\{ mode: "open" \}\)/u);
});

test("Rich display hook waits for expansion and exposes the visible sanitized text once", async () => {
  const sanitizer = { sanitizeRichDictionaryRecord() {
    return { nodes: [{ type: "text", text: "actual visible summary" }], truncated: false };
  } };
  const { renderer, document } = await loadModules({ sanitizer });
  const container = document.createElement("div"), displayed = [];
  const [card] = renderer.appendRichDictionaryCards(container, [{ id: "fixture", title: "Fixture" }]);
  card.setResult({ id: "fixture", headword: "term", packVersion: "actual-v2", text: "different safe fallback",
    richRecord: { rawRecord: "PRIVATE_RAW", format: "HTML", styleSheetRules: [] }, privatePath: "/home/private" },
    "fixture", (value) => displayed.push(value));
  assert.equal(displayed.length, 0, "a hidden preloaded result is not an observed result");
  const details = findTag(container, "details");
  details.open = true; details.dispatch("toggle"); details.dispatch("toggle");
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0].text, "actual visible summary");
  assert.equal(displayed[0].packVersion, "actual-v2");
  assert.doesNotMatch(JSON.stringify(displayed[0]), /PRIVATE_RAW|\/home|richRecord/u);
});

test("nested dictionary font sizes each receive an independent pixel ceiling", async () => {
  const { viewer, document } = await loadModules();
  let node = { type: "text", text: "deep" };
  for (let depth = 0; depth < 32; depth += 1) {
    node = { type: "element", tag: "span", style: { "font-size": "300%" }, children: [node] };
  }
  const host = document.createElement("div");
  viewer.render(host, { nodes: [node], truncated: false });
  const sizedNodes = walk(host.shadowRoot).filter((item) => item.style?.values.has("font-size"));
  assert.equal(sizedNodes.length, 32);
  assert.ok(sizedNodes.every((item) => item.style.values.get("font-size") === "clamp(8px, 300%, 48px)"));
});

test("per-dictionary Compact rules carry safe formatting into the isolated viewer", async () => {
  const { sanitizer, viewer, document } = await loadSanitizedPipeline();
  const record = sanitizer.sanitizeRichDictionaryRecord({
    rawRecord: "`1`Headword`3`Field`4`Note",
    format: "Html",
    styleSheetRules: [
      { id: 1, begin: '<b style="font-size:180%">', end: "</b>" },
      { id: 3, begin: '<span style="color:dodgerblue">', end: "</span>" },
      { id: 4, begin: '<span style="color:gray">', end: "</span>" }
    ]
  });
  assert.equal(record.truncated, false);
  const byId = (id) => walkNodes(record.nodes).find((node) => node.attrs?.["data-compact-id"] === String(id));
  assert.ok(byId(1));
  assert.ok(byId(3));
  assert.ok(byId(4));
  assert.equal(findNodeStyle(record.nodes, "font-size"), "180%");
  assert.equal(findNodeStyle(record.nodes, "color", "gray"), "gray");
  assert.equal(findNodeStyle(record.nodes, "color", "dodgerblue"), "dodgerblue");

  const host = document.createElement("div");
  viewer.render(host, record, "fallback");
  const compact = (id) => walk(host.shadowRoot).find((node) => node.attributes?.get("data-compact-id") === String(id));
  assert.ok(compact(1));
  assert.ok(compact(3));
  assert.ok(compact(4));
  assert.equal(findTag(host.shadowRoot, "b").style.values.get("font-size"), "clamp(8px, 180%, 48px)");
  assert.equal(findStyleElement(host.shadowRoot, "span", "color").style.values.get("color"), "var(--tf-rich-blue, dodgerblue)");
  assert.ok(textContent(host.shadowRoot).includes("HeadwordFieldNote"));
});

async function loadModules({ sanitizer = { sanitizeRichDictionaryRecord: () => ({ nodes: [], truncated: false }) } } = {}) {
  const document = new FakeDocument();
  const app = { modules: { contentI18n: createContentI18nStub(), selectionRichSanitizer: sanitizer } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document });
  vm.runInContext(await readFile(VIEWER, "utf8"), context);
  vm.runInContext(await readFile(RICH_RENDERER, "utf8"), context);
  vm.runInContext(await readFile(RENDERER, "utf8"), context);
  return { viewer: app.modules.selectionRichViewer, renderer: app.modules.selectionResultRenderer, document };
}

async function loadSanitizedPipeline() {
  const document = new FakeDocument();
  const app = { modules: { contentI18n: createContentI18nStub() } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document });
  for (const path of SANITIZER_MODULES) vm.runInContext(await readFile(path, "utf8"), context);
  vm.runInContext(await readFile(VIEWER, "utf8"), context);
  return { sanitizer: app.modules.selectionRichSanitizer, viewer: app.modules.selectionRichViewer, document };
}

function findClass(root, className) {
  return walk(root).find((node) => node.className?.split(/\s+/u).includes(className)) || null;
}

function findTag(root, tagName) {
  const tag = tagName.toUpperCase();
  return walk(root).find((node) => node.tagName === tag) || null;
}

function findStyleElement(root, tagName, property) {
  const tag = tagName.toUpperCase();
  return walk(root).find((node) => node.tagName === tag && node.style?.values.has(property)) || null;
}

function textContent(node) {
  return node?.nodeType === 3 ? node.data : (node?.childNodes || []).map(textContent).join("");
}

function walk(root) {
  if (!root) return [];
  return [root, ...(root.childNodes || []).flatMap(walk)];
}

function walkNodes(nodes) {
  const found = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    found.push(node, ...walkNodes(node.children));
  }
  return found;
}

function findNodeStyle(nodes, property, expected = "") {
  for (const node of walkNodes(nodes)) {
    if (node.style?.[property] && (!expected || node.style[property] === expected)) return node.style[property];
  }
  return "";
}

class FakeDocument {
  createElement(tagName) { return new FakeNode(tagName, this); }
  createTextNode(value) { return new FakeNode("#text", this, String(value)); }
  createDocumentFragment() { return new FakeNode("#fragment", this); }
}

class FakeNode {
  constructor(tagName, document, data = "") {
    this.tagName = tagName.startsWith("#") ? tagName : tagName.toUpperCase();
    this.nodeType = tagName === "#text" ? 3 : tagName === "#fragment" ? 11 : 1;
    this.ownerDocument = document;
    this.data = data;
    this.childNodes = [];
    this.attributes = new Map();
    this.style = { values: new Map(), setProperty(name, value) { this.values.set(name, value); } };
    this.className = "";
    this.tabIndex = -1;
    this.dataset = {};
    this.listeners = new Map();
  }
  appendChild(node) {
    if (node.nodeType === 11) {
      for (const child of [...node.childNodes]) this.appendChild(child);
      node.childNodes = [];
      return node;
    }
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  replaceChildren(...nodes) {
    this.childNodes = [];
    for (const node of nodes) this.appendChild(node);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  dispatch(name) { this.listeners.get(name)?.(); }
  querySelector(selector) { return selector.startsWith(".") ? findClass(this, selector.slice(1)) : findTag(this, selector); }
  get childElementCount() { return this.childNodes.filter((node) => node.nodeType === 1).length; }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(value) { this.replaceChildren(this.ownerDocument.createTextNode(value)); }
  attachShadow({ mode }) {
    this.shadowRoot = new FakeNode("#shadow-root", this.ownerDocument);
    this.shadowRoot.nodeType = 11;
    this.shadowRoot.mode = mode;
    return this.shadowRoot;
  }
}
