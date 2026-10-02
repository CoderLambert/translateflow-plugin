#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const experiment = resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("usage: node browser-smoke.mjs <experiment-dir>");
const { chromium } = await import(pathToFileURL(resolve(experiment, "node_modules/@playwright/test/index.mjs")));
const extension = resolve(experiment, ".output/chrome-mv3");
const profile = resolve(experiment, "profile-smoke");
await mkdir(profile, { recursive: true });
const oldManifest = JSON.parse(await readFile(resolve(experiment, "baseline-manifest.json"), "utf8"));
const newManifest = JSON.parse(await readFile(resolve(extension, "manifest.json"), "utf8"));
assert.deepEqual(newManifest, oldManifest);
const context = await chromium.launchPersistentContext(profile, {
  headless: true, channel: "chromium",
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
const failures = [];
const externalRequests = [];
context.on("request", (request) => {
  if (/^https?:/u.test(request.url())) externalRequests.push(new URL(request.url()).origin);
});
context.on("page", (page) => page.on("pageerror", (error) => failures.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10000 });
  const extensionId = new URL(worker.url()).host;
  const origin = `chrome-extension://${extensionId}`;
  const page = await context.newPage();
  await page.goto(`${origin}/popup.html`);
  assert.match(await page.title(), /TranslateFlow/u);
  const cache = await page.evaluate(() => chrome.runtime.sendMessage({ type: "CACHE_STATS" }));
  assert.equal(cache.ok, true);
  await page.goto(`${origin}/options.html`);
  assert.match(await page.title(), /TranslateFlow/u);
  const workers = ["curated-dictionary", "curated-ecdict-mdx", "mdict-import", "stardict-import", "rich-mdict-import", "mdd-resource-import"];
  const workerResults = await page.evaluate(async (names) => Promise.all(names.map((name) => new Promise((resolve, reject) => {
    const instance = new Worker(chrome.runtime.getURL(`src/options/workers/${name}-worker.js`), { type: "module" });
    const timeout = setTimeout(() => { instance.terminate(); reject(new Error(`Worker ${name} did not reject probe input`)); }, 10000);
    instance.onerror = (event) => { clearTimeout(timeout); instance.terminate(); reject(new Error(event.message)); };
    instance.onmessage = (event) => { clearTimeout(timeout); instance.terminate(); resolve({ name, type: event.data.type, requestId: event.data.requestId }); };
    instance.postMessage({ type: "PF00_UNKNOWN_MESSAGE", requestId: "pf00-synthetic-probe" });
  }))), workers);
  for (const result of workerResults) {
    const expectedType = result.name === "curated-dictionary" ? "CURATED_DICTIONARY_ERROR" : `${result.name}:error`;
    assert.equal(result.type, expectedType);
    assert.equal(result.requestId, "pf00-synthetic-probe");
  }
  await page.goto(`${origin}/platform-smoke.html`);
  await page.locator("#root p").waitFor();
  assert.equal(await page.locator("#root p").textContent(), "TranslateFlow platform smoke");
  const capabilities = await page.evaluate(() => ({
    opfs: typeof navigator.storage?.getDirectory === "function",
    decompression: typeof DecompressionStream === "function",
    structuredClone: typeof structuredClone === "function",
    storageSession: Boolean(chrome.storage.session),
    scripting: Boolean(chrome.scripting)
  }));
  assert.deepEqual(failures, []);
  assert.deepEqual(externalRequests, []);
  const report = { status: "PASS", browser: context.browser()?.version() || await page.evaluate(() => navigator.userAgent),
    extensionId, manifestEqual: true, popup: "PASS", options: "PASS", backgroundCacheStats: "PASS",
    workerInvalidInputResponses: workerResults, reactMount: "PASS", capabilities, pageErrors: failures, externalRequests,
    notRun: ["Chrome 102 runtime", "Content/MAIN integration", "same-ID upgrade/restart", "release lexicon", "real Provider"] };
  await writeFile(resolve(experiment, "logs/browser-smoke.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
}
