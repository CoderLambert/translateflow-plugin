import test from "node:test";
import assert from "node:assert/strict";
import { createTranslationUnitV1 } from "../src/shared/translation-source.js";

const text = "It is important to understand that useMemo does not prevent re-rendering.";
const rich = {
  text: "It is important to understand that ⟦TF:0:S⟧useMemo⟦TF:0:E⟧ does not prevent re-rendering.",
  rich: true,
  descriptors: [{ tag: "code", protectedText: "useMemo" }]
};

test("plain and rich expose identical semantic identity, distinct format identity and untouched Provider text", () => {
  const plainUnit = createTranslationUnitV1({ text, rich: false, descriptors: [] });
  const richUnit = createTranslationUnitV1(rich);
  assert.equal(plainUnit.semanticText, richUnit.semanticText);
  assert.equal(plainUnit.semanticIdentity, richUnit.semanticIdentity);
  assert.notEqual(plainUnit.formatIdentity, richUnit.formatIdentity);
  assert.equal(richUnit.providerText, rich.text);
  assert.equal(richUnit.protectedSpans[0].text, "useMemo");
  assert.equal(richUnit.semanticText.slice(richUnit.protectedSpans[0].start, richUnit.protectedSpans[0].end), "useMemo");
  assert.equal(plainUnit.providerText, text);
});

test("descriptors preserve ordered code/kbd with strong and trusted source link metadata", () => {
  const unit = createTranslationUnitV1({
    text: "Press ⟦TF:0:S⟧Ctrl⟦TF:0:E⟧ and ⟦TF:1:S⟧useMemo⟦TF:1:E⟧; then read ⟦TF:2:S⟧⟦TF:3:S⟧docs⟦TF:3:E⟧⟦TF:2:E⟧.",
    rich: true,
    descriptors: [
      { tag: "kbd", protectedText: "Ctrl" },
      { tag: "code", protectedText: "useMemo" },
      { tag: "strong" },
      { tag: "a", href: "https://example.test/help", title: "Help", onclick: "not copied" }
    ]
  });
  assert.equal(unit.semanticText, "Press Ctrl and useMemo; then read docs.");
  assert.deepEqual(unit.protectedSpans.map((span) => unit.semanticText.slice(span.start, span.end)), ["Ctrl", "useMemo"]);
  assert.equal(unit.descriptors[3].href, "https://example.test/help");
  assert.equal(Object.hasOwn(unit.descriptors[3], "onclick"), false);
  assert.ok(Object.isFrozen(unit.descriptors[3]));
});

test("repeated technical tokens remain distinct protected spans", () => {
  const unit = createTranslationUnitV1({
    text: "⟦TF:0:S⟧useMemo⟦TF:0:E⟧ and ⟦TF:1:S⟧useMemo⟦TF:1:E⟧",
    rich: true,
    descriptors: [{ tag: "code", protectedText: "useMemo" }, { tag: "code", protectedText: "useMemo" }]
  });
  assert.deepEqual(unit.protectedSpans.map((p) => [p.start,p.end]), [[0,7],[12,19]]);
});

test("plain literal marker-like user text is preserved, structured collisions are rejected", () => {
  const plain = createTranslationUnitV1({ text: "Literal ⟦TF:0:S⟧ should survive", rich: false });
  assert.equal(plain.semanticText, "Literal ⟦TF:0:S⟧ should survive");
  assert.throws(() => createTranslationUnitV1({ ...rich, text: "Literal ⟦TF:0:S⟧ " + rich.text }), /duplicate|ambiguous|incomplete/);
});

test("unknown, missing, duplicated, crossed or forged markers fail closed", () => {
  const invalid = [
    rich.text.replace("⟦TF:0:E⟧", ""),
    rich.text.replace("⟦TF:0:E⟧", "⟦TF:0:E⟧⟦TF:0:E⟧"),
    rich.text.replace("⟦TF:0:E⟧", "⟦TF:1:E⟧"),
    rich.text.replace("⟦TF:0:S⟧", "⟦TF:0:X⟧"),
    rich.text.replace("useMemo", "fakeUseMemo")
  ];
  for (const providerText of invalid) {
    assert.throws(() => createTranslationUnitV1({ ...rich, text: providerText }), TypeError);
  }
  assert.throws(() => createTranslationUnitV1({ text: "hi", rich: false, descriptors: [{tag:"code"}] }), TypeError);
});

test("semantic normalization only affects comparison, not Provider payload", () => {
  const original = "  It\t is  important\n";
  const unit = createTranslationUnitV1({ text: original, rich: false });
  assert.equal(unit.providerText, original);
  assert.equal(unit.semanticText, "It is important");
});
