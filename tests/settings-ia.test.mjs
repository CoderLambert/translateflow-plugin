import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../options.html", import.meta.url), "utf8");
const css = await readFile(new URL("../options.css", import.meta.url), "utf8");
const js = await readFile(new URL("../options.js", import.meta.url), "utf8");

test("Settings exposes the task-oriented information architecture including automatic site behavior", () => {
  for (const id of ["general","appearance","youtube","sites","auto-sites","glossary","provider","cache","developer"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(html, new RegExp(`href=["']#${id}["']`));
  }
  assert.ok(html.indexOf('id="general"') < html.indexOf('id="provider"'), "General must precede Provider");
  assert.ok(html.indexOf('id="youtube"') < html.indexOf('id="provider"'), "YouTube must be user-facing");
});

test("Settings preserves finalized controls and automatic cache restore management", () => {
  for (const id of ["defaultProvider","prompt","targetLanguage","defaultAppearance","deepseekApiKey","openaiBaseUrl","openaiStreaming","siteOrigin","glossaryScope","cacheMaxMB","youtubeSubtitleMode","youtubeSubtitleSize","cacheRestoreSitesList"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /chrome:\/\/extensions\/shortcuts/);
  assert.match(js, /youtubeSubtitleMode/);
  assert.match(js, /openaiStreaming\.checked/);
  assert.match(js, /youtubeSubtitleSize/);
  assert.match(js, /cacheRestoreSites/);
  assert.match(js, /chrome\.storage\.local\.get/);
  assert.match(js, /chrome\.storage\.local\.set/);
});

test("Settings uses the calm responsive card layout and bounded content width", () => {
  assert.match(css, /grid-template-columns:\s*240px minmax\(0, 900px\)/);
  assert.match(css, /width:\s*min\(1240px/);
  assert.match(css, /max-width:\s*900px/);
  assert.match(css, /main > section\s*\{/);
  assert.match(css, /background:[\s\S]*var\(--tf-bg-app\)/);
  assert.match(css, /@media \(max-width:\s*760px\)/);
  assert.doesNotMatch(css, /rgba\(127,127,127/);
});

test("Settings navigation exposes current, hover and keyboard-focus states", () => {
  assert.match(html, /data-settings-nav href="#general" aria-current="page"/);
  assert.match(css, /a\[aria-current="page"\]/);
  assert.match(css, /a:hover/);
  assert.match(css, /:focus-visible/);
  assert.match(js, /setActiveSettingsNav/);
});

test("Provider and cache destructive controls remain visually distinct without harsh styling", () => {
  assert.match(html, /id="provider" class="advanced"/);
  assert.match(html, /id="cache" class="advanced destructive-zone"/);
  assert.match(css, /\.advanced[\s\S]*var\(--tf-green/);
  assert.match(css, /\.destructive-zone[\s\S]*var\(--tf-danger/);
});

// Exact-head CI marker for #50 redesign.
