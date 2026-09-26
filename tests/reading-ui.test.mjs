import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveAppearance } from "../src/shared/appearance.js";

const contentCss = await readFile(new URL("../content.css", import.meta.url), "utf8");
const toastSource = await readFile(new URL("../src/content/ui/toast.js", import.meta.url), "utf8");
const uiTokens = await readFile(new URL("../src/content/ui/tokens.js", import.meta.url), "utf8");
const appearanceSource = await readFile(new URL("../src/shared/appearance.js", import.meta.url), "utf8");

test("reading presets use the sage/beige visual language without the legacy blue accent", () => {
  const standard = resolveAppearance("standard");
  const compact = resolveAppearance("compact");
  const reading = resolveAppearance("reading");
  const minimal = resolveAppearance("minimal");

  assert.equal(standard.variables["--tf-translation-border-color"], "rgba(111, 150, 104, 0.34)");
  assert.equal(compact.variables["--tf-translation-border-width"], "1px");
  assert.equal(reading.variables["--tf-translation-background"], "rgba(246, 241, 232, 0.46)");
  assert.equal(minimal.variables["--tf-translation-background"], "transparent");
  assert.equal(minimal.variables["--tf-translation-border-width"], "0px");
  assert.doesNotMatch(appearanceSource, /34,\s*113,\s*177/);
});

test("translated paragraphs stay lightweight and inherit host typography", () => {
  assert.match(contentCss, /font:\s*inherit\s*!important/);
  assert.match(contentCss, /box-shadow:\s*none\s*!important/);
  assert.match(contentCss, /border-left:\s*var\(--tf-translation-border-width/);
  assert.match(contentCss, /rgba\(111,\s*150,\s*104,\s*0\.34\)/);
  assert.doesNotMatch(contentCss, /rgba\(34,\s*113,\s*177/);
});

test("toast feedback is compact and carries semantic text-independent cues", () => {
  assert.match(uiTokens, /max-width:\s*320px/);
  assert.match(uiTokens, /\.tf-toast-icon/);
  assert.match(uiTokens, /data-kind="error"/);
  assert.match(toastSource, /success:\s*"✓"/);
  assert.match(toastSource, /warning:\s*"!"/);
  assert.match(toastSource, /normalizedKind === "error" \? "assertive" : "polite"/);
  assert.match(toastSource, /tf-toast-message/);
});
