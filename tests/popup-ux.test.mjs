import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const css = await readFile(new URL("../popup.css", import.meta.url), "utf8");
const appearance = await readFile(new URL("../popup-appearance.js", import.meta.url), "utf8");

test("popup keeps one obvious primary translation action and demotes maintenance controls", () => {
  assert.match(html, /id="translate" class="primary"/);
  assert.match(html, /<details class="secondary-card">[\s\S]*id="clearCache"/);
  assert.match(html, /id="settings" class="icon-btn"/);
  assert.doesNotMatch(html, /<script type="module">/);
});

test("popup exposes accessible page preferences and reading appearance", () => {
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /for="appearanceSelect"/);
  assert.match(html, /id="appearanceSelect" aria-label="本站阅读外观"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /overflow-x: hidden/);
});

test("appearance control preserves site profile fields and supports default inheritance", () => {
  assert.match(appearance, /TRANSLATION_APPEARANCES/);
  assert.match(appearance, /const nextProfile = \{ \.\.\.current \}/);
  assert.match(appearance, /delete nextProfile\.appearance/);
  assert.match(appearance, /chrome\.storage\.local\.set\(\{ siteProfiles: nextProfiles \}\)/);
});
