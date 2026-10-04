import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { zh_CN as optionsZhCN } from "../src/i18n/catalog-options.js";

const html = await readFile(new URL("../options.html", import.meta.url), "utf8");
const css = await readFile(new URL("../options.css", import.meta.url), "utf8");
const app = await readFile(new URL("../src/options/App.tsx", import.meta.url), "utf8");
const common = await readFile(new URL("../src/options/CommonSections.tsx", import.meta.url), "utf8");
const sites = await readFile(new URL("../src/options/SiteSections.tsx", import.meta.url), "utf8");
const cache = await readFile(new URL("../src/options/CacheSection.tsx", import.meta.url), "utf8");
const glossary = await readFile(new URL("../src/options/GlossarySection.tsx", import.meta.url), "utf8");
const dictionaries = await readFile(new URL("../src/options/DictionarySection.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../src/options/client.ts", import.meta.url), "utf8");
const js = [app, common, sites, cache, glossary, dictionaries, client].join("\n");

test("Settings exposes the task-oriented information architecture including automatic site behavior", () => {
  for (const id of ["general","appearance","youtube","sites","auto-sites","glossary","provider","cache","developer"]) {
    assert.match(js + html, new RegExp(`(?:id=["']${id}["']|["']${id}["'])`));
  }
  assert.ok(app.indexOf("<GeneralSection") < app.indexOf("<ProviderSections"), "General must precede Provider");
  assert.ok(app.indexOf("<YoutubeSection") < app.indexOf("<ProviderSections"), "YouTube must be user-facing");
});

test("Settings preserves finalized controls and automatic cache restore management", () => {
  for (const id of ["defaultProvider","prompt","targetLanguage","defaultAppearance","deepseekApiKey","openaiBaseUrl","openaiStreaming","siteOrigin","glossaryScope","cacheMaxMB","youtubeSubtitleMode","youtubeSubtitleSize","cacheRestoreSitesList"]) {
    assert.match(js + html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(common, /options\.shortcuts\.summary/);
  assert.match(optionsZhCN["options.shortcuts.summary"], /chrome:\/\/extensions\/shortcuts/);
  assert.match(js, /youtubeSubtitleMode/);
  assert.match(js, /openaiStreaming/);
  assert.match(js, /youtubeSubtitleSize/);
  assert.match(js, /cacheRestoreSites/);
  assert.match(js, /api\.storage\.local\.get/);
  assert.match(js, /api\.storage\.local\.set/);
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
  assert.match(app, /data-settings-nav/);
  assert.match(app, /aria-current=/);
  assert.match(css, /a\[aria-current="page"\]/);
  assert.match(css, /a:hover/);
  assert.match(css, /:focus-visible/);
  assert.match(app, /setActiveHash/);
});

test("Provider and cache destructive controls remain visually distinct without harsh styling", () => {
  assert.match(common, /id="provider" className="advanced"/);
  assert.match(cache, /id="cache" className="advanced destructive-zone"/);
  assert.match(css, /\.advanced[\s\S]*var\(--tf-green/);
  assert.match(css, /\.destructive-zone[\s\S]*var\(--tf-danger/);
});

// Exact-head CI marker for #50 redesign.
