import test from "node:test";
import assert from "node:assert/strict";
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
