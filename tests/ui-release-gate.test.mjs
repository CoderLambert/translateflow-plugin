import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const popupCss = await readFile(new URL("../popup.css", import.meta.url), "utf8");
const optionsHtml = await readFile(new URL("../options.html", import.meta.url), "utf8");
const optionsCss = await readFile(new URL("../options.css", import.meta.url), "utf8");
const contentTokens = await readFile(new URL("../src/content/ui/tokens.js", import.meta.url), "utf8");
const quickStyles = await readFile(new URL("../src/content/ui/quick-control-styles.js", import.meta.url), "utf8");

test("redesigned extension surfaces keep visible keyboard focus and reduced-motion contracts", () => {
  assert.match(popupCss, /:focus-visible/);
  assert.match(optionsCss, /:focus-visible/);
  assert.match(popupCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(optionsCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(contentTokens, /prefers-reduced-motion:\s*reduce/);
  assert.match(quickStyles, /prefers-reduced-motion:\s*reduce/);
});

test("Popup advertises a stable intrinsic width and keeps advanced controls collapsed by default", () => {
  assert.match(popupCss, /width:\s*360px/);
  assert.match(popupCss, /min-width:\s*360px/);
  assert.doesNotMatch(popupCss, /max-width:\s*100vw/);
  assert.match(popupCss, /overflow-x:\s*hidden/);
  assert.equal((popupHtml.match(/<details class="secondary-card tf-accordion">/g) || []).length, 2);
  assert.doesNotMatch(popupHtml, /<details[^>]*\sopen[\s>]/);
  assert.equal((popupHtml.match(/tf-button--primary/g) || []).length, 1);
});

test("Settings keeps bounded desktop content and responsive mobile behavior", () => {
  assert.match(optionsCss, /grid-template-columns:\s*240px minmax\(0, 900px\)/);
  assert.match(optionsCss, /max-width:\s*900px/);
  assert.match(optionsCss, /@media \(max-width:\s*760px\)/);
  assert.match(optionsHtml, /aria-current="page"/);
  assert.match(optionsHtml, /id="cacheRestoreSitesList"/);
});

test("migrated UI surfaces do not restore the legacy saturated blue accent", () => {
  const combined = [popupCss, optionsCss, contentTokens, quickStyles].join("\n");
  assert.doesNotMatch(combined, /#1769aa|#2878d0|#58a6ff|#7ab8ff/i);
});

// Exact-head certification marker.
