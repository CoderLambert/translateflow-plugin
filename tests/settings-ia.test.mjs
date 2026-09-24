import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../options.html", import.meta.url), "utf8");
const js = await readFile(new URL("../options.js", import.meta.url), "utf8");

test("Settings exposes the v0.8 task-oriented information architecture", () => {
  for (const id of ["general","appearance","youtube","sites","glossary","provider","cache","developer"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(html, new RegExp(`href=["']#${id}["']`));
  }
  assert.ok(html.indexOf('id="general"') < html.indexOf('id="provider"'), "General must precede Provider");
  assert.ok(html.indexOf('id="youtube"') < html.indexOf('id="provider"'), "YouTube must be user-facing");
});

test("Settings preserves finalized controls and adds YouTube defaults without resetting storage", () => {
  for (const id of ["defaultProvider","prompt","targetLanguage","defaultAppearance","deepseekApiKey","openaiBaseUrl","siteOrigin","glossaryScope","cacheMaxMB","youtubeSubtitleMode","youtubeSubtitleSize"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /chrome:\/\/extensions\/shortcuts/);
  assert.match(js, /youtubeSubtitleMode/);
  assert.match(js, /youtubeSubtitleSize/);
  assert.match(js, /chrome\.storage\.local\.get/);
  assert.match(js, /chrome\.storage\.local\.set/);
});
