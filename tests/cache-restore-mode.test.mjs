import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BACKGROUND_MESSAGES, DEFAULT_CONFIG } from "../src/shared/constants.js";

const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const popupJs = await readFile(new URL("../popup.js", import.meta.url), "utf8");
const optionsHtml = await readFile(new URL("../options.html", import.meta.url), "utf8");
const optionsJs = await readFile(new URL("../options.js", import.meta.url), "utf8");
const autoSource = await readFile(new URL("../src/content/auto.js", import.meta.url), "utf8");

test("automatic cache restore has an explicit independent persisted mode", () => {
  assert.deepEqual(DEFAULT_CONFIG.cacheRestoreSites, []);
  assert.equal(BACKGROUND_MESSAGES.CACHE_RESTORE_SITE_REGISTER, "CACHE_RESTORE_SITE_REGISTER");
  assert.equal(BACKGROUND_MESSAGES.CACHE_RESTORE_SITE_UNREGISTER, "CACHE_RESTORE_SITE_UNREGISTER");
});

test("popup exposes per-site automatic cache restore separately from manual restore", () => {
  assert.match(popupHtml, /id="cacheRestoreSite"/);
  assert.match(popupHtml, /id="restore"/);
  assert.match(popupJs, /CACHE_RESTORE_SITE_REGISTER/);
  assert.match(popupJs, /CACHE_RESTORE_SITE_UNREGISTER/);
  assert.match(popupJs, /cacheRestoreSites/);
});

test("settings exposes persistent automatic cache restore sites and removal", () => {
  assert.match(optionsHtml, /id="cacheRestoreSitesList"/);
  assert.match(optionsHtml, /自动恢复缓存只读取 IndexedDB/);
  assert.match(optionsJs, /storageKey: "cacheRestoreSites"/);
  assert.match(optionsJs, /CACHE_RESTORE_SITE_UNREGISTER/);
});

test("restore-only incremental runtime structurally disables Provider work", () => {
  assert.match(autoSource, /const allowProvider = state\.auto/);
  assert.match(autoSource, /cacheOnly: !allowProvider/);
  assert.match(autoSource, /auto: allowProvider/);
  assert.match(autoSource, /state\.auto \|\| state\.cacheRestore/);
});
