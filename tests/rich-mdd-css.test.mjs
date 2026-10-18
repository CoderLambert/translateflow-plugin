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
  assert.match(result.css, /@container tf-rich-article \(max-width: 500px\)/u);
  assert.match(result.css, /@container tf-rich-article \(max-width: 374px\)/u);
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
  const edge = sanitizeRichMddStylesheet(Buffer.from(Array.from({ length: 512 }, (_, index) => `.x${index}{color:#${index.toString(16).padStart(6, "0")}}`).join('')), "entry.css");
  assert.equal((edge.css.match(/color:#[0-9a-f]{6}/gu) || []).length, 512);
  const extra = sanitizeRichMddStylesheet(Buffer.from(Array.from({ length: 513 }, (_, index) => `.x${index}{color:#${index.toString(16).padStart(6, "0")}}`).join('')), "entry.css");
  assert.equal(extra.css, ""); assert.ok(extra.diagnostics.includes("css.accepted_rule_limit"));
  const ids = Array.from({ length: 512 }, (_, index) => '#' + ('x'.repeat(76) + index) + `{color:#${index.toString(16).padStart(6, '0')}}`).join('');
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

test('bounded flex declarations preserve coherent row layouts and article-relative narrow stacking', () => {
  const result = sanitizeRichMddStylesheet(Buffer.from([
    '.line{display:flex;flex-flow:row wrap;gap:4px 1em}',
    '.pronunciation{display:inline-flex;flex-direction:row;flex-wrap:wrap}',
    '.body{display:flex;flex-direction:row-reverse}',
    '.child{flex-grow:16;flex-shrink:.25;flex-basis:100%;flex:1 1 auto;min-width:0;row-gap:64px;column-gap:4rem}',
    '@media screen and (max-width:500px){.body{flex-direction:column;gap:0}}'
  ].join('')), 'entry.css');
  assert.match(result.css, /\.tf-rich-viewer \.line\{display:flex;flex-flow:row wrap;gap:4px 1em\}/u);
  assert.match(result.css, /display:inline-flex;flex-direction:row;flex-wrap:wrap/u);
  assert.match(result.css, /flex-direction:row-reverse/u);
  assert.match(result.css, /flex-grow:16;flex-shrink:\.25;flex-basis:100%;flex:1 1 auto;min-width:0;row-gap:64px;column-gap:4rem/u);
  assert.match(result.css, /@container tf-rich-article \(max-width: 500px\)\{\.tf-rich-viewer \.body\{flex-direction:column;gap:0\}\}/u);
  assert.deepEqual(result.diagnostics, []); assert.deepEqual(result.assetSlots, []);
});

test('flex shorthand accepts only bounded common forms and finite direction/wrap combinations', () => {
  for (const value of ['0', '1', '.25', '0 1 auto', '1 20px', '1 1 0%', '2 0 40rem', '.25 .5 512px', 'auto', 'none', 'initial']) {
    const result = sanitizeRichMddStylesheet(Buffer.from(`.ok{flex:${value}}`), 'entry.css');
    assert.match(result.css, /^\.tf-rich-viewer \.ok\{flex:/u, value); assert.deepEqual(result.diagnostics, [], value);
  }
  for (const value of ['row', 'column-reverse', 'wrap', 'nowrap', 'row wrap', 'wrap-reverse column-reverse']) {
    const result = sanitizeRichMddStylesheet(Buffer.from(`.ok{flex-flow:${value}}`), 'entry.css');
    assert.equal(result.css, `.tf-rich-viewer .ok{flex-flow:${value}}`); assert.deepEqual(result.diagnostics, []);
  }
});

test('new flex, minimum-width and gap values reject escape functions, unbounded factors and unsupported grammar', () => {
  const unsafe = {
    'flex-direction': ['inherit', 'unset', 'revert', 'sideways', 'row column'],
    'flex-wrap': ['inherit', 'balance', 'wrap nowrap'],
    'flex-flow': ['row column', 'wrap nowrap', 'row row', 'row wrap auto', 'var(--flow)'],
    'flex-grow': ['17', '16.01', '-1', '+1', '1e2', 'calc(1 + 1)', 'var(--grow)'],
    'flex-shrink': ['999', 'Infinity', '-.1', 'attr(data-size)'],
    'flex-basis': ['513px', '40.01em', '101%', '-1px', '1vw', '1vh', 'min-content', 'max-content', 'calc(100% - 1px)'],
    flex: ['17 1 auto', '1 17 0', '1 1 513px', '1 1 101%', '-1 1 auto', '1 1 auto 0', 'auto 1 1', 'inherit', 'var(--flex)', 'url(https://attacker.invalid)'],
    'min-width': ['auto', 'none', '513px', '41rem', '101%', '-1px', '100vw', 'env(safe-area-inset-left)'],
    gap: ['65px', '4.01em', '26%', '-1px', '1px 2px 3px', 'normal', 'calc(1px + 1px)'],
    'row-gap': ['1px 2px', '65px', 'var(--gap)'],
    'column-gap': ['4.01rem', '26%', '1svw']
  };
  for (const [property, values] of Object.entries(unsafe)) for (const value of values) {
    const result = sanitizeRichMddStylesheet(Buffer.from(`.keep{color:red;${property}:${value}}`), 'entry.css');
    assert.equal(result.css, '.tf-rich-viewer .keep{color:red}', `${property}:${value}`);
    assert.ok(result.diagnostics.includes('css.declaration_filtered'), `${property}:${value}`); assert.deepEqual(result.assetSlots, []);
  }
  const escaped = sanitizeRichMddStylesheet(Buffer.from('.keep{display:inline-flex;position:fixed;inset:0;z-index:999;order:-1;overflow:visible}'), 'entry.css');
  assert.equal(escaped.css, '.tf-rich-viewer .keep{display:inline-flex}');
});

test('min-width and gap accept their exact finite boundaries without altering rule or declaration budgets', () => {
  for (const [property, value] of [['min-width', '0'], ['min-width', '512px'], ['min-width', '40em'], ['min-width', '100%'], ['flex-basis', 'auto'], ['gap', '64px 4rem'], ['row-gap', '25%']]) {
    const result = sanitizeRichMddStylesheet(Buffer.from(`.ok{${property}:${value}}`), 'entry.css'); assert.equal(result.css, `.tf-rich-viewer .ok{${property}:${value}}`);
  }
  const declarations = '.ok{' + 'min-width:0;'.repeat(13) + '}';
  const limited = sanitizeRichMddStylesheet(Buffer.from(declarations), 'entry.css');
  assert.equal((limited.css.match(/min-width:0/gu) || []).length, 12); assert.ok(limited.diagnostics.includes('css.declaration_limit'));
  const rules = sanitizeRichMddStylesheet(Buffer.from(Array.from({ length: 513 }, (_, index) => `.ok${index}{display:inline-flex;color:#${index.toString(16).padStart(6, "0")}}`).join('')), 'entry.css');
  assert.equal(rules.css, ''); assert.ok(rules.diagnostics.includes('css.accepted_rule_limit'));
});

test('background shorthand projects only pure colors and never admits resource or functional backgrounds', () => {
  for (const value of ['red', '#123456', '#abcd', 'transparent', 'rgba(1,2,3,.4)', 'hsl(210,50%,40%)']) {
    const result = sanitizeRichMddStylesheet(Buffer.from(`.contrast{color:white;background:${value}}`), 'entry.css');
    assert.equal(result.css, `.tf-rich-viewer .contrast{color:white;background-color:${value}}`);
    assert.deepEqual(result.assetSlots, []); assert.deepEqual(result.diagnostics, []);
  }
  for (const value of ['url(local.png)', 'url(https://attacker.invalid/x.png)', 'linear-gradient(red,blue)', 'radial-gradient(red,blue)', 'var(--bg)', 'env(x)', 'none', 'red center', '#fff no-repeat', 'red,url(local.png)', 'color-mix(in srgb,red,blue)']) {
    const result = sanitizeRichMddStylesheet(Buffer.from(`.contrast{color:white;background:${value}}`), 'entry.css');
    assert.equal(result.css, '.tf-rich-viewer .contrast{color:white}', value); assert.deepEqual(result.assetSlots, []);
  }
  const important = sanitizeRichMddStylesheet(Buffer.from('.keep{color:red;background:white!important;flex-flow:row wrap!important}'), 'entry.css');
  assert.equal(important.css, '.tf-rich-viewer .keep{color:red}');
});

test('width queries become only the named article container, while color media retain their media scope', () => {
  const result = sanitizeRichMddStylesheet(Buffer.from([
    '@media (max-width:374px){.entry{flex-direction:column}}',
    '@media screen and (max-width:800px){.entry{flex-wrap:wrap}}',
    '@media (prefers-color-scheme:dark){.entry{background:#123;color:white}}',
    '@media (prefers-color-scheme:light){.entry{background:white}}',
    '@container page (max-width:500px){.escape{display:flex}}',
    '@media (max-width:239px){.escape{color:red}}',
    '@media (max-width:801px){.escape{color:red}}',
    '@media (max-width:500px) and (prefers-color-scheme:dark){.escape{color:red}}'
  ].join('')), 'entry.css');
  assert.match(result.css, /@container tf-rich-article \(max-width: 374px\)\{\.tf-rich-viewer \.entry\{flex-direction:column\}\}/u);
  assert.match(result.css, /@container tf-rich-article \(max-width: 800px\)/u);
  assert.match(result.css, /@media \(prefers-color-scheme: dark\)\{\.tf-rich-viewer \.entry\{background-color:#123;color:white\}\}/u);
  assert.match(result.css, /@media \(prefers-color-scheme: light\)/u);
  assert.doesNotMatch(result.css, /@media[^{}]*max-width|@container page|\.escape/u);
  assert.ok(result.diagnostics.includes('css.rule_filtered')); assert.ok(result.diagnostics.includes('css.media_filtered'));
});

test('ordinary list item flex directions use the same finite grammar without dictionary-specific exceptions', () => {
  const result = sanitizeRichMddStylesheet(Buffer.from('ul.examples > li{display:flex;flex-direction:column;flex-wrap:wrap;min-width:0}li.synonym{display:flex;flex-direction:row-reverse}'), 'entry.css');
  assert.equal(result.css, '.tf-rich-viewer ul.examples > li{display:flex;flex-direction:column;flex-wrap:wrap;min-width:0}.tf-rich-viewer li.synonym{display:flex;flex-direction:row-reverse}');
  assert.deepEqual(result.diagnostics, []);
});

test('identical sanitized rules keep their last source position across an intervening overriding rule', () => {
  const result = sanitizeRichMddStylesheet(Buffer.from('.a{color:red}.b{color:blue}.a{color:red}'), 'entry.css');
  assert.equal(result.css, '.tf-rich-viewer .b{color:blue}.tf-rich-viewer .a{color:red}');
  const normalized = sanitizeRichMddStylesheet(Buffer.from('.a{background: red;position:fixed}.b{color:blue}.a{background-color:red}'), 'entry.css');
  assert.equal(normalized.css, '.tf-rich-viewer .b{color:blue}.tf-rich-viewer .a{background-color:red}');
  const different = sanitizeRichMddStylesheet(Buffer.from('.a{color:red}.a{color:blue}.a{color:red;font-weight:bold}'), 'entry.css');
  assert.equal((different.css.match(/\.a\{/gu) || []).length, 3, 'only the complete safe rule may be deduplicated');
});

test('deduplication is local to each rule list and never crosses media or article-container conditions', () => {
  const result = sanitizeRichMddStylesheet(Buffer.from([
    '.same{color:red}',
    '@media(prefers-color-scheme:dark){.same{color:red}.same{color:red}}',
    '@media(prefers-color-scheme:light){.same{color:red}}',
    '@media(max-width:500px){.same{color:red}.same{color:red}}',
    '@media(max-width:500px){.same{color:red}}',
    '.same{color:red}'
  ].join('')), 'entry.css');
  assert.equal((result.css.match(/\.same\{color:red\}/gu) || []).length, 5);
  assert.equal((result.css.match(/@container tf-rich-article/gu) || []).length, 2, 'separate blocks remain separate even with the same query');
  assert.ok(result.css.endsWith('.tf-rich-viewer .same{color:red}')); assert.ok(result.css.startsWith('@media (prefers-color-scheme: dark)'));
  assert.deepEqual(result.diagnostics, []);
});

test('output counts retained rules while duplicate source rules still consume the unchanged visit budget', () => {
  const edge = sanitizeRichMddStylesheet(Buffer.from('.same{display:inline-flex}'.repeat(1024)), 'entry.css');
  assert.equal(edge.css, '.tf-rich-viewer .same{display:inline-flex}'); assert.deepEqual(edge.diagnostics, []);
  const extra = sanitizeRichMddStylesheet(Buffer.from('.same{display:inline-flex}'.repeat(1025)), 'entry.css');
  assert.equal(extra.css, ''); assert.ok(extra.diagnostics.includes('css.rule_limit'));
  const nested = '@media(max-width:500px){.same{color:red}.same{color:red}}';
  const allowed = sanitizeRichMddStylesheet(Buffer.from(nested.repeat(512)), 'entry.css');
  assert.equal((allowed.css.match(/\.same\{color:red\}/gu) || []).length, 512); assert.deepEqual(allowed.diagnostics, []);
  const over = sanitizeRichMddStylesheet(Buffer.from('@media(max-width:500px){.same{color:red}}'.repeat(513)), 'entry.css');
  assert.equal(over.css, ''); assert.ok(over.diagnostics.includes('css.accepted_rule_limit'));
});

test('adjacent rules with identical complete declarations merge selectors without losing cascade alternatives', () => {
  const result = sanitizeRichMddStylesheet(Buffer.from('.a{color:red;font-weight:700}.b{color:red;font-weight:700}.c{color:blue}.d{color:red;font-weight:700}'), 'entry.css');
  assert.equal(result.css, '.tf-rich-viewer .a,.tf-rich-viewer .b{color:red;font-weight:700}.tf-rich-viewer .c{color:blue}.tf-rich-viewer .d{color:red;font-weight:700}');
  const state = sanitizeRichMddStylesheet(Buffer.from('input.a:checked ~ .one{display:block}input.b:checked + .two{display:block}'), 'entry.css');
  assert.equal(state.css, '.tf-rich-viewer input.a:checked ~ .one,.tf-rich-viewer input.b:checked + .two{display:block}');
  assert.deepEqual(result.diagnostics, []);
});

test('different declarations, nonadjacent rules and every emitted conditional block prevent adjacent merging', () => {
  const result = sanitizeRichMddStylesheet(Buffer.from('.a{color:red}.different{color:blue}.b{color:red}@media(prefers-color-scheme:dark){.dark-a{color:red}.dark-b{color:red}}.c{color:red}@media(max-width:500px){.narrow-a{color:red}.narrow-b{color:red}}.d{color:red}'), 'entry.css');
  assert.match(result.css, /^\.tf-rich-viewer \.a\{color:red\}\.tf-rich-viewer \.different\{color:blue\}\.tf-rich-viewer \.b\{color:red\}/u);
  assert.match(result.css, /@media \(prefers-color-scheme: dark\)\{\.tf-rich-viewer \.dark-a,\.tf-rich-viewer \.dark-b\{color:red\}\}\.tf-rich-viewer \.c\{color:red\}/u);
  assert.match(result.css, /@container tf-rich-article \(max-width: 500px\)\{\.tf-rich-viewer \.narrow-a,\.tf-rich-viewer \.narrow-b\{color:red\}\}\.tf-rich-viewer \.d\{color:red\}/u);
});

test('merged selector groups remain bounded by count and generated selector characters', () => {
  const many = sanitizeRichMddStylesheet(Buffer.from(Array.from({ length: 33 }, (_, index) => `.a${index}{color:red}`).join('')), 'entry.css');
  const countGroups = many.css.split('}').filter(Boolean).map(rule => rule.slice(0, rule.indexOf('{')).split(','));
  assert.deepEqual(countGroups.map(group => group.length), [32, 1]);
  const long = sanitizeRichMddStylesheet(Buffer.from(Array.from({ length: 20 }, (_, index) => `.${'x'.repeat(44)}${String(index).padStart(2, '0')}{color:red}`).join('')), 'entry.css');
  const headers = long.css.split('}').filter(Boolean).map(rule => rule.slice(0, rule.indexOf('{')));
  assert.ok(headers.length > 1); assert.ok(headers.every(header => header.length <= 1024));
  assert.equal(headers.flatMap(header => header.split(',')).length, 20, 'every original validated selector is retained');
});

test('adjacent merging spends final rule budget while retaining visits and independent conditional output limits', () => {
  const compact = sanitizeRichMddStylesheet(Buffer.from(Array.from({ length: 1024 }, (_, index) => `.a${index}{color:red}`).join('')), 'entry.css');
  assert.notEqual(compact.css, ''); assert.equal(compact.diagnostics.includes('css.accepted_rule_limit'), false);
  const visited = sanitizeRichMddStylesheet(Buffer.from(Array.from({ length: 1025 }, (_, index) => `.a${index}{color:red}`).join('')), 'entry.css');
  assert.equal(visited.css, ''); assert.ok(visited.diagnostics.includes('css.rule_limit'));
  const independent = sanitizeRichMddStylesheet(Buffer.from('@media(max-width:500px){.a{color:red}}'.repeat(513)), 'entry.css');
  assert.equal(independent.css, ''); assert.ok(independent.diagnostics.includes('css.accepted_rule_limit'));
});
