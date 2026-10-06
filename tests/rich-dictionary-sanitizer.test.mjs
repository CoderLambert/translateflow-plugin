import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = new URL("../src/content/selection/rich-sanitizer.js", import.meta.url);
const STYLE_SOURCE = new URL("../src/content/selection/rich-sanitizer-style.js", import.meta.url);
const TOKENIZER_SOURCE = new URL("../src/content/selection/rich-sanitizer-tokenizer.js", import.meta.url);
const RESOURCE_PATH_SOURCE = new URL("../src/content/selection/rich-resource-path.js", import.meta.url);

function sanitizer() {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(RESOURCE_PATH_SOURCE, "utf8"), context, { filename: "rich-resource-path.js" });
  vm.runInContext(readFileSync(STYLE_SOURCE, "utf8"), context, { filename: "rich-sanitizer-style.js" });
  vm.runInContext(readFileSync(TOKENIZER_SOURCE, "utf8"), context, { filename: "rich-sanitizer-tokenizer.js" });
  vm.runInContext(readFileSync(SOURCE, "utf8"), context, { filename: "rich-sanitizer.js" });
  return context.__TRANSLATE_FLOW_CONTENT__.modules.selectionRichSanitizer;
}

function walk(nodes, visit) {
  for (const node of nodes) {
    visit(node);
    if (node.type === "element") walk(node.children, visit);
  }
}

function textContent(nodes) {
  let result = "";
  walk(nodes, (node) => {
    if (node.type === "text") result += node.text;
    else if (node.tag === "br") result += "\n";
  });
  return result;
}

function local(value) {
  return JSON.parse(JSON.stringify(value));
}

function countNodes(nodes) {
  let count = 0;
  walk(nodes, () => { count += 1; });
  return count;
}

test("safe rich markup preserves dictionary hierarchy and decodes entities as text", () => {
  const result = sanitizer().sanitizeRichDictionaryRecord({
    format: "HTML",
    rawRecord: "<div><p><b>word</b> &amp; meaning</p><ul><li><i>noun</i></li></ul><ruby>漢<rt>kan</rt></ruby><table><tr><th colspan=2>head</th><td>cell</td></tr></table></div>"
  });

  assert.equal(result.truncated, false);
  const tags = [];
  walk(result.nodes, (node) => { if (node.type === "element") tags.push(node.tag); });
  assert.deepEqual(tags, ["div", "p", "b", "ul", "li", "i", "ruby", "rt", "table", "tr", "th", "td"]);
  assert.equal(textContent(result.nodes), "word & meaningnoun漢kanheadcell");
  let headerCell;
  walk(result.nodes, (node) => { if (node.type === "element" && node.tag === "th") headerCell = node; });
  assert.deepEqual(local(headerCell.attrs), { colspan: "2" });
});

test("actual ECDICT compact stylesheet rules safely wrap each following segment", () => {
  const styleSheetRules = [
    { id: 1, begin: '<b style="font-size:180%;">', end: "</b>" },
    { id: 2, begin: "</br>", end: "" },
    { id: 3, begin: "<font color=dodgerblue>", end: "</font>" },
    { id: 4, begin: "<font color=gray>", end: "</font>" }
  ];
  const result = sanitizer().sanitizeRichDictionaryRecord({
    format: "HTML",
    styleSheetRules,
    rawRecord: "prefix `1`headword`2` n. definition `3`vi.`4`past form"
  });

  assert.equal(result.truncated, false);
  assert.equal(textContent(result.nodes), "prefix headword\n n. definition vi.past form");
  const elements = [];
  walk(result.nodes, (node) => { if (node.type === "element") elements.push(node); });
  assert.deepEqual(elements.filter((node) => node.attrs?.["data-compact-id"]).map((node) => node.attrs["data-compact-id"]), ["1", "2", "3", "4"]);
  assert.equal(elements[1].tag, "b");
  assert.equal(elements[1].style["font-size"], "180%");
  assert.equal(elements[3].tag, "br");
  assert.equal(elements[5].tag, "span");
  assert.equal(elements[5].style.color, "dodgerblue");
  assert.equal(elements[7].tag, "span");
  assert.equal(elements[7].style.color, "gray");
});

test("active markup, navigation, event handlers, unsafe CSS, and remote resources cannot enter the AST", () => {
  const result = sanitizer().sanitizeRichDictionaryRecord({
    format: "HTML",
    rawRecord: '<div onclick="alert(1)" style="color:red;background-image:url(https://evil.test/x);position:fixed">safe<script>alert(2)</script><iframe src="https://evil.test">frame text</iframe><svg><text>SVG text</text><image href="https://evil.test/svg.png"></svg><math><mi>Math text</mi></math><a href="javascript:alert(3)">link</a><img src="https://evil.test/image.png" alt="remote"><img src="//evil.test/image.png"><img src="images/local.png" alt="local"><audio src="data:audio/wav;base64,AA" controls>remote audio</audio><audio src="../sound/pronunciation.mp3" title="pronunciation">discarded player markup</audio><b style="font-size:999px;color:expression(alert(4))">bold</b></div>'
  });

  assert.equal(result.truncated, false);
  assert.equal(textContent(result.nodes), "safelinkbold");
  const elements = [];
  walk(result.nodes, (node) => { if (node.type === "element") elements.push(node); });
  assert.deepEqual(elements.map((node) => node.tag), ["div", "a", "b"]);
  const resources = [];
  walk(result.nodes, (node) => { if (node.type === "resource") resources.push(node); });
  assert.deepEqual(local(resources), [{ type: "resource", kind: "image", path: "images/local.png", label: "local" }]);
  assert.equal(Object.hasOwn(elements[1].attrs || {}, "href"), false);
  assert.equal(Object.hasOwn(elements[1].attrs || {}, "data-rich-fragment-target"), false);
  assert.deepEqual(local(elements[2].style || {}), {});
  assert.deepEqual(local(elements[0].style), { color: "red" });
  for (const element of elements) {
    assert.equal(Object.hasOwn(element.attrs || {}, "src"), false);
    assert.equal(Object.keys(element.attrs || {}).some((name) => name.startsWith("on")), false);
  }
});

test("sound:// maps only audio-tag and audio-link paths to normalized local resources", () => {
  const result = sanitizer().sanitizeRichDictionaryRecord({
    format: "HTML",
    rawRecord: '<a href="sound://kanji_alive_audio/08596-1.opus" title="reading">play</a><audio src="sound://kanji_alive_audio/08128-1.opus" title="voice"/><a href="https://example.test/audio.opus">remote</a><audio src="data:audio/ogg;base64,AA"/><audio src="sound://../private.opus"/><audio src="sound://https://example.test/a.opus"/><audio src="sound://sound://example.test/a.opus"/><audio src="sound://sound%253A%252F%252Fexample.test/a.opus"/><audio src="sound://kanji_alive_audio%2f..%2fprivate.opus"/>'
  });

  const resources = [];
  walk(result.nodes, (node) => { if (node.type === "resource") resources.push(node); });
  assert.deepEqual(local(resources), [
    { type: "resource", kind: "audio", path: "kanji_alive_audio/08596-1.opus", label: "reading" },
    { type: "resource", kind: "audio", path: "kanji_alive_audio/08128-1.opus", label: "voice" }
  ]);
});

test("decoded entity text stays inert and format Text is returned literally", () => {
  const module = sanitizer();
  const html = module.sanitizeRichDictionaryRecord({
    format: "HTML",
    rawRecord: "<span>&lt;script&gt;alert(1)&lt;/script&gt;</span>"
  });
  assert.equal(textContent(html.nodes), "<script>alert(1)</script>");
  assert.deepEqual(local(html.nodes[0].children), [{ type: "text", text: "<script>alert(1)</script>" }]);

  const plain = module.sanitizeRichDictionaryRecord({ format: "Text", rawRecord: "<b>&amp;</b> `1` literal" });
  assert.deepEqual(local(plain.nodes), [{ type: "text", text: "<b>&amp;</b> `1` literal" }]);
});

test("invalid and over-limit records return bounded plain-text fallback", () => {
  const module = sanitizer();
  const malformed = module.sanitizeRichDictionaryRecord({ format: "HTML", rawRecord: "before <b title='unterminated>after" });
  assert.equal(malformed.truncated, true);
  assert.equal(textContent(malformed.nodes), "before <b title='unterminated>after");

  const tooDeep = "<div>".repeat(40) + "word" + "</div>".repeat(40);
  const deep = module.sanitizeRichDictionaryRecord({ format: "HTML", rawRecord: tooDeep });
  assert.equal(deep.truncated, true);
  assert.equal(textContent(deep.nodes).replace(/\s/gu, ""), "word");

  const huge = module.sanitizeRichDictionaryRecord({ format: "HTML", rawRecord: "x".repeat(3 * 1024 * 1024) });
  assert.equal(huge.truncated, true);
  assert.ok(new TextEncoder().encode(huge.nodes[0].text).byteLength <= module.limits.fallbackBytes);
});

test("778,100-byte logical records keep a long node/resource stream and its tail within bounds", () => {
  const module = sanitizer();
  const repeatedNodes = "<span>x</span>".repeat(15_000);
  const repeatedResources = '<audio src="interop/tone.wav"/>'.repeat(526);
  const prefix = `<div>BEGIN${repeatedNodes}${repeatedResources}`;
  const suffix = "<p>TAIL_SENTINEL</p></div>";
  const fillerBytes = 778_100 - prefix.length - suffix.length - 7;
  assert.ok(fillerBytes > 0);
  const rawRecord = `${prefix}<!--${"x".repeat(fillerBytes)}-->${suffix}`;
  assert.equal(new TextEncoder().encode(rawRecord).byteLength, 778_100);
  const result = module.sanitizeRichDictionaryRecord({ format: "HTML", rawRecord });
  assert.equal(result.truncated, false);
  assert.equal(textContent(result.nodes).includes("TAIL_SENTINEL"), true);
  let resources = 0;
  walk(result.nodes, (node) => { if (node.type === "resource") resources += 1; });
  assert.equal(resources, 526);
  assert.ok(countNodes(result.nodes) <= module.limits.outputNodes);
});

test("resource references deduplicate paths and cap unique resources at 1,024", () => {
  const module = sanitizer();
  const duplicates = module.sanitizeRichDictionaryRecord({
    format: "HTML",
    rawRecord: '<img src="images/same.png"/>'.repeat(526)
  });
  assert.equal(duplicates.truncated, false);
  let duplicateReferences = 0;
  walk(duplicates.nodes, (node) => { if (node.type === "resource") duplicateReferences += 1; });
  assert.equal(duplicateReferences, 526);

  const unique = module.sanitizeRichDictionaryRecord({
    format: "HTML",
    rawRecord: Array.from({ length: 1_025 }, (_, index) => `<img src="images/${index}.png"/>`).join("")
  });
  assert.equal(unique.truncated, true);
  let uniqueResources = 0;
  walk(unique.nodes, (node) => { if (node.type === "resource") uniqueResources += 1; });
  assert.equal(uniqueResources, 1_024);
});

test("nested active subtrees have a strict depth bound", () => {
  const module = sanitizer();
  const adversarial = "before" + "<video>".repeat(10_000) + "inside" + "</iframe>".repeat(10_000);
  const result = module.sanitizeRichDictionaryRecord({ format: "HTML", rawRecord: adversarial });
  assert.equal(result.truncated, true);
  assert.ok(textContent(result.nodes).length <= module.limits.fallbackBytes);
  assert.equal(textContent(result.nodes).includes("inside"), false);
});

test("unknown compact ids stay literal and invalid stylesheet data cannot expand markup", () => {
  const module = sanitizer();
  const unknown = module.sanitizeRichDictionaryRecord({ format: "HTML", rawRecord: "`9`entry", styleSheetRules: [] });
  assert.equal(textContent(unknown.nodes), "`9`entry");
  const invalid = module.sanitizeRichDictionaryRecord({
    format: "HTML",
    rawRecord: "`1`entry",
    styleSheetRules: [{ id: 1, begin: "<script>", end: "</script>" }, { id: 1, begin: "<b>", end: "</b>" }]
  });
  assert.equal(textContent(invalid.nodes), "`1`entry");
});
