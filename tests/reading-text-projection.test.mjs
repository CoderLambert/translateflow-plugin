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
function load(extra = {}) {
  const document = {}, window = {}; window.top = window;
  const context = vm.createContext({ document, window, crypto: webcrypto, TextEncoder, performance: { now: () => 0 },
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

test("query evidence is synchronously frozen and hashes never re-read DOM after awaiting", async () => {
  const state = load();
  const block = {}, range = { commonAncestorContainer: { nodeType: 1, closest: () => block } };
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
