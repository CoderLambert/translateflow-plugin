import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const modules = ["rich-controls", "rich-sanitizer-tags", "rich-resource-path", "rich-sanitizer-style", "rich-sanitizer-tokenizer", "rich-sanitizer", "rich-viewer", "rich-result-renderer"];
function pipeline() {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  const context = dom.getInternalVMContext();
  dom.window.__TRANSLATE_FLOW_CONTENT__ = { modules: { contentI18n: createContentI18nStub() } };
  dom.window.TextEncoder = TextEncoder;
  for (const name of modules) vm.runInContext(readFileSync(new URL(`../src/content/selection/${name}.js`, import.meta.url), "utf8"), context);
  const api = dom.window.__TRANSLATE_FLOW_CONTENT__.modules;
  return { dom, api, sanitize: (html) => api.selectionRichSanitizer.sanitizeRichDictionaryRecord({ rawRecord: html, format: "HTML" }) };
}
const fixture = (checked = "checked") => `<div><input type="radio" id="choice-0" name="choices" ${checked} class="choice"><input type="radio" id="choice-1" name="choices" class="choice"><div class="tabs"><label for="choice-0">First</label><label for="choice-1">Second</label></div><div class="panels"><p class="panel-0">FIRST PANEL</p><p class="panel-1">SECOND PANEL</p></div></div>`;
const flat = (nodes) => nodes.flatMap((node) => [node, ...flat(node.children || [])]);
function render(p, ast) {
  const host = p.dom.window.document.createElement("div"); p.dom.window.document.body.append(host);
  assert.equal(p.api.selectionRichViewer.render(host, ast), true);
  return host.shadowRoot;
}

test("radio AST keeps only closed attributes, source selection and coherent non-parent labels", () => {
  const p = pipeline();
  const ast = p.sanitize(fixture().replace('class="choice"', 'class="choice" onclick="attack()" value="private" form="outside"'));
  const controls = flat(ast.nodes).filter((node) => node.tag === "input");
  assert.equal(controls.length, 2);
  assert.deepEqual(Object.keys(controls[0].attrs).sort(), ["class", "data-rich-radio-checked", "data-rich-radio-name", "data-rich-target-id"]);
  assert.equal(controls[0].attrs["data-rich-radio-checked"], "1");
  const root = render(p, ast);
  const input = root.querySelector("input");
  assert.equal(input.type, "radio"); assert.equal(input.name, "choices"); assert.equal(input.checked, true);
  assert.equal(root.querySelector("label").htmlFor, input.id);
  assert.equal(input.hasAttribute("onclick"), false); assert.equal(input.hasAttribute("form"), false);
});

for (const [name, html] of [
  ["duplicate id", fixture() + '<div id="choice-0">duplicate</div>'],
  ["duplicate attributes", '<input type="radio" id="choice-0" id="other" name="choices" checked><label for="choice-0">static</label>'],
  ["missing label", fixture().replace('<label for="choice-1">Second</label>', '')],
  ["orphan label", '<label for="missing">static</label><input type="radio" id="choice-0" name="choices">'],
  ["unsafe input type", '<input type="text" id="choice-0" name="choices"><label for="choice-0">static</label>'],
  ["missing group", '<input type="radio" id="choice-0"><label for="choice-0">static</label>'],
  ["malformed group", '<input type="radio" id="choice-0" name="a b"><label for="choice-0">static</label>'],
  ["multiple checked", fixture().replace('class="choice"><div', 'class="choice" checked><div')],
  ["active form subtree", '<form>' + fixture() + '</form><p>safe tail</p>']
]) test(`unsafe radio structure degrades without active controls: ${name}`, () => {
  const p = pipeline(), ast = p.sanitize(html);
  assert.equal(flat(ast.nodes).filter((node) => node.tag === "input").length, 0);
  assert.equal(render(p, ast).querySelectorAll("input, label, form").length, 0);
  if (name !== "active form subtree") assert.ok(ast.diagnostics.includes("controls.unavailable"));
});

test("zero-checked native groups preserve no source choice without silently choosing one", () => {
  const p = pipeline(), root = render(p, p.sanitize(fixture("")));
  assert.equal(root.querySelectorAll("input:checked").length, 0);
  assert.equal(root.querySelector('label[tabindex="0"]').textContent, "First");
});

test("viewer rejects forged radio DTO and duplicate target ids independently of sanitizer", () => {
  const p = pipeline();
  for (const tamper of [
    (ast) => { flat(ast.nodes).find((node) => node.tag === "input").attrs["data-rich-radio-checked"] = "true"; },
    (ast) => { ast.nodes.push({ type: "element", tag: "div", attrs: { "data-rich-target-id": "choice-0" }, children: [] }); },
    (ast) => { flat(ast.nodes).find((node) => node.tag === "label").attrs["data-rich-label-for"] = "external"; }
  ]) {
    const ast = p.sanitize(fixture()); tamper(ast);
    assert.equal(render(p, ast).querySelectorAll("input, label").length, 0);
  }
});

test("label click and bounded keyboard selection keep native state, focus and aria in one Shadow", () => {
  const p = pipeline(), first = render(p, p.sanitize(fixture())), second = render(p, p.sanitize(fixture()));
  const labels = [...first.querySelectorAll("label")];
  labels[1].click();
  assert.equal(first.querySelector("input:checked").id, "choice-1");
  assert.equal(labels[1].getAttribute("aria-checked"), "true");
  assert.equal(second.querySelector("input:checked").id, "choice-0");
  for (const [key, expected] of [["Home", 0], ["End", 1], ["ArrowRight", 0], ["ArrowLeft", 1], ["ArrowDown", 0], ["ArrowUp", 1], [" ", 1], ["Enter", 1]]) {
    const active = first.querySelector('label[aria-checked="true"]');
    active.dispatchEvent(new p.dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    assert.equal(first.querySelector("input:checked").id, `choice-${expected}`);
    assert.equal(first.activeElement, labels[expected]);
    assert.equal(first.querySelectorAll('label[tabindex="0"]').length, 1);
    assert.equal(second.querySelector("input:checked").id, "choice-0");
  }
});

test("radio state changes do not redeliver a record and stale deferred generation creates no controls", () => {
  const p = pipeline(), container = p.dom.window.document.createElement("div"), delivered = [];
  const renderer = p.api.selectionRichResultRenderer;
  const [card] = renderer.appendRichDictionaryCards(container, [{ id: "fixture", expandedByDefault: true }]);
  card.setResult({ text: "fallback", richRecord: { rawRecord: fixture(), format: "HTML" } }, "fixture", (...args) => delivered.push(args));
  const host = container.querySelector(".tf-selection-rich-text");
  host.shadowRoot.querySelectorAll("label")[1].click();
  assert.equal(delivered.length, 1);
  const closed = p.dom.window.document.createElement("div");
  const [old] = renderer.appendRichDictionaryCards(closed, [{ id: "old" }]);
  let current = true;
  old.setResult({ richRecord: { rawRecord: fixture(), format: "HTML" } }, "old", () => delivered.push("stale"), null, () => current);
  current = false;
  const details = closed.querySelector("details"); details.open = true; details.dispatchEvent(new p.dom.window.Event("toggle"));
  assert.equal(closed.querySelector(".tf-selection-rich-text"), null);
  assert.equal(delivered.length, 1);
});

test("rejected groups show all body text with notice, without CSS or inline hiding, while orphan decorations preserve valid controls", () => {
  const p = pipeline();
  const raw = '<link rel="stylesheet" href="hide.css">' + fixture().replace('<label for="choice-1">Second</label>', '') + '<p style="display:none">HIDDEN TAIL</p>';
  const ast = p.sanitize(raw);
  assert.equal(ast.controlsUnavailable, true);
  assert.equal(ast.nodes.every((node) => node.type === "text"), true);
  const root = render(p, ast);
  assert.match(root.querySelector(".tf-rich-viewer").textContent, /FIRST PANEL[\s\S]*SECOND PANEL[\s\S]*HIDDEN TAIL/u);
  assert.ok(root.querySelector(".tf-rich-truncated"));
  assert.equal(root.querySelectorAll("input,label,[style],link").length, 0);
  const healthy = p.sanitize('<link rel="stylesheet" href="hide.css">' + fixture() + '<label for="missing">Decoration</label>');
  assert.equal(healthy.controlsUnavailable, false);
  assert.ok(flat(healthy.nodes).some((node) => node.type === "resource" && node.kind === "stylesheet"));
  assert.equal(render(p, healthy).querySelectorAll("input").length, 2);
});

test("a post-render missing relation also falls back instead of exposing a partial interactive group", () => {
  const p = pipeline(), ast = p.sanitize(fixture());
  const tabs = flat(ast.nodes).find((node) => node.attrs?.class === "tabs");
  tabs.tag = "button"; // Viewer drops this subtree even though source relation data was valid.
  const root = render(p, ast);
  assert.equal(root.querySelectorAll("input,label").length, 0);
  assert.ok(root.querySelector(".tf-rich-truncated"));
  assert.match(root.querySelector(".tf-rich-viewer").textContent, /FIRST PANEL[\s\S]*SECOND PANEL/u);
});

test("one multi-record fallback cannot remove another record's controls and display is delivered once", () => {
  const p = pipeline(), container = p.dom.window.document.createElement("div"), delivered = [];
  const [card] = p.api.selectionRichResultRenderer.appendRichDictionaryCards(container, [{ id: "mixed", expandedByDefault: true }]);
  card.setResult({ records: [
    { text: "first fallback", richRecord: { format: "HTML", rawRecord: fixture().replace('<label for="choice-1">Second</label>', '') } },
    { text: "second controls", richRecord: { format: "HTML", rawRecord: fixture() } }
  ] }, "mixed", (...args) => delivered.push(args));
  const hosts = [...container.querySelectorAll(".tf-selection-rich-text")];
  assert.equal(hosts.length, 2);
  assert.equal(hosts[0].shadowRoot.querySelectorAll("input").length, 0);
  assert.match(hosts[0].shadowRoot.textContent, /FIRST PANEL[\s\S]*SECOND PANEL/u);
  assert.equal(hosts[1].shadowRoot.querySelectorAll("input").length, 2);
  hosts[1].shadowRoot.querySelectorAll("label")[1].click();
  assert.equal(hosts[1].shadowRoot.querySelector("input:checked").id, "choice-1");
  assert.equal(delivered.length, 1);
});
