import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { legalAssets, assertNoticeCoverage } from "../scripts/legal-assets.mjs";
import { LEGAL_ASSETS } from "../src/shared/runtime-assets.js";

test("bundled policy and notices match the reviewed documents and installed dependency versions", async () => {
  assert.deepEqual(await legalAssets(), Object.values(LEGAL_ASSETS));
  const notice = await readFile(new URL(`../${LEGAL_ASSETS.notices}`, import.meta.url), "utf8");
  assertNoticeCoverage([{ modules: ["/node_modules/react/index.js", "/node_modules/markdown-it/dist/index.mjs", "/src/app.js"] }], notice);
  assert.throws(() => assertNoticeCoverage([{ modules: ["/node_modules/unlisted-package/index.js"] }], notice), /lacks a license notice/u);
  for (const path of [LEGAL_ASSETS.privacyEn, LEGAL_ASSETS.privacyZh, LEGAL_ASSETS.support]) {
    const html = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const dom = new JSDOM(html);
    assert.equal(dom.window.document.querySelectorAll("script,iframe,img,link,form").length, 0);
    assert(dom.window.document.querySelector("h1")?.textContent.includes("TranslateFlow"));
    assert.equal(dom.window.document.querySelector('meta[name="referrer"]')?.content, "no-referrer");
    dom.window.close();
  }
});
