import test from "node:test";
import assert from "node:assert/strict";
import { buildMddIndex, lookupMddResource } from "../src/background/packs/importers/mdd.js";
import { makeMdd } from "./helpers/mdd-fixture.mjs";
import { makeTinyTrueType } from "./helpers/ttf-fixture.mjs";
import { sanitizeRichMddStylesheet } from "../src/background/packs/rich-mdd-css.js";

test("CSS AST sanitizer scopes safe rules and converts local image URLs into package slots", () => {
  const source = Buffer.from([
    "/* supported comments are parsed, not interpreted as syntax */",
    ".entry { color: #2f5d50; background-image: url('../images/flower.png'); }",
    "@media (prefers-color-scheme: dark) { .entry { font-weight: 600; } }",
    "@import url('https://attacker.invalid/remote.css');",
    "#outside { position: fixed; inset: 0; }"
  ].join("\n"));
  const result = sanitizeRichMddStylesheet(source, "styles/entry.css");
  assert.match(result.css, /\.tf-rich-viewer \.entry\{color:#2f5d50;background-image:tfasset0\}/u);
  assert.match(result.css, /@media \(prefers-color-scheme: dark\)/u);
  assert.doesNotMatch(result.css, /attacker\.invalid|position:fixed|inset:0/u);
  assert.deepEqual(result.assetSlots, [{ token: "tfasset0", path: "images/flower.png", kind: "image" }]);
  assert.ok(result.diagnostics.includes("css.rule_filtered"));
});

test("CSS AST sanitizer preserves bounded color functions and maps ID selectors to viewer targets", () => {
  const result = sanitizeRichMddStylesheet(Buffer.from([
    ".rgb { color: rgb(31, 93, 80); }",
    ".rgba { background-color: rgba(1, 2, 3, .4); }",
    ".hsl { color: hsl(210, 50%, 40%); }",
    "#media-anchor { color: blue; }",
    ".unsafe { color: color-mix(in srgb, red, blue); font-size: calc(1px + 1px); }"
  ].join("\n")), "styles/entry.css");

  assert.match(result.css, /\.tf-rich-viewer \.rgb\{color:rgb\(/u);
  assert.match(result.css, /\.tf-rich-viewer \.rgba\{background-color:rgba\(/u);
  assert.match(result.css, /\.tf-rich-viewer \.hsl\{color:hsl\(/u);
  assert.match(result.css, /\.tf-rich-viewer \[data-rich-target-id="media-anchor"\]\{color:blue\}/u);
  assert.doesNotMatch(result.css, /color-mix|calc\(/u);
  assert.ok(result.diagnostics.includes("css.declaration_filtered"));
});

test("CSS AST sanitizer rejects remote, encoded, and active asset URLs", () => {
  const result = sanitizeRichMddStylesheet(Buffer.from([
    ".x { background-image: url('https://attacker.invalid/x.png'); }",
    ".y { background-image: url('javascript:alert(1)'); }",
    ".z { background-image: url('../../outside.png'); }"
  ].join("\n")), "css/entry.css");
  assert.equal(result.assetSlots.length, 0);
  assert.doesNotMatch(result.css, /url\(|attacker|javascript/u);
  assert.ok(result.diagnostics.includes("css.declaration_filtered"));
});

test("CSS AST sanitizer bounds invalid input and refuses to emit parse failures", () => {
  const invalidUtf8 = sanitizeRichMddStylesheet(new Uint8Array([0xff]), "entry.css");
  assert.deepEqual(invalidUtf8, { css: "", assetSlots: [], diagnostics: ["css.invalid_utf8"] });
  const oversized = sanitizeRichMddStylesheet(new Uint8Array(64 * 1024 + 1), "entry.css");
  assert.deepEqual(oversized, { css: "", assetSlots: [], diagnostics: ["css.input_limit"] });
  const malformed = sanitizeRichMddStylesheet(Buffer.from(".x { color: red"), "entry.css");
  assert.equal(malformed.css, "");
  assert.deepEqual(malformed.assetSlots, []);
  assert.ok(malformed.diagnostics.includes("css.parse_failed"));
});

test("closed selector AST retains compound and bounded state relations without global or functional selectors", () => {
  const result = sanitizeRichMddStylesheet(Buffer.from([
    'input.choice#choice-0:checked ~ div.panels > .panel-0 { display:block; }',
    '.choice:checked + label.tab { display:flex; align-items:center; justify-content:flex-start; position:relative; width:max-content; }',
    'details[open] > summary:first-child { color:red; }',
    '.tabs label:last-child:focus::after { content:"›"; }',
    ':host .escape,:root,html,body,.x:has(.y),.x:not(.y),[for="private"],.x[data-title],.x:nth-child(1),.x::marker { color:red; }',
    '.x\\61 { color:red; }',
    '.x { position:fixed; content:"bad"; }'
  ].join('\n')), "entry.css");
  assert.match(result.css, /input\.choice\[data-rich-target-id="choice-0"\]:checked ~ div\.panels > \.panel-0/u);
  assert.match(result.css, /display:flex;align-items:center;justify-content:flex-start;position:relative;width:max-content/u);
  assert.match(result.css, /details\[open\] > summary:first-child/u);
  assert.match(result.css, /label:last-child:focus::after\{content:"›"\}/u);
  assert.doesNotMatch(result.css, /:host|:root|:has|:not|data-title|\[for|nth-child|::marker|position:fixed|content:"bad"|x\\61/u);
  assert.ok(result.diagnostics.includes("css.selector_filtered"));
});

test("static pseudo content rejects resource, attribute, function and unbounded values", () => {
  const result = sanitizeRichMddStylesheet(Buffer.from([
    '.a::before{content:""}', '.b::after{content:"•"}',
    '.c::after{content:attr(data-title)}', '.d::before{content:url(https://attacker.invalid)}',
    '.e::before{content:counter(secret)}', '.f::after{content:"' + 'x'.repeat(81) + '"}',
    '.g::after{content:"<script>"}', '.h::after{content:"\\a"}'
  ].join('\n')), "entry.css");
  assert.equal(result.css, '.tf-rich-viewer .a::before{content:""}.tf-rich-viewer .b::after{content:"•"}');
  assert.deepEqual(result.assetSlots, []);
});

test("media AST accepts only one bounded screen/px feature or known color scheme", () => {
  const result = sanitizeRichMddStylesheet(Buffer.from([
    '@media screen and (max-width:500px){.a{display:block}}',
    '@media (max-width:374px){.b{display:none}}',
    '@media print{.bad{color:red}}', '@media screen and (max-width:999px){.bad{color:red}}',
    '@media screen and (min-width:400px){.bad{color:red}}', '@media (max-width:500px),screen{.bad{color:red}}',
    '@media (max-width:calc(1px + 1px)){.bad{color:red}}'
  ].join('\n')), "entry.css");
  assert.match(result.css, /@media screen and \(max-width: 500px\)/u);
  assert.match(result.css, /@media \(max-width: 374px\)/u);
  assert.doesNotMatch(result.css, /\.bad/u);
});

test("CSS visits rejected source rules before late state rules without spending accepted budget", () => {
  const source = '.bad:has(.x){color:red}'.repeat(300) + '.choice:checked ~ .panel{display:block}';
  const result = sanitizeRichMddStylesheet(Buffer.from(source), "entry.css");
  assert.match(result.css, /\.choice:checked ~ \.panel\{display:block\}/u);
  assert.equal(result.diagnostics.includes("css.rule_limit"), false);
  const overflow = sanitizeRichMddStylesheet(Buffer.from('.bad:has(.x){color:red}'.repeat(1025)), "entry.css");
  assert.equal(overflow.css, ""); assert.ok(overflow.diagnostics.includes("css.rule_limit"));
});

test("accepted-rule and expanded UTF8 output overflow return diagnostics and no partial style", () => {
  const edge = sanitizeRichMddStylesheet(Buffer.from('.x{color:red}'.repeat(512)), "entry.css");
  assert.equal((edge.css.match(/color:red/gu) || []).length, 512);
  const extra = sanitizeRichMddStylesheet(Buffer.from('.x{color:red}'.repeat(513)), "entry.css");
  assert.equal(extra.css, ""); assert.ok(extra.diagnostics.includes("css.accepted_rule_limit"));
  const ids = Array.from({ length: 512 }, (_, index) => '#' + ('x'.repeat(76) + index) + '{color:red}').join('');
  assert.ok(Buffer.byteLength(ids) < 64 * 1024);
  const expanded = sanitizeRichMddStylesheet(Buffer.from(ids), "entry.css");
  assert.equal(expanded.css, ""); assert.ok(expanded.diagnostics.includes("css.output_limit"));
});

test("nested media depth overflow diagnoses and rejects partial CSS", () => {
  const rule = '.safe{color:red}';
  const nested = '@media (max-width:500px){'.repeat(3) + rule + '}'.repeat(3);
  const result = sanitizeRichMddStylesheet(Buffer.from(rule + nested), "entry.css");
  assert.equal(result.css, ""); assert.ok(result.diagnostics.includes("css.depth_limit"));
});

test("passive nav and section type selectors retain state structure with the existing scope", () => {
  const result = sanitizeRichMddStylesheet(Buffer.from('input.choice:checked ~ nav.o-pos-tabs > label.tab{color:red}input.choice:checked ~ div.o-pos-panels > section.o-pos.o-pos-panel.o-for-pos-3{display:block}form input:checked ~ section{color:red}'), "entry.css");
  assert.match(result.css, /\.tf-rich-viewer input\.choice:checked ~ nav\.o-pos-tabs > label\.tab\{color:red\}/u);
  assert.match(result.css, /div\.o-pos-panels > section\.o-pos\.o-pos-panel\.o-for-pos-3\{display:block\}/u);
  assert.doesNotMatch(result.css, /form/u);
});

test("font AST projects four bounded faces of one anonymous family even when declared after selectors", () => {
  const faces = [['normal', '400', 'swap'], ['italic', '400', 'fallback'], ['normal', '700', 'swap'], ['italic', '700', 'fallback']];
  const source = '.entry{font-family:"FIXTURE TYPE",Arial,serif;color:red}' + faces.map(([style, weight, display], index) => `@font-face{font-family:"Fixture Type";src:url('../fonts/${index}.ttf') format('truetype');font-style:${style};font-weight:${weight};font-display:${display}}`).join('');
  const result = sanitizeRichMddStylesheet(Buffer.from(source), 'styles/entry.css');
  assert.equal(result.fontFaces.length, 4);
  assert.deepEqual(result.fontFaces.map((face) => face.familyToken), ['tffamily0', 'tffamily0', 'tffamily0', 'tffamily0']);
  assert.deepEqual(result.fontFaces.map((face) => [face.style, face.weight, face.display]), faces);
  assert.match(result.css, /font-family:tffamily0,serif;color:red/u);
  assert.doesNotMatch(result.css, /font-face|Fixture|FIXTURE|Arial|url\(/u);
  assert.deepEqual(result.assetSlots, []);
});

test("malicious or ambiguous font sources and descriptors are filtered without losing body CSS", () => {
  const declarations = [
    'src:local("Private System")', 'src:url(https://attacker.invalid/a.ttf)', 'src:url(data:font/ttf;base64,AAAA)',
    'src:url(../outside.ttf)', 'src:url(a.ttf),url(b.ttf)', 'src:url(a.ttf) format("woff")',
    'src:url(a.ttf);font-weight:100 900', 'src:url(a.ttf);font-style:oblique', 'src:url(a.ttf);font-display:block',
    'src:url(a.ttf);font-family:another', 'src:url(a.ttf);unicode-range:U+0-FFFF'
  ];
  for (const declaration of declarations) {
    const result = sanitizeRichMddStylesheet(Buffer.from(`.entry{font-family:Unknown,Arial,sans-serif;color:red}@font-face{font-family:Fixture;${declaration}}`), 'entry.css');
    assert.equal(result.fontFaces, undefined, declaration);
    assert.equal(result.css, '.tf-rich-viewer .entry{font-family:sans-serif;color:red}');
    assert.ok(result.diagnostics.includes('css.font_filtered'));
  }
});

test("font defaults, duplicate variants and eight combined image/font slots stay bounded", () => {
  const face = '@font-face{font-family:Fixture;src:url(a.ttf)}';
  const duplicate = sanitizeRichMddStylesheet(Buffer.from(face + face + '.entry{font-family:Fixture,monospace}'), 'entry.css');
  assert.deepEqual(duplicate.fontFaces, [{ familyToken: 'tffamily0', path: 'a.ttf', style: 'normal', weight: '400', display: 'swap' }]);
  assert.ok(duplicate.diagnostics.includes('css.font_duplicate'));
  const source = Array.from({ length: 9 }, (_, index) => `@font-face{font-family:F${index};src:url(${index}.ttf)}`).join('') + '.entry{color:red;background-image:url(image.png)}';
  const result = sanitizeRichMddStylesheet(Buffer.from(source), 'entry.css');
  assert.equal(result.fontFaces.length, 8); assert.deepEqual(result.assetSlots, []);
  assert.ok(result.diagnostics.includes('css.font_limit')); assert.match(result.css, /color:red/u);
  const mixed = sanitizeRichMddStylesheet(Buffer.from(face + Array.from({ length: 8 }, (_, index) => `.i${index}{background-image:url(${index}.png)}`).join('')), 'entry.css');
  assert.equal(mixed.fontFaces.length + mixed.assetSlots.length, 8);
});


test("verified percent-encoded spaces map once to the exact local MDD font key", async () => {
  const source = '@font-face{font-family:Fixture;src:url("fonts/Test%20Font.ttf")} .entry{font-family:Fixture,serif}';
  const result = sanitizeRichMddStylesheet(Buffer.from(source), 'entry.css');
  assert.deepEqual(result.fontFaces, [{ familyToken: 'tffamily0', path: 'fonts/Test Font.ttf', style: 'normal', weight: '400', display: 'swap' }]);
  const font = makeTinyTrueType(), bytes = makeMdd([['fonts/Test Font.ttf', font]]);
  const mddSource = { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) };
  const index = await buildMddIndex({ source: mddSource });
  const lookup = await lookupMddResource({ source: mddSource, index, path: result.fontFaces[0].path });
  assert.equal(lookup.found, true); assert.equal(lookup.kind, 'font'); assert.equal(lookup.mime, 'font/ttf');
  assert.deepEqual(Buffer.from(lookup.bytes), font);
  const relative = sanitizeRichMddStylesheet(Buffer.from('@font-face{font-family:Fixture;src:url("../fonts/Test%20Font.ttf")}'), 'styles/entry.css');
  assert.equal(relative.fontFaces[0].path, 'fonts/Test Font.ttf');
});

test("font URL percent compatibility rejects all other escapes, encoded traversal and double encoding", () => {
  for (const path of [
    'fonts/Test%2520Font.ttf', 'fonts/Test%2FFont.ttf', 'fonts/Test%2fFont.ttf', 'fonts/Test%5cFont.ttf',
    '%2e%2e/fonts/a.ttf', '%2E%2E/fonts/a.ttf', 'fonts/%2e%2e/a.ttf', 'fonts/Test%00Font.ttf',
    'fonts/Test%0aFont.ttf', 'fonts/Test%7fFont.ttf', 'fonts/Test%3fFont.ttf', 'fonts/Test%23Font.ttf',
    'https%3a//attacker.invalid/a.ttf', 'fonts/Test%20Font.ttf?x=1', 'fonts/Test%20Font.ttf#fragment',
    'fonts/Test%Font.ttf', 'fonts/Test%2020%252e.ttf', '../outside/Test%20Font.ttf',
    'https://attacker.invalid/Test%20Font.ttf', '//attacker.invalid/Test%20Font.ttf'
  ]) {
    const result = sanitizeRichMddStylesheet(Buffer.from(`@font-face{font-family:Fixture;src:url("${path}")} .entry{color:red;font-family:Fixture,serif}`), 'entry.css');
    assert.equal(result.fontFaces, undefined, path); assert.ok(result.diagnostics.includes('css.font_filtered'), path);
    assert.equal(result.css, '.tf-rich-viewer .entry{color:red;font-family:serif}');
  }
});
