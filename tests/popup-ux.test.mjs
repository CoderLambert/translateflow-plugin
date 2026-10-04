import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const css = await readFile(new URL("../popup.css", import.meta.url), "utf8");
const script = await readFile(new URL("../src/popup/App.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../src/popup/client.ts", import.meta.url), "utf8");

test("popup keeps a 360px calm control-center shell with one primary action", () => {
  assert.match(css, /width:\s*360px/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(html, /id="root"/);
  assert.match(script, /id="translate" className="tf-button tf-button--primary primary-action"/);
  assert.equal((script.match(/tf-button--primary/g) || []).length, 1);
  assert.match(script, /TranslateFlow/);
  assert.match(script, /ready-badge/);
});

test("popup keeps current-page context, reading appearance and cache restore controls", () => {
  assert.match(script, /id="effectiveContext" className="page-card"/);
  for (const id of ["contextSite", "contextProvider", "contextModel", "appearanceSelect", "clearCache"]) assert.match(script, new RegExp(`id="${id}"`));
  assert.match(script, /id="cacheRestore"/);
});

test("automatic translation is exposed as an accessible switch treatment", () => {
  assert.match(script, /id="autoSite" className="toggle-button" role="switch" aria-checked=/);
  assert.match(css, /toggle-button\[aria-checked="true"\]/);
});

test("popup keeps advanced controls collapsed by default and keyboard focus visible", () => {
  assert.equal((script.match(/<details className="secondary-card tf-accordion">/g) || []).length, 2);
  assert.doesNotMatch(script, /<details[^>]*\sopen[\s>]/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /#2878d0|#7ab8ff/i);
});

test("appearance control preserves site profile fields and supports default inheritance", () => {
  assert.match(client, /TRANSLATION_APPEARANCES/);
  assert.match(client, /const nextProfile:[^=]+ = \{ \.\.\.objectRecord/);
  assert.match(client, /delete nextProfile\.appearance/);
  assert.match(client, /storage\.local\.set\(\{ siteProfiles \}\)/);
});
