import test from "node:test";
import assert from "node:assert/strict";
import {
  APPEARANCE_VARIABLE_NAMES,
  DEFAULT_APPEARANCE_ID,
  TRANSLATION_APPEARANCES,
  getAppearance,
  normalizeAppearanceId,
  resolveAppearance
} from "../src/shared/appearance.js";

test("reading appearance exposes exactly four documented presets", () => {
  assert.equal(DEFAULT_APPEARANCE_ID, "standard");
  assert.deepEqual(
    TRANSLATION_APPEARANCES.map((item) => item.id),
    ["standard", "compact", "reading", "minimal"]
  );
  for (const appearance of TRANSLATION_APPEARANCES) {
    assert.ok(appearance.label);
    assert.ok(appearance.description);
    assert.deepEqual(Object.keys(appearance.variables).sort(), [...APPEARANCE_VARIABLE_NAMES].sort());
  }
});

test("appearance normalization is strict while resolution falls back to Standard", () => {
  assert.equal(normalizeAppearanceId(" Reading "), "reading");
  assert.equal(normalizeAppearanceId("unknown"), "");
  assert.equal(getAppearance("unknown").id, "standard");
  assert.equal(resolveAppearance("unknown").id, "standard");
});

test("site appearance overrides the default without changing the default value", () => {
  const inherited = resolveAppearance("compact");
  assert.equal(inherited.id, "compact");
  assert.equal(inherited.source, "default");

  const overridden = resolveAppearance("compact", "reading");
  assert.equal(overridden.id, "reading");
  assert.equal(overridden.source, "site");
  assert.notEqual(overridden.variables["--tf-translation-padding"], inherited.variables["--tf-translation-padding"]);
});

test("minimal and reading provide materially different presentation values", () => {
  const minimal = resolveAppearance("minimal");
  const reading = resolveAppearance("reading");
  assert.equal(minimal.variables["--tf-translation-border-width"], "0px");
  assert.equal(minimal.variables["--tf-translation-background"], "transparent");
  assert.notEqual(minimal.variables["--tf-translation-line-height"], reading.variables["--tf-translation-line-height"]);
  assert.notEqual(minimal.variables["--tf-translation-padding"], reading.variables["--tf-translation-padding"]);
});
