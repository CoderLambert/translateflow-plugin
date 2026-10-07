import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { projectSourceSegments, validateSourceSnapshot } from "../src/shared/reading/source.js";
import { createSourceDigest } from "../src/shared/reading/identity.js";
import { READING_LIMITS, READING_PROJECTION_VERSION } from "../src/shared/reading/constants.js";

const files = ["text-projection-policy.js", "text-projection-builder.js", "text-projection.js", "selection/source-snapshot.js"];
const sources = new Map(await Promise.all(files.map(async (file) => [file, await readFile(new URL(`../src/content/${file}`, import.meta.url), "utf8")])));
const runtimeSource = await readFile(new URL("../src/content/runtime.js", import.meta.url), "utf8");
function load(extra = {}) {
  const document = {}, window = {}; window.top = window;
  const context = vm.createContext({ document, window, crypto: webcrypto, TextEncoder, performance: { now: () => 0 },
    chrome: { dom: { openOrClosedShadowRoot: (node) => node.shadowRoot ?? null } },
    __TRANSLATE_FLOW_CONTENT__: { modules: { runtime: { constants: { EXTENSION_UI_ATTR: "data-tf-extension-ui", TRANSLATION_CLASS: "abt-translation" }, cleanText: (value) => value.trim() } } }, ...extra });
  for (const file of files.slice(0, 3)) vm.runInContext(sources.get(file), context);
  return { context, document, modules: context.__TRANSLATE_FLOW_CONTENT__.modules };
}
const json = (value) => JSON.parse(JSON.stringify(value));

test("classic projection builder matches the frozen inline, whitespace, NBSP and UTF16 reference", () => {
  const { modules } = load();
  const segments = [
    { text: "  per", blockStart: true, excluded: false, nodeKey: "a" },
    { text: "sistent \t", blockStart: false, excluded: false, nodeKey: "b" },
    { text: "\r\n link\u00a0中文 😀 e\u0301  ", blockStart: false, excluded: false, nodeKey: "c" },
    { text: "SECRET", blockStart: true, excluded: true, nodeKey: "excluded" },
    { text: " next\fblock ", blockStart: true, excluded: false, nodeKey: "d" }
  ];
  const builder = modules.textProjectionBuilder.createBuilder();
  for (const segment of segments) {
    if (segment.excluded) continue;
    if (segment.blockStart) builder.boundary();
    builder.append(segment.nodeKey, segment.text);
  }
  const actual = builder.finish(), reference = projectSourceSegments(segments);
  assert.equal(actual.text, "persistent link\u00a0中文 😀 e\u0301\nnext block");
  assert.equal(actual.text, reference.text);
  assert.deepEqual(json(actual.mapping), reference.mapping);
  assert.equal(actual.mapping[10].start.nodeKey, "b");
  assert.equal(actual.mapping[10].end.nodeKey, "c");
  assert.equal(actual.mapping[actual.text.indexOf("\n")], null);
  assert.equal(modules.textProjectionPolicy.projectionVersion, READING_PROJECTION_VERSION);
  for (const [key, sharedKey] of [["sliceChars", "scanSliceChars"], ["sliceNodes", "scanSliceNodes"], ["sliceMs", "scanSliceMs"], ["totalChars", "scanTotalChars"], ["totalNodes", "scanTotalNodes"], ["totalMs", "scanTotalMs"]]) {
    assert.equal(modules.textProjectionPolicy.limits[key], READING_LIMITS[sharedKey]);
  }
});

function element(document, children = [], style = {}) {
  const node = { nodeType: 1, tagName: "SPAN", getRootNode: () => document, hasAttribute: () => false, getAttribute: () => null,
    classList: { contains: () => false }, style: { display: "inline", visibility: "visible", opacity: "1", whiteSpace: "normal", ...style } };
  node.firstChild = children[0] || null;
  children.forEach((child, index) => { child.parentElement = node; child.nextSibling = children[index + 1] || null; });
  return node;
}

test("lowercase SVG/XHTML sensitive tags are excluded before their text is read", () => {
  const state = load({ getComputedStyle: (node) => node.style });
  for (const tag of ["script", "style", "noscript", "template", "input", "textarea", "select", "option"]) {
    const secret = { nodeType: 3, length: 6, get nodeValue() { throw new Error("private namespace text read"); } };
    const hidden = Object.assign(element(state.document, [secret]), { tagName: tag, localName: tag });
    const result = state.modules.textProjection.project(element(state.document, [hidden]));
    assert.equal(result.status, "resolved", tag); assert.equal(result.text, "", tag);
    assert.equal(state.modules.textProjectionPolicy.inspect(hidden).sensitive, true, tag);
  }
});

test("route observer and legacy polling use the existing production page identity", () => {
  for (const modern of [true, false]) {
    const location = { href: "https://example.test/article?topic=one" }, callbacks = new Map();
    const runtimeContext = vm.createContext({ location, URL });
    vm.runInContext(runtimeSource, runtimeContext);
    const window = { addEventListener(name, fn) { callbacks.set(name, fn); } }; window.top = window;
    const state = load({ location, window, navigation: modern ? { addEventListener(name, fn) { callbacks.set(name, fn); } } : undefined,
      MutationObserver: class { observe() {} takeRecords() { return []; } },
      setInterval(fn) { callbacks.set("poll", fn); return 1; }, clearInterval() {},
      __TRANSLATE_FLOW_CONTENT__: { modules: { runtime: runtimeContext.__TRANSLATE_FLOW_CONTENT__.modules.runtime } } });
    const projection = state.modules.textProjection; projection.start(); projection.watchPage(location.href);
    const revision = projection.revision();
    for (const href of ["https://example.test/article?topic=one#introduction", "https://example.test/article?utm_source=test&topic=one&gclid=123#details"]) {
      location.href = href;
      (callbacks.get(modern ? "navigate" : "poll"))({ destination: { url: href } });
      callbacks.get("hashchange")();
      assert.equal(projection.revision(), revision, `${modern}:${href}`);
    }
    const destination = "https://example.test/article?topic=one#/another-route";
    if (!modern) location.href = destination;
    callbacks.get(modern ? "navigate" : "poll")({ destination: { url: destination } });
    assert.ok(projection.revision() > revision, `actual route ${modern}`);
  }
});

test("DOM adapter stops before reading an oversized text node or walking beyond its node slice", () => {
  const state = load({ getComputedStyle: (node) => node.style });
  const giant = { nodeType: 3, length: 2_000_000, get nodeValue() { throw new Error("unbounded read"); } };
  const huge = state.modules.textProjection.project(element(state.document, [giant]));
  assert.equal(huge.status, "unsupported"); assert.equal(huge.reason, "char-budget"); assert.equal(huge.stats.chars, 0);
  const many = state.modules.textProjection.project(element(state.document, Array.from({ length: 600 }, () => element(state.document))));
  assert.equal(many.reason, "node-budget"); assert.equal(many.stats.nodes, 500);
  let ticks = 0;
  const timed = state.modules.textProjection.project(element(state.document, [element(state.document)]), { clock: () => ticks++ * 5 });
  assert.equal(timed.reason, "time-budget");
});

test("hidden ancestors prune children even when descendants override visibility", () => {
  const state = load({ getComputedStyle: (node) => node.style });
  const text = { nodeType: 3, length: 6, nodeValue: "SECRET" };
  const visible = element(state.document, [text]);
  const hidden = element(state.document, [visible], { visibility: "hidden" });
  const root = element(state.document, [hidden]);
  assert.equal(state.modules.textProjection.project(root).text, "");
  assert.equal(state.modules.textProjection.project(visible).reason, "excluded-ancestor");
});

test("context traversal rejects neighboring custom hosts, open shadow roots and assigned slots", () => {
  const state = load({ getComputedStyle: (node) => node.style });
  for (const unknown of [{ tagName: "X-PRIVATE" }, { shadowRoot: {} }, { assignedSlot: {} }, { tagName: "SLOT" }]) {
    const secret = { nodeType: 3, length: 14, get nodeValue() { throw new Error("unknown composed context must not be read"); } };
    const host = Object.assign(element(state.document, [secret]), unknown);
    const root = element(state.document, [{ nodeType: 3, length: 14, nodeValue: "PUBLIC session" }, host]);
    const result = state.modules.textProjection.project(root);
    assert.equal(result.status, "unsupported"); assert.equal(result.reason, "unsupported-host"); assert.equal(result.sensitive, true);
  }
});

test("hidden exclusion does not hide a higher sensitive ancestor from range policy", () => {
  const state = load({ getComputedStyle: (node) => node.style });
  const node = { nodeType: 3, isConnected: true, getRootNode: () => state.document };
  const hidden = element(state.document, [node], { display: "none" });
  const sensitive = element(state.document, [hidden]);
  sensitive.hasAttribute = (name) => name === "data-tf-sensitive";
  const decision = state.modules.textProjectionPolicy.rangePolicy({ startContainer: node, endContainer: node, commonAncestorContainer: node }, "session");
  assert.equal(decision.supported, false); assert.equal(decision.sensitive, true);
});

test("native closed hosts require the extension DOM proof and never expose private light text", () => {
  let host;
  const state = load({ getComputedStyle: (node) => node.style,
    chrome: { dom: { openOrClosedShadowRoot: (node) => node === host ? {} : null } } });
  const secret = { nodeType: 3, length: 14, get nodeValue() { throw new Error("closed host text must not be read"); } };
  host = element(state.document, [secret]);
  assert.equal(host.shadowRoot, undefined);
  const result = state.modules.textProjection.project(element(state.document, [host]));
  assert.equal(result.status, "unsupported"); assert.equal(result.reason, "unsupported-host"); assert.equal(result.sensitive, true);
});

test("missing, failed or indeterminate closed-root proof is unknown rather than safe", () => {
  for (const chrome of [undefined, { dom: {} }, { dom: { openOrClosedShadowRoot() { throw new Error("unavailable"); } } },
    { dom: { openOrClosedShadowRoot() {} } }]) {
    const state = load({ chrome, getComputedStyle: (node) => node.style });
    const decision = state.modules.textProjectionPolicy.inspect(element(state.document));
    assert.equal(decision.unsupported, true); assert.equal(decision.sensitive, true); assert.equal(decision.reason, "shadow-proof-unavailable");
  }
});

test("Range interior privacy checks cover editable/sensitive/unknown nodes and fail closed on either budget", () => {
  for (const mode of ["editable", "sensitive", "host", "nodes", "time"]) {
    let ticks = 0;
    const state = load({ getComputedStyle: (node) => node.style, performance: { now: () => mode === "time" ? ticks++ * 5 : 0 } });
    const endpoint = () => ({ nodeType: 3, isConnected: true, getRootNode: () => state.document });
    const start = endpoint(), end = endpoint(), middle = element(state.document);
    if (mode === "editable") middle.isContentEditable = true;
    if (mode === "sensitive") middle.hasAttribute = (name) => name === "data-tf-sensitive";
    if (mode === "host") middle.tagName = "X-PRIVATE";
    const root = element(state.document, [start, ...(mode === "nodes" ? Array.from({ length: 600 }, () => element(state.document)) : [middle]), end]);
    const range = { startContainer: start, endContainer: end, commonAncestorContainer: root, intersectsNode: () => true };
    const decision = state.modules.textProjectionPolicy.rangePolicy(range, "PUBLIC SECRET tail");
    assert.equal(decision.supported, false, mode); assert.equal(decision.sensitive, true, mode);
    if (["nodes", "time"].includes(mode)) assert.equal(decision.reason, "range-budget");
  }
});

test("all Range ancestors and interior share the first time and node stop budget", () => {
  let elapsed = 0, styles = 0;
  const state = load({ performance: { now: () => elapsed }, getComputedStyle: (node) => { elapsed += 4; styles++; return node.style; } });
  const node = { nodeType: 3, isConnected: true, getRootNode: () => state.document };
  const p = element(state.document, [node]); element(state.document, [p]);
  const timed = state.modules.textProjectionPolicy.rangePolicy({ startContainer: node, endContainer: node, commonAncestorContainer: node });
  assert.equal(timed.supported, false); assert.equal(timed.sensitive, true); assert.equal(timed.reason, "range-budget");
  assert.equal(elapsed, 8); assert.equal(styles, 2);

  let inspections = 0;
  const deep = load({ getComputedStyle: (value) => { inspections++; return value.style; } });
  const endpoint = () => ({ nodeType: 3, isConnected: true, getRootNode: () => deep.document });
  const start = endpoint(), end = endpoint(); let root = element(deep.document, [start, end]);
  for (let count = 0; count < 180; count++) root = element(deep.document, [root]);
  const counted = deep.modules.textProjectionPolicy.rangePolicy({ startContainer: start, endContainer: end, commonAncestorContainer: start.parentElement });
  assert.equal(counted.supported, false); assert.equal(counted.sensitive, true); assert.equal(counted.reason, "range-budget");
  assert.equal(inspections, 500);
});

test("giant text fallback reads only a bounded CharacterData window and enforces its time budget", async () => {
  for (const timeout of [false, true]) {
    let ticks = 0, wholeReads = 0, boundedReads = 0;
    const state = load({ performance: { now: () => timeout ? ticks++ * 5 : 0 }, getComputedStyle: (node) => node.style });
    const value = `${"x".repeat(2_000_000)} session END_CONTEXT`, start = 2_000_001;
    const node = { nodeType: 3, length: value.length, get nodeValue() { wholeReads++; return value; },
      substringData(from, length) { boundedReads++; assert.ok(length <= 1207); return value.slice(from, from + length); } };
    const root = element(state.document, [], { display: "block" }); node.parentElement = root;
    const range = { commonAncestorContainer: node, startContainer: node, endContainer: node, startOffset: start, endOffset: start + 7 };
    state.modules.textProjectionPolicy.rangePolicy = () => ({ supported: true, sensitive: false });
    state.modules.textProjection.project = () => ({ status: "unsupported", reason: "char-budget" });
    vm.runInContext(sources.get(files[3]), state.context);
    const capture = state.modules.selectionSourceSnapshot.capture({ text: "session", range, selectionGeneration: 1 });
    const frozen = await capture.ready;
    assert.equal(wholeReads, 0); assert.equal(boundedReads, 1); assert.equal(frozen.selectedText, "session");
    assert.equal(frozen.anchor.status, "unsupported");
    if (timeout) assert.equal(frozen.contextText, "");
    else { assert.ok(frozen.contextText.includes("session END_CONTEXT")); assert.ok(frozen.contextText.length <= 900); }
    assert.deepEqual(validateSourceSnapshot(json(frozen)), json(frozen));
  }
});

test("query evidence is synchronously frozen and hashes never re-read DOM after awaiting", async () => {
  const state = load({ getComputedStyle: (node) => node.style });
  const block = element(state.document, [], { display: "block" }), range = { commonAncestorContainer: block };
  const localText = "ALPHA session tail", selectedText = "session";
  state.modules.textProjectionPolicy.rangePolicy = () => ({ supported: true, sensitive: false });
  state.modules.textProjection.project = (root) => ({ status: "resolved", text: root === state.document.body ? `prefix\n${localText}` : localText });
  state.modules.textProjection.positionForRange = (value) => ({ start: value.text.length - localText.length + 6, end: value.text.length - localText.length + 13 });
  vm.runInContext(sources.get(files[3]), state.context);
  const capture = state.modules.selectionSourceSnapshot.capture({ text: selectedText, range, selectionGeneration: 3 });
  state.modules.textProjection.project = () => { throw new Error("DOM must not be re-read"); };
  const frozen = await capture.ready;
  assert.equal(frozen.contextText, localText); assert.equal(frozen.anchor.quote.prefix, "ALPHA ");
  assert.equal(frozen.selectedText, selectedText); assert.equal(frozen.selectionGeneration, 3);
  assert.deepEqual(json(frozen.anchor.position), { start: 13, end: 20 });
  assert.deepEqual(validateSourceSnapshot(json(frozen)), json(frozen));
  assert.equal(frozen.sourceDigest, await createSourceDigest(frozen));
  assert.equal(Object.isFrozen(frozen.anchor.quote), true); assert.equal(Object.isFrozen(capture.context), true);
});

test("selection context uses the nearest safe block for div and span based text", async () => {
  const state = load({ getComputedStyle: (node) => node.style });
  const selected = { nodeType: 3, length: 10, nodeValue: "persistent", isConnected: true, getRootNode: () => state.document };
  const inline = element(state.document, [selected], { display: "inline" });
  const block = element(state.document, [inline], { display: "block" });
  const sentence = "A persistent connection remains available across reconnects.";
  let rangeText = "persistent";
  const range = { commonAncestorContainer: selected, startContainer: selected, endContainer: selected,
    startOffset: 0, endOffset: 10, toString: () => rangeText };
  state.document.body = block;
  state.modules.textProjection.project = () => ({ status: "resolved", text: sentence });
  state.modules.textProjection.positionForRange = () => ({ start: 2, end: 12 });
  vm.runInContext(sources.get(files[3]), state.context);

  const snapshot = { text: "persistent", range, selectionGeneration: 1 };
  const capture = state.modules.selectionSourceSnapshot.capture(snapshot);
  assert.equal(state.modules.selectionSourceSnapshot.contextRoot(range), block);
  assert.equal(capture.context.text, sentence);
  assert.equal(capture.context.text.includes("connection remains available"), true);
  assert.equal(state.modules.selectionSourceSnapshot.matches(snapshot, capture), true);
  rangeText = "changed text";
  assert.equal(state.modules.selectionSourceSnapshot.matches(snapshot, capture), false);
  rangeText = "persistent";
  selected.isConnected = false;
  assert.equal(state.modules.selectionSourceSnapshot.matches(snapshot, capture), false);
  selected.isConnected = true;
  state.modules.textProjection.project = () => ({ status: "resolved", text: "A persistent cache entry changed nearby." });
  assert.equal(state.modules.selectionSourceSnapshot.matches(snapshot, capture), false);
  assert.equal((await capture.ready).contextText, sentence);
});

test("sensitive and unsupported roots retain the ordinary selected text with no surrounding capture", async () => {
  const state = load();
  state.modules.textProjectionPolicy.rangePolicy = () => ({ supported: false, sensitive: true, reason: "unsupported-root" });
  state.modules.textProjection.project = () => { throw new Error("sensitive context must not be traversed"); };
  vm.runInContext(sources.get(files[3]), state.context);
  const capture = state.modules.selectionSourceSnapshot.capture({ text: "session", range: {}, selectionGeneration: 1 });
  const frozen = await capture.ready;
  assert.equal(capture.context.sensitive, true); assert.equal(frozen.contextText, "");
  assert.equal(frozen.contextMode, "selection-only"); assert.equal(frozen.anchor.status, "unsupported");
  assert.equal(frozen.anchor.position, null); assert.equal(frozen.anchor.blockDigest, null);
  assert.deepEqual(validateSourceSnapshot(json(frozen)), json(frozen));
});

test("selection-only matching rejects changed text and detached Range endpoints", () => {
  const state = load();
  state.modules.textProjectionPolicy.rangePolicy = () => ({ supported: false, sensitive: true, reason: "unsupported-root" });
  vm.runInContext(sources.get(files[3]), state.context);
  const endpoint = { isConnected: true };
  let liveText = "session";
  const snapshot = { text: "session", range: { startContainer: endpoint, endContainer: endpoint, toString: () => liveText } };
  const capture = state.modules.selectionSourceSnapshot.capture(snapshot);
  assert.equal(capture.context.text, "");
  assert.equal(capture.context.sensitive, true);
  assert.equal(state.modules.selectionSourceSnapshot.matches(snapshot, capture), true);
  liveText = "changed";
  assert.equal(state.modules.selectionSourceSnapshot.matches(snapshot, capture), false);
  liveText = "session";
  endpoint.isConnected = false;
  assert.equal(state.modules.selectionSourceSnapshot.matches(snapshot, capture), false);
});

test("missing digest capability rejects evidence without breaking ordinary selected-text context", async () => {
  const state = load({ crypto: { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) } });
  state.modules.textProjectionPolicy.rangePolicy = () => ({ supported: false, sensitive: true });
  vm.runInContext(sources.get(files[3]), state.context);
  const capture = state.modules.selectionSourceSnapshot.capture({ text: "session", range: {}, selectionGeneration: 1 });
  await assert.rejects(capture.ready);
  assert.equal(capture.capability, "unsupported"); assert.equal(capture.reason, "digest-unavailable");
  assert.equal(capture.sourceSnapshot, null); assert.equal(capture.selectedText, "session"); assert.equal(capture.context.text, "");
});

test("unit allocation stops at its exact bound and forbidden capture text never forms an invalid DTO", async () => {
  const state = load();
  const builder = state.modules.textProjectionBuilder.createBuilder({ maxUnits: 2 });
  assert.throws(() => builder.append("node", "abc"), /char-budget/u);
  assert.equal(builder.size, 2);
  state.modules.textProjectionPolicy.rangePolicy = () => ({ supported: false, sensitive: true });
  vm.runInContext(sources.get(files[3]), state.context);
  const capture = state.modules.selectionSourceSnapshot.capture({ text: "session\u0000", range: {}, selectionGeneration: 1 });
  await assert.rejects(capture.ready, /unsupported selected text/u);
  assert.equal(capture.reason, "unsupported-text"); assert.equal(capture.sourceSnapshot, null);
});
