import { test, expect } from "./support/extension-fixture.mjs";
import { readFile } from "node:fs/promises";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { makeMdd } from "../tests/helpers/mdd-fixture.mjs";
import { makeMdx } from "../tests/helpers/mdict-fixture.mjs";
import { webcrypto } from "node:crypto";
import { buildLocalIndexedTflex } from "../src/background/packs/importers/tflex-local-builder.js";

const realMdxPath = process.env.TF_LOCAL_REAL_MDICT_MDX || "";
const realMddPath = process.env.TF_LOCAL_REAL_MDICT_MDD || "";

test.describe("unified local dictionary import v2", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("empty local dictionary preflight and confirmation labels are not visible", async ({ harness }, testInfo) => {
    const options = await harness.context.newPage();
    await options.setViewportSize({ width: 1100, height: 1000 });
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const card = options.locator("#localDictionaryImport");
    await expect(card).toBeVisible();
    await expect(options.locator("#localDictionaryPreflight")).toBeHidden();
    for (const selector of [
      "#localDictionarySemanticLabel",
      "#localDictionaryLimitationsLabel",
      "#localDictionaryDuplicateLabel"
    ]) {
      await expect(options.locator(selector)).toBeHidden();
    }
    await card.screenshot({ path: testInfo.outputPath("local-dictionary-preflight-empty.png") });
  });

  test("one picker safely installs Rich MDX with base and numbered MDD locally", async ({ harness }) => {
    const options = await harness.context.newPage();
    const externalRequests = [];
    options.on("request", (request) => {
      if (/^https?:/iu.test(request.url()) && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/iu.test(request.url())) {
        externalRequests.push(request.url());
      }
    });
    await options.setViewportSize({ width: 390, height: 844 });
    await options.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const mdx = makeRichMdx([
      ["unifiedrichfixture", "<p>本地富文本释义</p>"]
    ], { title: "Unified Rich Fixture", styleSheet: "" });
    const mdd = makeMdd([["\\media\\base.css", new TextEncoder().encode(".base { color: #123456; }")]]);
    const numberedMdd = makeMdd([["\\media\\numbered.css", new TextEncoder().encode(".numbered { color: #654321; }")]]);

    await options.locator("#localDictionaryFiles").setInputFiles([
      { name: "unified.mdx", mimeType: "application/octet-stream", buffer: mdx },
      { name: "unified.mdd", mimeType: "application/octet-stream", buffer: mdd },
      { name: "unified.1.mdd", mimeType: "application/octet-stream", buffer: numberedMdd }
    ]);
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("可用");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("MDX 富文本词典");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("unified.1.mdd");
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await options.locator("#localDictionaryChooseFiles").evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0s");

    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });
    const installed = options.locator("#richMdictInstalledList .site-row").filter({ hasText: "Unified Rich Fixture" });
    await expect(installed).toBeVisible();
    await expect(installed).toContainText("2 个 MDD 文件");
    await expect(installed).toContainText("本机源文件");
    await expect(installed).toContainText("unified.mdx");
    await expect(installed).toContainText("本机源文件大小");
    await expect(installed).toContainText("添加/替换 MDD 资源");
    const dictionaryId = await installed.getAttribute("data-dictionary-id");
    const activeRich = await options.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    expect(activeRich.ok).toBe(true);
    expect(activeRich.dictionaries.find((item) => item.id === dictionaryId)?.resourceCount).toBe(2);
    const resourceProbe = await harness.open("/selection");
    await harness.inject(resourceProbe);
    const baseResource = await readMddResource(harness, resourceProbe, dictionaryId, "media/base.css");
    const numberedResource = await readMddResource(harness, resourceProbe, dictionaryId, "media/numbered.css");
    expect(baseResource.ok).toBe(true);
    expect(baseResource.found).toBe(true);
    expect(baseResource.mime).toBe("text/css");
    expect(Buffer.from(baseResource.base64, "base64").toString("utf8")).toBe(".base { color: #123456; }");
    expect(numberedResource.ok).toBe(true);
    expect(numberedResource.found).toBe(true);
    expect(numberedResource.mime).toBe("text/css");
    expect(Buffer.from(numberedResource.base64, "base64").toString("utf8")).toBe(".numbered { color: #654321; }");
    await resourceProbe.close();
    expect(harness.server.calls).toHaveLength(0);
    expect(externalRequests).toEqual([]);

    await options.reload();
    await expect(options.locator("#richMdictInstalledList .site-row").filter({ hasText: "Unified Rich Fixture" })).toBeVisible();
    await options.locator("#richMdictInstalledList .site-row").filter({ hasText: "Unified Rich Fixture" }).getByRole("button", { name: "删除" }).click();
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装");
    expect(harness.server.calls).toHaveLength(0);
  });

  test("locally supplied real MDX/MDD imports, looks up offline, and survives a browser restart", async ({ harness }, testInfo) => {
    test.skip(!realMdxPath || !realMddPath,
      "Set TF_LOCAL_REAL_MDICT_MDX and TF_LOCAL_REAL_MDICT_MDD to run the local real-file import check.");
    test.setTimeout(240_000);
    const mdxBytes = await readFile(realMdxPath);
    const mddBytes = await readFile(realMddPath);
    const options = await harness.context.newPage();
    const optionsPageNonLocalRequestsBeforeRestart = [];
    options.on("request", (request) => {
      if (/^https?:/iu.test(request.url()) && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/iu.test(request.url())) {
        optionsPageNonLocalRequestsBeforeRestart.push(request.url());
      }
    });
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles([
      { name: "local-real-check.mdx", mimeType: "application/octet-stream", buffer: mdxBytes },
      { name: "local-real-check.mdd", mimeType: "application/octet-stream", buffer: mddBytes }
    ]);

    const importButton = options.locator("#localDictionaryImportButton");
    await expect(importButton).toBeEnabled({ timeout: 90_000 });
    for (const selector of ["#localDictionarySemanticConfirmation", "#localDictionaryLimitationsConfirmation"]) {
      const confirmation = options.locator(selector);
      if (await confirmation.isVisible()) await confirmation.check();
    }
    await expect(importButton).toBeEnabled();
    await importButton.click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 120_000 });
    await options.locator("#localDictionaryImport").screenshot({
      path: testInfo.outputPath("local-real-mdict-import-complete.png")
    });

    const installed = options.locator("#richMdictInstalledList .site-row").first();
    await expect(installed).toBeVisible();
    const selectionEnabled = installed.locator('input[data-action="enabled"]');
    await expect(selectionEnabled).toBeVisible();
    if (!await selectionEnabled.isChecked()) await selectionEnabled.check();
    await expect(selectionEnabled).toBeChecked();
    const dictionaryId = await installed.getAttribute("data-dictionary-id");
    expect(dictionaryId).toBeTruthy();
    const firstList = await options.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    const firstDictionary = firstList.dictionaries.find((item) => item.id === dictionaryId);
    expect(firstDictionary?.status).toBe("ready");
    expect(firstDictionary?.entryCount).toBeGreaterThan(0);
    expect(firstDictionary?.resourceCount).toBe(1);

    const firstLookup = await options.evaluate(() => chrome.runtime.sendMessage({
      type: "RICH_MDICT_LOOKUP",
      text: "中国"
    }));
    expect(firstLookup.found).toBe(true);
    const firstRecord = firstLookup.dictionaries.find((item) => item.id === dictionaryId);
    expect(firstRecord?.headword).toBe("中國");
    expect(firstRecord?.text.length).toBeGreaterThan(0);
    const selectionLookup = await options.evaluate(() => chrome.runtime.sendMessage({
      type: "RICH_MDICT_LOOKUP",
      text: "IP"
    }));
    expect(selectionLookup.found).toBe(true);
    const selectionRecord = selectionLookup.dictionaries.find((item) => item.id === dictionaryId);
    expect(selectionRecord?.headword).toBe("IP");

    const lookupPage = await harness.open("/selection");
    await lookupPage.setViewportSize({ width: 1440, height: 900 });
    await lookupPage.evaluate(() => {
      document.title = "Local dictionary lookup";
      document.body.replaceChildren();
      const paragraph = document.createElement("p");
      paragraph.append("Select this real dictionary entry: ");
      const word = document.createElement("span");
      word.id = "real-cedict-selected-word";
      word.textContent = "IP";
      paragraph.append(word);
      document.body.append(paragraph);
    });
    await harness.inject(lookupPage);
    const selectionScreenshot = testInfo.outputPath("local-real-cedict-rich-text-selection.png");
    try {
      await lookupPage.locator("#real-cedict-selected-word").evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
      const chip = lookupPage.locator(".tf-selection-chip");
      await expect(chip).toBeVisible({ timeout: 15_000 });
      await chip.click();
      const card = lookupPage.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      if (!await card.evaluate((node) => node.open)) await card.locator("summary").click();
      await expect(card).toHaveAttribute("data-state", "success", { timeout: 30_000 });
      const viewer = card.locator(".tf-selection-rich-text .tf-rich-viewer");
      await expect(viewer).toBeVisible();
      const renderedText = await viewer.innerText();
      expect(renderedText.trim().length).toBeGreaterThan(0);
      const expectedVisibleText = String(selectionRecord.text)
        .replace(/<[^>]*>/gu, " ")
        .replace(/&(?:nbsp|amp|lt|gt|quot);/giu, " ")
        .replace(/\s+/gu, " ")
        .trim();
      const expectedRecordToken = expectedVisibleText.match(/[\p{L}\p{N}]{4,}/u)?.[0];
      expect(expectedRecordToken).toBeTruthy();
      expect(renderedText.toLocaleLowerCase()).toContain(expectedRecordToken.toLocaleLowerCase());
      await lookupPage.screenshot({ path: selectionScreenshot, fullPage: false, caret: "hide" });
      console.log("[LOCAL_REAL_CEDICT_PRODUCT_UI]", JSON.stringify({
        status: "PASS",
        selectedText: "IP",
        dictionaryTitle: firstDictionary.title,
        renderedTextCharacters: renderedText.trim().length,
        renderedRecordTokenVisible: true,
        screenshot: selectionScreenshot
      }));
    } catch (error) {
      await lookupPage.screenshot({
        path: testInfo.outputPath("local-real-cedict-selection-failure.png"),
        fullPage: false
      }).catch(() => {});
      throw error;
    }

    const browserVersion = harness.context.browser().version();
    await harness.restartBrowser();
    const restartedOptions = await harness.context.newPage();
    await restartedOptions.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const persistedRow = restartedOptions.locator(`#richMdictInstalledList [data-dictionary-id="${dictionaryId}"]`);
    await expect(persistedRow).toBeVisible();
    const restartedList = await restartedOptions.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    expect(restartedList.dictionaries.find((item) => item.id === dictionaryId)?.status).toBe("ready");
    const restartedLookup = await restartedOptions.evaluate(() => chrome.runtime.sendMessage({
      type: "RICH_MDICT_LOOKUP",
      text: "中国"
    }));
    expect(restartedLookup.found).toBe(true);
    const restartedRecord = restartedLookup.dictionaries.find((item) => item.id === dictionaryId);
    expect(restartedRecord?.headword).toBe(firstRecord.headword);
    expect(restartedRecord?.text).toBe(firstRecord.text);
    await restartedOptions.locator(`#richMdictInstalledList [data-dictionary-id="${dictionaryId}"]`)
      .getByRole("button", { name: "删除" }).click();
    await expect(restartedOptions.locator(`#richMdictInstalledList [data-dictionary-id="${dictionaryId}"]`)).toBeHidden();

    expect(harness.server.calls).toHaveLength(0);
    expect(optionsPageNonLocalRequestsBeforeRestart).toEqual([]);
    console.log("[LOCAL_REAL_MDICT_FLOW]", JSON.stringify({
      browserVersion,
      entryCount: firstDictionary.entryCount,
      mddFileCount: firstDictionary.resourceCount,
      lookupHeadword: firstRecord.headword,
      restartLookupPreserved: restartedRecord.text === firstRecord.text,
      mockProviderCalls: harness.server.calls.length,
      optionsPageNonLocalRequestsBeforeRestart: optionsPageNonLocalRequestsBeforeRestart.length,
      productionArtifactTreeSha256BeforeTestAdaptation: harness.buildReport.treeSha256,
      productionArtifactBytesBeforeTestAdaptation: harness.buildReport.totalBytes,
      productionArtifactFileCountBeforeTestAdaptation: harness.buildReport.fileCount
    }));
  });

  test("unrelated MDD is shown and blocks installation instead of attaching silently", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles([
      { name: "intended.mdx", mimeType: "application/octet-stream", buffer: makeRichMdx([["unrelatedfixture", "gloss"]], { title: "Unrelated MDD Fixture", styleSheet: "" }) },
      { name: "some-other-book.mdd", mimeType: "application/octet-stream", buffer: makeMdd([["\\media\\fixture.png", Uint8Array.of(1)]]) }
    ]);
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("未能关联");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("some-other-book.mdd");
    await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();
    expect(harness.server.calls).toHaveLength(0);
  });

  test("unsupported LZO reports a human readable reason and cannot install", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const lzo = makeMdx([["lzo-fixture", "gloss"]], { keyIndexCompression: "lzo" });
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "unsupported-lzo.mdx", mimeType: "application/octet-stream", buffer: lzo
    });
    await expect(options.locator("#localDictionaryPreflightSummary")).toHaveAttribute("aria-live", "polite");
    await expect(options.locator("#localDictionaryImportProgress")).toHaveAttribute("aria-live", "polite");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("暂不支持");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("LZO 压缩");
    await expect(options.getByRole("button", { name: "安装词典" })).toBeDisabled();
    expect(harness.server.calls).toHaveLength(0);
  });

  test("partial MDX with resources stays Rich unless structured semantics are explicitly confirmed", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles([
      {
        name: "partial-rich.mdx", mimeType: "application/octet-stream",
        buffer: makeRichMdx([["partialfixture", "纯文本词条释义"]], { title: "Partial Rich Fixture", format: "Text", styleSheet: "" })
      },
      {
        name: "partial-rich.mdd", mimeType: "application/octet-stream",
        buffer: makeMdd([["\\media\\fixture.png", Uint8Array.of(1, 2)]])
      }
    ]);
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("来源与信任");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("本机占用估算");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("UTF-8");
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();

    await options.locator("#localDictionarySemanticConfirmation").focus();
    await options.locator("#localDictionarySemanticConfirmation").press("Space");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("部分可用");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("带有 MDD 附件的 MDX 只能保留为富文本词典");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("MDX 富文本词典");
    await expect(options.locator("#localDictionaryLimitationsLabel")).toBeVisible();
    await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();

    await options.locator("#localDictionaryLimitationsConfirmation").focus();
    await options.locator("#localDictionaryLimitationsConfirmation").press("Space");
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });
    await expect(options.locator("#richMdictInstalledList .site-row").filter({ hasText: "Partial Rich Fixture" })).toBeVisible();
    expect(harness.server.calls).toHaveLength(0);
  });

  test("ambiguous numbered MDD companions fail before import with the numbering reason", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const mdd = makeMdd([["\\media\\fixture.png", Uint8Array.of(1)]]);
    await options.locator("#localDictionaryFiles").setInputFiles([
      { name: "ambiguous.mdx", mimeType: "application/octet-stream", buffer: makeRichMdx([["ambiguityfixture", "gloss"]], { title: "Ambiguous Fixture", styleSheet: "" }) },
      { name: "ambiguous.mdd", mimeType: "application/octet-stream", buffer: mdd },
      { name: "ambiguous.2.mdd", mimeType: "application/octet-stream", buffer: mdd }
    ]);
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("文件无效");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("编号 MDD 必须从 .1.mdd 开始连续排列");
    await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装");
    expect(harness.server.calls).toHaveLength(0);
  });

  test("same-title MDX requires an explicit keep-as-another-dictionary decision", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "first-copy.mdx", mimeType: "application/octet-stream",
      buffer: makeRichMdx([["duplicatefixture", "first copy"]], { title: "Possible Duplicate Fixture", styleSheet: "" })
    });
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });
    await expect(options.locator("#richMdictInstalledList .site-row").filter({ hasText: "Possible Duplicate Fixture" })).toHaveCount(1);

    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "second-copy.mdx", mimeType: "application/octet-stream",
      buffer: makeRichMdx([["duplicatefixture", "different second copy"]], { title: "Possible Duplicate Fixture", styleSheet: "" })
    });
    await expect(options.locator("#localDictionaryDuplicateLabel")).toBeVisible();
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("未验证");
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("不会覆盖");
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("first-copy.mdx");
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("second-copy.mdx");
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("版本");
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("大小");
    await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();
    await options.locator("#localDictionaryDuplicateConfirmation").check();
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });
    await expect(options.locator("#richMdictInstalledList .site-row").filter({ hasText: "Possible Duplicate Fixture" })).toHaveCount(2);
    expect(harness.server.calls).toHaveLength(0);
  });

  test("cancelling a delayed local preflight shows cancellation and never activates a dictionary", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.addInitScript(() => {
      const arrayBuffer = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function delayedArrayBuffer() {
        return new Promise((resolve, reject) => {
          setTimeout(() => arrayBuffer.call(this).then(resolve, reject), 1200);
        });
      };
    });
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "cancel-preflight.mdx", mimeType: "application/octet-stream",
      buffer: makeRichMdx([["cancelpreflight", "never installed"]], { title: "Cancelled Preflight Fixture", styleSheet: "" })
    });
    const cancelButton = options.locator("#localDictionaryCancelButton");
    await expect(cancelButton).toBeVisible();
    await expect(cancelButton).toHaveAccessibleName("取消");
    await expect(options.locator("#localDictionaryPreflightSummary")).toHaveAttribute("aria-live", "polite");
    await cancelButton.focus();
    await cancelButton.press("Enter");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("检查已取消", { timeout: 10_000 });
    await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装");
    expect(harness.server.calls).toHaveLength(0);
  });

  test("cancelling Rich MDX index creation removes partial state and permits a clean retry", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "cancel-rich-index.mdx", mimeType: "application/octet-stream",
      buffer: makeRichMdx(Array.from({ length: 512 }, (_, index) => [
        `cancelrichindexfixture${String(index).padStart(4, "0")}`,
        `never partially active ${index}`
      ]), {
        title: "Cancelled Rich Index Fixture", styleSheet: ""
      })
    });
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.evaluate(() => {
      const progress = document.getElementById("localDictionaryImportProgress");
      window.__mdxIndexCancelTriggered = false;
      window.__mdxIndexProgressObserved = "";
      window.__mdxIndexCancelVisible = false;
      const observer = new MutationObserver(() => {
        if (progress.dataset.phase !== "index" || !progress.textContent.includes("建立受限查询索引")) return;
        const cancel = document.getElementById("localDictionaryCancelButton");
        window.__mdxIndexProgressObserved = progress.textContent;
        window.__mdxIndexCancelVisible = Boolean(cancel && !cancel.hidden && !cancel.disabled);
        window.__mdxIndexCancelTriggered = true;
        observer.disconnect();
        if (window.__mdxIndexCancelVisible) cancel.click();
      });
      observer.observe(progress, { attributes: true, attributeFilter: ["data-phase"], childList: true, characterData: true, subtree: true });
    });

    await options.locator("#localDictionaryImportButton").click();
    await expect.poll(() => options.evaluate(() => window.__mdxIndexCancelTriggered)).toBe(true);
    expect(await options.evaluate(() => window.__mdxIndexProgressObserved)).toBe("建立受限查询索引");
    expect(await options.evaluate(() => window.__mdxIndexCancelVisible)).toBe(true);
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("已取消", { timeout: 30_000 });
    const afterCancel = await options.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    expect(afterCancel.ok).toBe(true);
    expect(afterCancel.dictionaries.some((dictionary) => dictionary.title === "Cancelled Rich Index Fixture")).toBe(false);
    await expect(options.locator("#richMdictInstalledList")).not.toContainText("Cancelled Rich Index Fixture");

    await expect(options.getByRole("button", { name: "安装词典" })).toBeEnabled();
    await options.getByRole("button", { name: "安装词典" }).click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成 · 富文本词典已安装", { timeout: 90_000 });
    await expect(options.locator("#richMdictInstalledList .site-row").filter({ hasText: "Cancelled Rich Index Fixture" })).toBeVisible();
    expect(harness.server.calls).toHaveLength(0);
  });

  test("TFLex follows local bounded staging and the existing full-validation commit path", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const pack = await makeTflexFixture("local-e2e-tflex-v1");
    await options.locator("#localDictionaryFiles").setInputFiles(tflexFiles(pack));
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("TFLex");
    await expect(options.locator("#localDictionaryLimitationsLabel")).toBeVisible();
    await expect(options.locator("#localDictionaryLimitationsText")).toContainText("安装前会重新完整校验");
    await options.locator("#localDictionaryLimitationsConfirmation").check();
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完整安装校验", { timeout: 90_000 });
    await expect(options.locator("#installedDictionaryList")).toContainText("local-e2e-tflex-v1");
    expect(harness.server.calls).toHaveLength(0);
  });

  test("TFLex full-validation failure never activates partial files", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const pack = await makeTflexFixture("local-e2e-tflex-corrupt");
    pack.files["entries.dat"] = new Uint8Array(pack.files["entries.dat"]);
    pack.files["entries.dat"][0] ^= 1;
    await options.locator("#localDictionaryFiles").setInputFiles(tflexFiles(pack));
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("TFLex");
    await expect(options.locator("#localDictionaryLimitationsText")).toContainText("安装前会重新完整校验");
    await options.locator("#localDictionaryLimitationsConfirmation").check();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("安装失败", { timeout: 90_000 });
    await expect(options.locator("#installedDictionaryList")).not.toContainText("local-e2e-tflex-corrupt");
    expect(harness.server.calls).toHaveLength(0);
  });

  test("same-packId TFLex replacement requires confirmation and a bad hash preserves the active version and lookup", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const word = "localfixtureword";
    const oldTranslation = "原版本仍然可用";
    const replacementTranslation = "错误替换版本";
    const installedPack = await makeTflexFixture("local-e2e-tflex-atomic-replace", {
      packVersion: "fixture-v1",
      translation: oldTranslation
    });
    await options.locator("#localDictionaryFiles").setInputFiles(tflexFiles(installedPack));
    await options.locator("#localDictionaryLimitationsConfirmation").check();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完整安装校验", { timeout: 90_000 });
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });

    const lookupBefore = await harness.runtime({
      type: "LEXICAL_LOOKUP", text: word, pageUrl: "https://example.test/", sourceLanguage: "en", targetLanguage: "zh-CN"
    });
    expect(lookupBefore.candidates.some((candidate) => candidate.translations?.includes(oldTranslation))).toBe(true);
    const beforeStatus = await options.evaluate(() => chrome.runtime.sendMessage({ type: "DICTIONARY_PACK_STATUS" }));
    const beforeVersion = beforeStatus.state.packs[installedPack.manifest.packId].active.packVersion;
    expect(beforeVersion).toBe("fixture-v1");

    const badReplacement = await makeTflexFixture("local-e2e-tflex-atomic-replace", {
      packVersion: "fixture-v2",
      translation: replacementTranslation
    });
    badReplacement.files["entries.dat"] = new Uint8Array(badReplacement.files["entries.dat"]);
    badReplacement.files["entries.dat"][0] ^= 1;
    await options.locator("#localDictionaryFiles").setInputFiles(tflexFiles(badReplacement));
    await expect(options.locator("#localDictionaryDuplicateLabel")).toBeVisible();
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("确认更新已安装");
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("manifest.json");
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("entries.dat");
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("fixture-v1");
    await expect(options.locator("#localDictionaryDuplicateText")).toContainText("校验或保存失败");
    await expect(options.locator("#localDictionaryLimitationsLabel")).toBeVisible();
    await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();
    await options.locator("#localDictionaryLimitationsConfirmation").check();
    await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();
    await options.locator("#localDictionaryDuplicateConfirmation").check();
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("安装失败", { timeout: 90_000 });

    const afterStatus = await options.evaluate(() => chrome.runtime.sendMessage({ type: "DICTIONARY_PACK_STATUS" }));
    expect(afterStatus.state.packs[installedPack.manifest.packId].active.packVersion).toBe(beforeVersion);
    const lookupAfter = await harness.runtime({
      type: "LEXICAL_LOOKUP", text: word, pageUrl: "https://example.test/", sourceLanguage: "en", targetLanguage: "zh-CN"
    });
    expect(lookupAfter.candidates.some((candidate) => candidate.translations?.includes(oldTranslation))).toBe(true);
    expect(lookupAfter.candidates.some((candidate) => candidate.translations?.includes(replacementTranslation))).toBe(false);
    expect(harness.server.calls).toHaveLength(0);
  });

  test("cancelling the initial MDD attachment keeps previously active MDD resources intact", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const priorResourceBytes = Buffer.from(".prior { color: #123456; }");
    const priorMdd = makeMdd([["\\media\\prior.css", new Uint8Array(priorResourceBytes)]]);
    await options.locator("#localDictionaryFiles").setInputFiles([
      { name: "prior-with-resource.mdx", mimeType: "application/octet-stream", buffer: makeRichMdx([["cancelpriorfixture", "prior rich gloss"]], { title: "Prior MDD Fixture", styleSheet: "" }) },
      { name: "prior-with-resource.mdd", mimeType: "application/octet-stream", buffer: priorMdd }
    ]);
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });
    const priorRow = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({ hasText: "Prior MDD Fixture" });
    await expect(priorRow).toContainText("1 个 MDD 文件");
    const priorDictionaryId = await priorRow.getAttribute("data-dictionary-id");

    const pendingMdd = makeMdd(Array.from({ length: 2048 }, (_, index) => [
      `\\media\\pending-${String(index).padStart(4, "0")}.css`,
      new TextEncoder().encode(`.pending-${index} { color: #123456; }`)
    ]));
    await options.locator("#localDictionaryFiles").setInputFiles([
      { name: "cancel-attach.mdx", mimeType: "application/octet-stream", buffer: makeRichMdx([["cancelattachfixture", "new rich gloss"]], { title: "Cancelled Attach Fixture", styleSheet: "" }) },
      { name: "cancel-attach.mdd", mimeType: "application/octet-stream", buffer: pendingMdd }
    ]);
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("cancel-attach.mdd");
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.evaluate(() => {
      const progress = document.getElementById("localDictionaryImportProgress");
      window.__mddIndexCancelTriggered = false;
      window.__mddIndexProgressObserved = "";
      window.__mddCancelButtonVisible = false;
      window.__mddAttachStarted = false;
      const observer = new MutationObserver((records) => {
        if (records.some((record) => Array.from(record.addedNodes || []).some((node) =>
          String(node.textContent || "").includes("MDX 已安装，正在原子检查并添加已关联的 MDD")))) {
          window.__mddAttachStarted = true;
        }
        if (!window.__mddAttachStarted || progress.dataset.phase !== "index") return;
        if (!progress.textContent.includes("建立受限查询索引")) return;
        window.__mddIndexProgressObserved = progress.textContent;
        const cancel = document.getElementById("localDictionaryCancelButton");
        window.__mddCancelButtonVisible = Boolean(cancel && !cancel.hidden && !cancel.disabled);
        window.__mddIndexCancelTriggered = true;
        observer.disconnect();
        if (window.__mddCancelButtonVisible) cancel.click();
      });
      observer.observe(progress, { attributes: true, attributeFilter: ["data-phase"], childList: true, characterData: true, subtree: true });
    });
    await options.locator("#localDictionaryImportButton").click();
    await expect.poll(() => options.evaluate(() => window.__mddIndexCancelTriggered)).toBe(true);
    expect(await options.evaluate(() => window.__mddIndexProgressObserved)).toBe("建立受限查询索引");
    expect(await options.evaluate(() => window.__mddCancelButtonVisible)).toBe(true);
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("MDD 附件导入已取消", { timeout: 90_000 });

    await expect(priorRow).toContainText("1 个 MDD 文件");
    const activeDictionaries = await options.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    const prior = activeDictionaries.dictionaries.find((dictionary) => dictionary.id === priorDictionaryId);
    expect(prior?.resourceCount).toBe(1);
    const cancelled = activeDictionaries.dictionaries.find((dictionary) => dictionary.title === "Cancelled Attach Fixture");
    expect(cancelled?.resourceCount || 0).toBe(0);
    const resourceProbe = await harness.open("/selection");
    await harness.inject(resourceProbe);
    const priorResource = await readMddResource(harness, resourceProbe, priorDictionaryId, "media/prior.css");
    expect(priorResource.ok).toBe(true);
    expect(priorResource.found).toBe(true);
    expect(Buffer.from(priorResource.base64, "base64")).toEqual(priorResourceBytes);

    const retry = options.locator("#localDictionaryRetryMddButton");
    await expect(retry).toBeVisible();
    await expect(retry).toHaveAccessibleName(/重试.*添加 MDD/u);
    await retry.focus();
    await retry.press("Enter");
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成 · MDD 附件已添加", { timeout: 90_000 });
    const afterRetry = await options.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    const retried = afterRetry.dictionaries.find((dictionary) => dictionary.id === cancelled.id);
    expect(retried?.resourceCount).toBe(1);
    const retriedResource = await readMddResource(harness, resourceProbe, cancelled.id, "media/pending-0000.css");
    expect(retriedResource.ok).toBe(true);
    expect(retriedResource.found).toBe(true);
    expect(retriedResource.mime).toBe("text/css");
    expect(Buffer.from(retriedResource.base64, "base64").toString("utf8")).toBe(".pending-0 { color: #123456; }");
    await resourceProbe.close();
    expect(harness.server.calls).toHaveLength(0);
  });
});

async function makeTflexFixture(packId, { packVersion = "fixture-v1", translation = "本地测试释义" } = {}) {
  return buildLocalIndexedTflex({
    packId,
    packVersion,
    records: [{
      lookupKey: "localfixtureword",
      exactLookupKeys: ["localfixtureword"],
      displayForm: "localfixtureword",
      kind: "lexical",
      aliases: [],
      senses: [{
        id: "local:fixture:1",
        translations: [translation],
        domains: [],
        sourceRefs: [{ sourceId: "e2e-fixture-source", recordId: "1" }]
      }]
    }],
    sources: [{ id: "e2e-fixture-source", version: "fixture-v1", provenance: "Synthetic local E2E fixture" }],
    sourceEntryCount: 1,
    cryptoProvider: webcrypto
  });
}

function tflexFiles(pack) {
  return Object.entries(pack.files).map(([name, bytes]) => ({
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(bytes)
  }));
}

async function readMddResource(harness, page, dictionaryId, path) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async ({ tabId, dictionaryId, path }) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async ({ dictionaryId, path }) => chrome.runtime.sendMessage({
        type: "RICH_MDD_RESOURCE",
        requestId: `selection-mdd-resource-${crypto.randomUUID().replaceAll("-", "")}`,
        ownerToken: crypto.randomUUID().replaceAll("-", ""),
        dictionaryId,
        path
      }),
      args: [{ dictionaryId, path }]
    });
    return result?.result;
  }, { tabId, dictionaryId, path });
}
