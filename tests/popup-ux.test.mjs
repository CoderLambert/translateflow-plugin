import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const css = await readFile(new URL("../popup.css", import.meta.url), "utf8");
const script = await readFile(new URL("../popup.js", import.meta.url), "utf8");
const appearance = await readFile(new URL("../popup-appearance.js", import.meta.url), "utf8");

test("popup keeps a 360px calm control-center shell with one primary action", () => {
  assert.match(css, /width:\s*360px/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(html, /id="translate" class="tf-button tf-button--primary primary-action"/);
  assert.equal((html.match(/tf-button--primary/g) || []).length, 1);
  assert.match(html, /TranslateFlow/);
  assert.match(html, /ready-badge/);
});

test("popup keeps current-page context, reading appearance and cache restore controls", () => {
  assert.match(html, /id="effectiveContext" class="page-card"/);
  assert.match(html, /id="contextSite"/);
  assert.match(html, /id="contextProvider"/);
  assert.match(html, /id="contextModel"/);
  assert.match(html, /for="appearanceSelect"/);
  assert.match(html, /id="cacheRestoreSite"/);
  assert.match(html, /id="cacheRestoreInfo"/);
  assert.match(html, /<details class="secondary-card tf-accordion">[\s\S]*id="clearCache"/);
});

test("automatic translation is exposed as an accessible switch treatment", () => {
  assert.match(html, /id="autoSite" class="toggle-button" role="switch" aria-checked="false"/);
  assert.match(script, /autoBtn\.setAttribute\("aria-checked"/);
  assert.match(css, /toggle-button\[aria-checked="true"\]/);
});

test("popup keeps advanced controls collapsed by default and keyboard focus visible", () => {
  assert.equal((html.match(/<details class="secondary-card tf-accordion">/g) || []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*\sopen[\s>]/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /#2878d0|#7ab8ff/i);
});

test("appearance control preserves site profile fields and supports default inheritance", () => {
  assert.match(appearance, /TRANSLATION_APPEARANCES/);
  assert.match(appearance, /const nextProfile = \{ \.\.\.current \}/);
  assert.match(appearance, /delete nextProfile\.appearance/);
  assert.match(appearance, /chrome\.storage\.local\.set\(\{ siteProfiles: nextProfiles \}\)/);
});
