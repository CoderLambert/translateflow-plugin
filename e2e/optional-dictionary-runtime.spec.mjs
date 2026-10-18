import { test, expect } from "./support/extension-fixture.mjs";
import { webcrypto } from "node:crypto";
import { buildLocalIndexedTflex } from "../src/background/packs/importers/tflex-local-builder.js";
import { DICTIONARY_CATALOG_V2 } from "../src/shared/dictionary-catalog-v2.js";

test.use({ lexiconPacks: "missing" });

test("recommended dictionaries are optional and a locally installed structured dictionary works independently", async ({ harness }, info) => {
  test.setTimeout(60_000);
  await harness.reset();
  const externalRequests = [];
  const observe = request => {
    if (/^https?:/u.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) externalRequests.push(new URL(request.url()).origin);
  };
  harness.context.on("request", observe);
  const empty = await harness.runtime({ type: "LEXICAL_LOOKUP", text: "localfixtureword" });
  expect(empty.status).toBe("no-hit");
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  // Catalog entries are choices, never required installations or auto-downloads.
  expect(DICTIONARY_CATALOG_V2).toHaveLength(2);
  await expect(options.locator("#curatedDictionaryList .site-row")).toHaveCount(2);
  await expect(options.locator("#dictionaryBuiltInHeading")).toHaveCount(0);
  expect(harness.server.calls).toHaveLength(0);
  const pack = await buildLocalIndexedTflex({ packId: "local-independent-fixture", packVersion: "1",
    records: [{ lookupKey: "localfixtureword", exactLookupKeys: ["localfixtureword"], displayForm: "localfixtureword",
      kind: "lexical", aliases: [], senses: [{ id: "local:1", translations: ["独立安装的本地释义"],
        domains: [], sourceRefs: [{ sourceId: "synthetic", recordId: "1" }] }] }],
    sources: [{ id: "synthetic", version: "1", provenance: "Synthetic local E2E fixture" }],
    sourceEntryCount: 1, cryptoProvider: webcrypto });
  await options.locator("#localDictionaryFiles").setInputFiles(Object.entries(pack.files).map(([name, bytes]) => ({
    name, mimeType: "application/octet-stream", buffer: Buffer.from(bytes)
  })));
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("TFLex");
  await options.locator("#localDictionaryLimitationsConfirmation").check();
  await options.locator("#localDictionaryImportButton").click();
  await expect(options.locator("#installedDictionaryList")).toContainText("local-independent-fixture");
  const page = await harness.open("/selection");
  await page.evaluate(() => {
    const node = document.createElement("p"); node.id = "localfixtureword"; node.textContent = node.id; document.body.prepend(node);
  });
  await harness.inject(page);
  await page.locator("#localfixtureword").evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator(".tf-selection-chip").click();
  await expect(page.locator(".tf-selection-primary")).toContainText("独立安装的本地释义");
  expect(externalRequests).toEqual([]);
  harness.context.off("request", observe);
  for (const action of ["understand", "analyze", "usage"]) await expect(page.locator(`#tf-selection-tab-${action}`)).toBeEnabled();
  expect(harness.server.calls).toHaveLength(0);
  await page.screenshot({ path: info.outputPath("independent-structured-dictionary.png") });
  await harness.setStorage({ provider: "deepseek", apiKey: "", providerConnections: {}, providerCredentials: {}, defaultService: null,
    aiServiceConfigured: null, openAICompatible: { apiKey: "", baseUrl: "", model: "" }, browserTranslationEnabled: true });
  await page.locator("#tf-selection-tab-understand").click();
  await expect(page.locator("#tf-selection-panel-understand .tf-selection-ai-detail")).toHaveAttribute("data-state", "interrupted");
  await expect(page.locator("#tf-selection-panel-understand")).toContainText("需要配置 AI");
  expect(harness.server.calls).toHaveLength(0);
  await page.locator("#tf-selection-tab-dictionary").click();
  await expect(page.locator(".tf-selection-primary")).toContainText("独立安装的本地释义");
});
