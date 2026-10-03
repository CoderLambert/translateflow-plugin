import { test, expect, chromium } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startMockServer } from "./support/mock-server.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";
import { compileTflexTechnical } from "../scripts/build-tflex-technical.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { defaultArtifact } from "./support/production-artifact.mjs";

// Actual selected production background/repository and shipped collector/UI. The fixed LC HTML is an
// explicitly synthetic #235 consent callback, not a production learning-center product claim.
const root = resolve(import.meta.dirname, ".."), artifact = defaultArtifact;
let temporary, context, worker, driver, center, server, extensionId, extension;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function inventory(path, prefix = "") {
  const items = [];
  for (const entry of await readdir(join(path, prefix), { withFileTypes: true })) {
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) items.push(...await inventory(path, file));
    else { const bytes = await readFile(join(path, file)); items.push({ file, size: bytes.length, sha256: hash(bytes) }); }
  }
  return items.sort((a, b) => a.file.localeCompare(b.file));
}
const message = (method, body = {}) => center.evaluate((request) => chrome.runtime.sendMessage(request), { protocolVersion: 2, method, ...body });
async function records() { const result = await message(M.LIST_RECORDS, { pageKey: null, query: "", cursor: null, limit: 100 }); expect(result.ok).toBe(true); return result.data.items; }
async function enable(enabled = true) {
  const state = await message(M.GET_RECORDING_STATE);
  const reply = await message(M.SET_RECORDING, { enabled, expectedConsentGeneration: state.data.consentGeneration }); expect(reply.ok).toBe(true);
}
async function open(html = '<main><p id="first">PUBLIC session alpha session tail</p><p id="sentence">This is a synthetic ordinary sentence.</p><p id="miss">zzsyntheticmissing</p></main>') {
  const page = await context.newPage(); await page.goto(`${server.baseUrl}/article`);
  const title = `Synthetic Selection Reading ${crypto.randomUUID()}`;
  await page.evaluate(({ html, title }) => { document.title = title; document.body.innerHTML = html; }, { html, title });
  const tabId = await driver.evaluate(async (title) => (await chrome.tabs.query({})).find((tab) => tab.title === title).id, title);
  await driver.evaluate(async ({ tabId, files, styles }) => {
    await chrome.scripting.insertCSS({ target: { tabId }, files: styles });
    await chrome.scripting.executeScript({ target: { tabId }, files });
  }, { tabId, files: [...CONTENT_SCRIPT_FILES], styles: [...CONTENT_STYLE_FILES] });
  return { page, tabId };
}
async function inspect(content, command, body = {}) {
  return driver.evaluate(async ({ tabId, command, body }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [command, body], func: async (command, body) => {
      const modules = globalThis.__TRANSLATE_FLOW_CONTENT__.modules;
      if (command === "source") return modules.selectionController.getQuerySource()?.ready || null;
      if (command === "focus") { window.dispatchEvent(new Event("focus")); return true; }
      if (command === "forged") return modules.readingAccessCollector.read({ nonce: "synthetic-forged", action: "begin", recordId: null, operationId: "not-owned" });
      if (command === "method") return chrome.runtime.sendMessage({ protocolVersion: 2, method: body.method, ...body.fields });
      if (command === "trace") return { trace: globalThis.__readingTrace || [], panel: modules.uiHost.getShadowRoot().querySelector(".tf-selection-panel")?.outerHTML,
        source: Boolean(modules.selectionController.getQuerySource()), model: typeof modules.selectionResultModel.readingDictionary };
      if (command === "trace-install") {
        globalThis.__readingTrace = [];
        const mutation = modules.textProjectionPolicy.sourceMutation;
        modules.textProjectionPolicy.sourceMutation = (record) => {
          const invalidates = mutation(record);
          if (invalidates) __readingTrace.push({ mutation: record.type, target: record.target.nodeName, attribute: record.attributeName });
          return invalidates;
        };
        const hide = modules.selectionPopover.hide;
        modules.selectionPopover.hide = (...args) => { __readingTrace.push({ hide: new Error().stack }); return hide(...args); };
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = (request, callback) => send(request, (response) => {
          if (request.method?.startsWith("reading.") || request.type?.startsWith("SELECTION_")) globalThis.__readingTrace.push({ method: request.method, type: request.type, operationId: request.operationId || request.token?.operationId, artifactId: request.artifact?.artifactId, response });
          callback?.(response);
        });
        return true;
      }
    } }); return result.result;
  }, { tabId: content.tabId, command, body });
}
async function select(content, selector, text, occurrence = 0) {
  await content.page.evaluate(({ selector, text, occurrence }) => {
    const node = document.querySelector(selector).firstChild;
    let offset = -1; for (let i = 0; i <= occurrence; i++) offset = node.nodeValue.indexOf(text, offset + 1);
    const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + text.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, { selector, text, occurrence });
  await expect(content.page.locator(".tf-selection-chip")).toBeVisible();
}
async function query(content, selector = "#first", text = "session", occurrence = 0) {
  await select(content, selector, text, occurrence);
  await content.page.locator(".tf-selection-chip").click();
}
const status = (content) => content.page.locator(".tf-selection-record-status");

test.describe("Selection → frozen trusted source → committed Reading records on actual production artifact", () => {
  test.setTimeout(60000);
  test.beforeAll(async () => {
    server = await startMockServer(); temporary = await mkdtemp(join(tmpdir(), "translateflow-selection-reading-")); extension = join(temporary, "extension");
    const production = await inventory(artifact); await cp(artifact, extension, { recursive: true });
    expect(await inventory(extension)).toEqual(production);
    const backgroundSha256 = hash(await readFile(join(extension, "background.js")));
    await mkdir(join(extension, "assets/lexicon"), { recursive: true });
    await cp(join(root, "tests/fixtures/tflex-runtime-pack"), join(extension, "assets/lexicon/core"), { recursive: true });
    await compileTflexTechnical({ extractPath: join(root, "lexicon/sources/wikidata-tech-entities.json"),
      sourceLockPath: join(root, "lexicon/source-locks/technical-wikidata.json"), outDir: join(extension, "assets/lexicon/technical") });
    await writeFile(join(extension, "learning-center.html"), '<!doctype html><title>Synthetic consent callback for #234; not #235 UI</title>');
    const manifest = JSON.parse(await readFile(join(extension, "manifest.json"), "utf8"));
    manifest.host_permissions.push("http://127.0.0.1/*"); await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
    expect(hash(await readFile(join(extension, "background.js")))).toBe(backgroundSha256);
    context = await chromium.launchPersistentContext(join(temporary, "profile"), { headless: true, channel: "chromium",
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"); extensionId = new URL(worker.url()).host;
    driver = await context.newPage(); await driver.goto(`chrome-extension://${extensionId}/popup.html`);
    center = await context.newPage(); await center.goto(`chrome-extension://${extensionId}/learning-center.html`);
    await writeFile(test.info().outputPath("selection-reading-package.json"), JSON.stringify({ production, backgroundSha256, artifactPath: artifact,
      productionCopyExactBeforeFixtures: true, backgroundUnchanged: true, browser: context.browser().version(),
      fixtureChanges: ["synthetic Core and existing local Technical fixture", "fixed synthetic LC HTML", "localhost test permission"], paidProviderCalls: 0 }, null, 2));
  });
  test.afterAll(async () => { await context?.close(); await server?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); });
  test.beforeEach(async () => {
    for (const page of context.pages()) if (page !== center && page !== driver) await page.close();
    server.reset();
    await driver.evaluate(async ({ baseUrl }) => {
      await chrome.runtime.sendMessage({ type: "CACHE_CLEAR_ALL" }); await chrome.storage.local.clear();
      await chrome.storage.local.set({ provider: "openai-compatible", targetLanguage: "Simplified Chinese", prompt: "Translate the segments and return JSON only.",
        selectionExplanationDepth: "standard", appearance: "standard", glossary: { version: 1, entries: [] }, siteGlossaries: { version: 1, sites: {} },
        openAICompatible: { baseUrl: `${baseUrl}/v1`, apiKey: "", model: "mock-model" }, autoSites: [], cacheRestoreSites: [], siteProfiles: {} });
    }, { baseUrl: server.baseUrl });
    const state = await message(M.GET_RECORDING_STATE);
    expect((await message(M.CLEAR_RECORDS, { expectedDataGeneration: state.data.dataGeneration })).ok).toBe(true);
    await enable(false);
    // Only a known test origin is managed; no production browsing state is touched.
    const site = await message(M.GET_SITE_RECORDING, { siteKey: server.baseUrl });
    expect((await message(M.SET_SITE_RECORDING, { siteKey: server.baseUrl, excluded: false, expectedSitePolicyRevision: site.data.sitePolicyRevision })).ok).toBe(true);
  });

  test("chip never writes; native current-card consent return saves once and blur preserves frozen source", async () => {
    const content = await open(); await inspect(content, "trace-install");
    await select(content, "#first", "session"); expect(await records()).toHaveLength(0); expect(server.calls).toHaveLength(0);
    expect(await inspect(content, "forged")).toBeNull();
    await content.page.locator(".tf-selection-chip").click();
    try { await expect(status(content)).toHaveAttribute("data-state", "invite"); }
    catch (error) { console.log("SYNTHETIC_READING_TRACE", JSON.stringify(await inspect(content, "trace"))); throw error; }
    expect(await records()).toHaveLength(0);
    const frozen = await inspect(content, "source");
    await center.bringToFront(); await enable(); await content.page.bringToFront(); await inspect(content, "focus");
    await expect(status(content)).toHaveAttribute("data-state", "manual"); expect(await records()).toHaveLength(0);
    expect(await inspect(content, "source")).toEqual(frozen);
    await status(content).getByRole("button", { name: "保存本次结果" }).click();
    await expect(status(content)).toHaveAttribute("data-state", "saved");
    const list = await records(); expect(list).toHaveLength(1);
    const detail = await message(M.GET_RECORD, { recordId: list[0].recordId });
    expect(detail.data.snapshots[0]).toEqual(frozen); expect(detail.data.record.lookupCount).toBe(1);
    expect(detail.data.artifacts[0].payload.definitions).toEqual(["会话"]);
    expect(server.calls).toHaveLength(0);
    const { trace } = await inspect(content, "trace"); expect(trace.filter((r) => r.method === M.BEGIN_QUERY)).toHaveLength(1);
    expect(trace.some((r) => r.method === M.SET_RECORDING)).toBe(false);
    try { await expect(status(content)).toHaveAttribute("data-state", "saved"); }
    catch (error) {
      const state = await inspect(content, "trace");
      await writeFile(test.info().outputPath("synthetic-final-state-failure.json"), JSON.stringify(state, null, 2));
      await content.page.screenshot({ path: test.info().outputPath("synthetic-final-state-failure.png") });
      console.log("SYNTHETIC_FINAL_READING_TRACE", JSON.stringify(state)); throw error;
    }
    await content.page.screenshot({ path: test.info().outputPath("synthetic-saved-card.png") });
    await expect(status(content)).toHaveAttribute("data-state", "saved");
  });

  test("same word at distinct Ranges has distinct source; same-location explicit requery counts once per operation", async () => {
    await enable(); const content = await open(); await query(content);
    await expect(status(content)).toHaveAttribute("data-state", "saved"); const first = await inspect(content, "source");
    // Same Range events preserve the card and do not perform another query.
    await content.page.evaluate(() => document.dispatchEvent(new Event("selectionchange")));
    expect((await records())[0].lookupCount).toBe(1);
    await content.page.getByRole("button", { name: "关闭", exact: true }).click();
    await query(content); await expect(status(content)).toHaveAttribute("data-state", "saved");
    const once = await records(); expect(once).toHaveLength(1); expect(once[0].lookupCount).toBe(2);
    await query(content, "#first", "session", 1); await expect(status(content)).toHaveAttribute("data-state", "saved");
    const second = await inspect(content, "source"); expect(second.selectionGeneration).toBeGreaterThan(first.selectionGeneration);
    expect(second.anchor.position).not.toEqual(first.anchor.position); expect(second.contextText).toEqual(first.contextText);
    expect(await records()).toHaveLength(2); expect(server.calls).toHaveLength(0);
  });

  test("real no-hit, ordinary translation/cache and completed Explain read back without history-triggered Provider", async () => {
    await enable(); const content = await open(); await query(content, "#miss", "zzsyntheticmissing");
    await expect(status(content)).toHaveAttribute("data-state", "saved");
    let list = await records(); let detail = await message(M.GET_RECORD, { recordId: list[0].recordId });
    expect(detail.data.artifacts[0].payload.outcome).toBe("no-hit"); expect(server.calls).toHaveLength(0);
    await query(content, "#sentence", "This is a synthetic ordinary sentence."); await expect(status(content)).toHaveAttribute("data-state", "saved");
    expect(server.calls).toHaveLength(1);
    await content.page.getByRole("button", { name: "关闭", exact: true }).click();
    await query(content, "#sentence", "This is a synthetic ordinary sentence."); await expect(status(content)).toHaveAttribute("data-state", "saved");
    expect(server.calls).toHaveLength(1); list = await records();
    const translated = list.find((value) => value.itemText.startsWith("This is")); expect(translated.lookupCount).toBe(2);
    detail = await message(M.GET_RECORD, { recordId: translated.recordId }); expect(detail.data.artifacts.map((a) => a.kind)).toEqual(["translation", "translation"]);
    await query(content); await expect(status(content)).toHaveAttribute("data-state", "saved");
    await content.page.getByRole("button", { name: "使用 AI 结合上下文详解" }).click();
    await expect(content.page.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
    await expect(status(content)).toHaveAttribute("data-state", "saved");
    expect(server.calls).toHaveLength(2); expect(JSON.parse(server.calls[1].userContent).userQuestion).toBe("这里是什么意思？");
    list = await records(); const lexical = list.find((value) => value.itemText === "session");
    detail = await message(M.GET_RECORD, { recordId: lexical.recordId }); expect(detail.data.record.lookupCount).toBe(1);
    const assistant = detail.data.artifacts.find((a) => a.kind === "assistant"); expect(assistant.payload.userQuestion).toBe("这里是什么意思？");
    expect(assistant.payload.assistantAnswer).toContain(await content.page.locator(".tf-selection-generated-body").innerText());
    expect(assistant.provenance.model).toBe("mock-model"); expect(assistant.provenance.promptVersion).toBe("selection-explain-reading-v2");
    expect(JSON.stringify(assistant.provenance)).not.toContain("127.0.0.1");
    await message(M.GET_RECORD, { recordId: lexical.recordId }); expect(server.calls).toHaveLength(2);
  });

  test("close/navigation during consent discards temporary result, decline and excluded site remain local", async () => {
    const content = await open(); await query(content); await expect(status(content)).toHaveAttribute("data-state", "invite");
    await status(content).getByRole("button", { name: "暂不", exact: true }).click(); await expect(status(content)).toHaveAttribute("data-state", "disabled");
    await query(content, "#first", "session", 1); await expect(status(content)).toHaveAttribute("data-state", "disabled");
    await content.page.getByRole("button", { name: "关闭", exact: true }).click(); await enable(); await inspect(content, "focus");
    await expect(content.page.locator(".tf-selection-panel")).toHaveCount(0); expect(await records()).toHaveLength(0);
    await enable(false); const other = await open(); await query(other); await expect(status(other)).toHaveAttribute("data-state", "invite");
    await other.page.evaluate(() => { history.pushState({}, "", "/article#new-source"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await expect(other.page.locator(".tf-selection-panel")).toHaveCount(0); await enable(); expect(await records()).toHaveLength(0);
    const site = await message(M.GET_SITE_RECORDING, { siteKey: server.baseUrl });
    await message(M.SET_SITE_RECORDING, { siteKey: server.baseUrl, excluded: true, expectedSitePolicyRevision: site.data.sitePolicyRevision });
    const excluded = await open(); await query(excluded); await expect(status(excluded)).toHaveAttribute("data-state", "disabled");
    expect(await records()).toHaveLength(0); expect(server.calls).toHaveLength(0);
  });

  test("actual native transaction abort retries storage only; pause-before-write rejects late completion", async () => {
    await enable(); const content = await open();
    await worker.evaluate(() => {
      globalThis.__234Put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) { const request = arguments.length > 1 ? __234Put.call(this, value, key) : __234Put.call(this, value);
        if (this.name === "records") this.transaction.abort(); return request; };
    });
    await query(content); await expect(status(content)).toHaveAttribute("data-state", "not-saved"); expect(await records()).toHaveLength(0);
    await worker.evaluate(() => { IDBObjectStore.prototype.put = __234Put; });
    await status(content).getByRole("button", { name: "重试保存" }).click(); await expect(status(content)).toHaveAttribute("data-state", "saved");
    expect(await records()).toHaveLength(1); expect(server.calls).toHaveLength(0);
    await worker.evaluate(() => {
      globalThis.__234Digest = SubtleCrypto.prototype.digest; globalThis.__234Entered = false;
      globalThis.__234Gate = new Promise((resolve) => { globalThis.__234Release = resolve; });
      SubtleCrypto.prototype.digest = async function(algorithm, bytes) {
        if (new TextDecoder().decode(bytes).includes('"outcome":"no-hit"')) { __234Entered = true; await __234Gate; }
        return __234Digest.call(this, algorithm, bytes);
      };
    });
    await query(content, "#miss", "zzsyntheticmissing"); await expect.poll(() => worker.evaluate(() => __234Entered)).toBe(true);
    await enable(false); await worker.evaluate(() => { __234Release(); SubtleCrypto.prototype.digest = __234Digest; });
    await expect(status(content)).toHaveAttribute("data-state", "not-saved");
    expect(await records()).toHaveLength(1); expect(server.calls).toHaveLength(0);
  });

  test("pause while a card is closed and deletion revoke its committed location reference", async () => {
    await enable(); const content = await open(); await query(content);
    await expect(status(content)).toHaveAttribute("data-state", "saved"); const first = (await records())[0];
    await content.page.getByRole("button", { name: "关闭", exact: true }).click();
    await enable(false); await enable(); await query(content);
    await expect(status(content)).toHaveAttribute("data-state", "saved"); const list = await records();
    expect(list).toHaveLength(2); const second = list.find((item) => item.recordId !== first.recordId);
    expect(second.lookupCount).toBe(1); expect(first.lookupCount).toBe(1);
    const deleted = await message(M.DELETE_RECORD, { recordId: second.recordId, expectedRevision: second.revision });
    expect(deleted.ok).toBe(true); await expect(status(content)).toHaveAttribute("data-state", "not-saved");
    await content.page.getByRole("button", { name: "关闭", exact: true }).click(); await query(content);
    await expect(status(content)).toHaveAttribute("data-state", "saved");
    expect((await records()).some((item) => item.recordId === second.recordId)).toBe(false);
    expect(await records()).toHaveLength(2); expect(server.calls).toHaveLength(0);
  });

  test("real imported Rich display appends a bounded summary to its basic operation once", async () => {
    await enable(); const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html#dictionary-packs`);
    const fixture = makeRichMdx([["session", '<p>Synthetic Rich summary</p><script>PRIVATE_SCRIPT</script><img src="sound://private-resource.png">']]);
    await options.locator("#localDictionaryFiles").setInputFiles({ name: "synthetic-reading.mdx", mimeType: "application/octet-stream", buffer: fixture });
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("Rich MDX Fixture");
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 30000 });
    const content = await open(); await inspect(content, "trace-install"); await query(content);
    await expect(status(content)).toHaveAttribute("data-state", "saved");
    const rich = content.page.locator(".tf-selection-rich-record"); await expect(rich).toHaveCount(1);
    if (!await rich.evaluate((node) => node.open)) await rich.locator("summary").click();
    await expect(rich).toContainText("Synthetic Rich summary");
    await expect.poll(async () => (await records())[0].revision).toBe(2);
    const list = await records(), detail = await message(M.GET_RECORD, { recordId: list[0].recordId });
    expect(detail.data.record.lookupCount).toBe(1); expect(detail.data.artifacts).toHaveLength(2);
    expect(new Set(detail.data.artifacts.map((a) => a.operationId)).size).toBe(1);
    expect(new Set(detail.data.artifacts.map((a) => a.artifactId)).size).toBe(2);
    expect(detail.data.artifacts.some((a) => a.payload.definitions.includes("Synthetic Rich summary"))).toBe(true);
    const savedText = JSON.stringify(detail.data.artifacts);
    expect(savedText).not.toContain("PRIVATE_SCRIPT"); expect(savedText).not.toContain("private-resource"); expect(savedText).not.toContain("rawRecord");
    expect(server.calls).toHaveLength(0);
  });
});
