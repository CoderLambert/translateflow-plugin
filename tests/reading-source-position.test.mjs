import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { validateSourceSnapshot } from "../src/shared/reading/source.js";

const files = ["text-projection-policy.js", "text-projection-builder.js", "text-projection.js", "selection/source-snapshot.js"];
const sources = await Promise.all(files.map((file) => readFile(new URL(`../src/content/${file}`, import.meta.url), "utf8")));
const json = (value) => JSON.parse(JSON.stringify(value));
function fixture({ styleMs = .25, substringMs = 0 } = {}) {
  let elapsed = 0, wholeReads = 0, boundedReads = 0;
  const document = { createRange: () => ({ setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; } }) }, window = {};
  window.top = window;
  const text = (value, giant = false) => ({ nodeType: 3, isConnected: true, length: value.length, getRootNode: () => document,
    get nodeValue() { if (giant) { wholeReads++; throw new Error("unbounded giant read"); } return value; },
    substringData(from, count) { boundedReads++; elapsed += substringMs; assert.ok(count <= 1207); return value.slice(from, from + count); } });
  function element(tagName, children = []) {
    const node = { nodeType: 1, tagName, isConnected: true, getRootNode: () => document, hasAttribute: () => false, getAttribute: () => null,
      classList: { contains: () => false }, firstChild: children[0] || null,
      closest() { let p = this; while (p && p.tagName !== "P") p = p.parentElement; return p || this; } };
    children.forEach((child, index) => { child.parentElement = node; child.nextSibling = children[index + 1] || null; });
    return node;
  }
  const context = vm.createContext({ document, window, crypto: webcrypto, TextEncoder, performance: { now: () => elapsed },
    chrome: { dom: { openOrClosedShadowRoot: (node) => { elapsed += node.proofMs || 0; return node.privateRoot ? {} : null; } } }, getComputedStyle() { elapsed += styleMs; return { display: "block", visibility: "visible", opacity: "1", whiteSpace: "normal" }; },
    __TRANSLATE_FLOW_CONTENT__: { modules: { runtime: { constants: { EXTENSION_UI_ATTR: "data-tf-extension-ui", TRANSLATION_CLASS: "abt-translation" }, cleanText: (s) => s.trim() } } } });
  for (const source of sources) vm.runInContext(source, context);
  const modules = context.__TRANSLATE_FLOW_CONTENT__.modules, phases = [], budgets = [];
  const makeBudget = modules.textProjectionPolicy.createSliceBudget;
  modules.textProjectionPolicy.createSliceBudget = (...args) => { const budget = makeBudget(...args); budgets.push(budget); return budget; };
  const rangePolicy = modules.textProjectionPolicy.rangePolicy;
  modules.textProjectionPolicy.rangePolicy = (...args) => { const start = elapsed, value = rangePolicy(...args); phases.push({ phase: "range", ms: elapsed - start }); return value; };
  const project = modules.textProjection.project;
  modules.textProjection.project = (root, ...args) => { const start = elapsed, value = project(root, ...args); phases.push({ phase: root === document.body ? "full" : "local", ms: elapsed - start, status: value.status, reason: value.reason, nodes: value.stats.nodes, chars: value.stats.chars }); return value; };
  const range = (node, start = 7) => ({ startContainer: node, endContainer: node, commonAncestorContainer: node, startOffset: start, endOffset: start + 7 });
  return { document, modules, text, element, range, phases, budgets, elapsed: () => elapsed, reads: () => ({ wholeReads, boundedReads }) };
}

test("production capture prioritizes local evidence and shares the first deadline across all phases", async () => {
  const f = fixture(), node = f.text("PUBLIC session tail"), p = f.element("P", [node]);
  f.document.body = f.element("BODY", [f.element("MAIN", [...Array.from({ length: 100 }, () => f.element("P", [f.text("safe")])), p])]);
  const capture = f.modules.selectionSourceSnapshot.capture({ text: "session", range: f.range(node), selectionGeneration: 1 });
  assert.equal(f.elapsed(), 8); assert.ok(f.elapsed() <= f.modules.textProjectionPolicy.limits.sliceMs);
  assert.deepEqual(f.phases.map(({ phase, ms }) => ({ phase, ms })), [{ phase: "range", ms: 2.25 }, { phase: "local", ms: .75 }, { phase: "full", ms: 5 }]);
  assert.equal(f.phases[2].reason, "time-budget");
  assert.equal(capture.context.text, "PUBLIC session tail"); assert.equal(capture.context.sensitive, false); assert.equal(capture.root, "document");
  const frozen = await capture.ready;
  assert.equal(frozen.selectedText, "session"); assert.equal(frozen.anchor.status, "unsupported"); assert.equal(frozen.anchor.position, null);
  assert.deepEqual(validateSourceSnapshot(json(frozen)), json(frozen));
});

test("canonicalization range proof and local projection consume the same synchronous slice", () => {
  const f = fixture(), node = f.text("PUBLIC session tail"), selected = f.element("SPAN", [node]);
  const p = f.element("P", [...Array.from({ length: 100 }, () => f.element("SPAN", [f.text("safe")])), selected]);
  f.document.body = f.element("BODY", [f.element("MAIN", [p])]);
  const range = f.range(node), value = f.modules.selectionSourceSnapshot.canonicalize(range, "session");
  assert.equal(f.elapsed(), 8); assert.ok(f.elapsed() <= f.modules.textProjectionPolicy.limits.sliceMs);
  assert.equal(value.range, range); assert.equal(value.text, "session");
  assert.deepEqual(f.phases.map(({ phase, ms }) => ({ phase, ms })), [{ phase: "range", ms: 3 }, { phase: "local", ms: 5 }]);
  assert.equal(f.phases[1].reason, "time-budget");
});

test("bounded giant-node fallback cannot reset the capture deadline after privacy proof", async () => {
  for (const substringMs of [0, 5]) {
    const f = fixture({ substringMs }), value = `${"x".repeat(2_000_000)} session END_CONTEXT`, node = f.text(value, true);
    f.document.body = f.element("BODY", [f.element("MAIN", [f.element("P", [node])])]);
    const capture = f.modules.selectionSourceSnapshot.capture({ text: "session", range: f.range(node, 2_000_001), selectionGeneration: 1 });
    assert.ok(f.elapsed() <= f.modules.textProjectionPolicy.limits.sliceMs); assert.equal(f.elapsed(), substringMs ? 8 : 3);
    assert.deepEqual(f.reads(), { wholeReads: 0, boundedReads: 1 });
    assert.equal(capture.context.sensitive, false); assert.equal(capture.root, "document");
    const frozen = await capture.ready;
    assert.equal(frozen.selectedText, "session"); assert.equal(frozen.anchor.status, "unsupported");
    if (substringMs) assert.equal(frozen.contextText, "");
    else assert.ok(frozen.contextText.includes("session END_CONTEXT"));
    assert.deepEqual(validateSourceSnapshot(json(frozen)), json(frozen));
  }
});

test("shared node/character stops are cumulative while each projection reports only its own work", async () => {
  const f = fixture({ styleMs: 0 }), node = f.text("PUBLIC session tail");
  const p = f.element("P", [...Array.from({ length: 300 }, () => f.element("SPAN", [f.text("safe")])), f.element("SPAN", [node])]);
  f.document.body = f.element("BODY", [f.element("MAIN", [p])]);
  const capture = f.modules.selectionSourceSnapshot.capture({ text: "session", range: f.range(node), selectionGeneration: 1 });
  assert.equal(f.budgets.length, 1); assert.equal(f.budgets[0].nodes, 500); assert.equal(f.phases[1].nodes, 488);
  assert.equal(f.phases[1].reason, "node-budget"); assert.equal(capture.context.sensitive, false); assert.equal((await capture.ready).contextText, "");
  const standalone = f.modules.textProjection.project(p);
  assert.equal(standalone.reason, "node-budget"); assert.equal(standalone.stats.nodes, 500);

  const chars = fixture({ styleMs: 0 }), content = `PUBLIC session ${"x".repeat(9990)}`, text = chars.text(content);
  chars.document.body = chars.element("BODY", [chars.element("MAIN", [chars.element("P", [text])])]);
  const limited = chars.modules.selectionSourceSnapshot.capture({ text: "session", range: chars.range(text), selectionGeneration: 1 });
  assert.equal(chars.phases[1].chars, content.length); assert.equal(chars.phases[2].chars, 0); assert.equal(chars.phases[2].reason, "char-budget");
  assert.ok(chars.budgets[0].chars <= chars.modules.textProjectionPolicy.limits.sliceChars);
  assert.equal(limited.context.sensitive, false); assert.equal((await limited.ready).anchor.status, "unsupported");
});

test("a remaining-budget resolved capture maps the second repeated word, not its first occurrence", async () => {
  const f = fixture({ styleMs: 0 }), node = f.text("session alpha session tail");
  f.document.body = f.element("BODY", [f.element("MAIN", [f.element("P", [node])])]);
  const capture = f.modules.selectionSourceSnapshot.capture({ text: "session", range: f.range(node, 14), selectionGeneration: 1 });
  const frozen = await capture.ready;
  assert.equal(frozen.anchor.status, "resolved"); assert.deepEqual(json(frozen.anchor.position), { start: 14, end: 21 });
  assert.equal(frozen.anchor.quote.exact, frozen.selectedText); assert.deepEqual(validateSourceSnapshot(json(frozen)), json(frozen));
});


test("an over-budget closed-root proof preserves its sensitive rejection before time fallback", async () => {
  const f = fixture({ styleMs: 0 }), selected = f.text("PUBLIC session tail"), privateLight = f.text("SECRET", true);
  const host = f.element("DIV", [privateLight]); host.privateRoot = true; host.proofMs = 8;
  f.document.body = f.element("BODY", [f.element("MAIN", [f.element("P", [selected, host])])]);
  const capture = f.modules.selectionSourceSnapshot.capture({ text: "session", range: f.range(selected), selectionGeneration: 1 });
  assert.equal(f.elapsed(), 8); assert.equal(capture.context.sensitive, true); assert.equal(capture.root, "unsupported");
  assert.equal(capture.context.text, ""); assert.deepEqual(f.reads(), { wholeReads: 0, boundedReads: 0 });
  const frozen = await capture.ready;
  assert.equal(frozen.selectedText, "session"); assert.equal(frozen.anchor.status, "unsupported");
  assert.deepEqual(validateSourceSnapshot(json(frozen)), json(frozen));
});
