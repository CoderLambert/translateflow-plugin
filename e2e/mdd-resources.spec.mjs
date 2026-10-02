import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";
import { readMddInteropFixture } from "../tests/helpers/mdd-fixture.mjs";

const evidenceDir = process.env.MDD_INTEROP_EVIDENCE_DIR ||
  resolve("/tmp/translateflow-mdd-184/evidence");
const lock = JSON.parse(await readFile(
  new URL("../tests/fixtures/mdd-interop/corpus-lock.json", import.meta.url),
  "utf8"
));

test.describe("local MDD resource product and security behavior", () => {
  test.setTimeout(300_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("independent MDX/MDD pair restores image, gated audio, and safe CSS after reload", async ({ harness }) => {
    await mkdir(evidenceDir, { recursive: true });
    const { mdx, mdd } = await readMddInteropFixture();
    const options = await harness.context.newPage();
    const browserErrors = [];
    const remoteRequests = [];
    options.on("pageerror", (error) => browserErrors.push(error.message));
    options.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装");
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "interop.mdx",
      mimeType: "application/octet-stream",
      buffer: mdx
    });
    await expect(options.locator("#localDictionaryPreflightSummary"))
      .toContainText("TranslateFlow MDD Interop Fixture");
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", {
      timeout: 60_000
    });

    let row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({
      hasText: "TranslateFlow MDD Interop Fixture"
    });
    await expect(row).toBeVisible();
    const dictionaryId = await row.getAttribute("data-dictionary-id");
    expect(dictionaryId).toMatch(/^rich-mdict-/u);
    await attachMddFile(row, {
      name: "interop.mdd",
      mimeType: "application/octet-stream",
      buffer: mdd
    }, { success: true });

    const deniedSettingsRead = await readMddResourceFromOptions(
      options,
      dictionaryId,
      "interop/sample.png"
    );
    expect(deniedSettingsRead.ok).toBe(false);
    expect(deniedSettingsRead.errorCode).toBe("RICH_MDICT_CONTENT_ONLY");

    const resourceProbe = await harness.open("/selection");
    await harness.inject(resourceProbe);

    for (const expected of lock.generation.resources) {
      const response = await readMddResource(harness, resourceProbe, dictionaryId, expected.path);
      expect(response.ok, expected.path).toBe(true);
      expect(response.found, expected.path).toBe(true);
      expect(response.mime, expected.path).toBe(expected.mime);
      const data = Buffer.from(response.base64, "base64");
      expect(data.byteLength, expected.path).toBe(expected.bytes);
      expect(sha256(data), expected.path).toBe(expected.sha256);
    }
    await options.reload();
    row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({
      hasText: "TranslateFlow MDD Interop Fixture"
    });
    await expect(row).toBeVisible();
    const afterReload = await readMddResource(harness, resourceProbe, dictionaryId, "interop/sample.png");
    expect(afterReload.ok).toBe(true);
    expect(afterReload.found).toBe(true);
    expect(afterReload.mime).toBe("image/png");

    const corruptMdd = Buffer.from(mdd);
    const recordBlockOffset = firstRecordBlockOffset(corruptMdd);
    corruptMdd[recordBlockOffset + 8] ^= 0xff;
    await attachMddFile(row, {
      name: "interop.mdd",
      mimeType: "application/octet-stream",
      buffer: corruptMdd
    }, { success: false });
    const oldResourceSurvives = await readMddResource(harness, resourceProbe, dictionaryId, "interop/sample.png");
    expect(oldResourceSurvives.ok).toBe(true);
    expect(oldResourceSurvives.found).toBe(true, "a corrupt replacement must not remove active resources");
    await resourceProbe.close();

    await harness.setStorage({ appearance: "dark" });
    const page = await harness.open("/selection");
    await page.setViewportSize({ width: 320, height: 760 });
    await page.emulateMedia({ colorScheme: "dark" });
    page.on("request", (request) => {
      const url = request.url();
      if (/^https?:/iu.test(url) && new URL(url).origin !== harness.server.baseUrl) {
        remoteRequests.push(url);
      }
    });
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "mdd-interop-word";
      node.textContent = "mddinteropfixture";
      node.style.overflowWrap = "anywhere";
      document.body.appendChild(node);
    });
    await harness.inject(page);
    await selectElementText(page, "#mdd-interop-word");
    const selectionChip = page.locator(".tf-selection-chip");
    await expect(selectionChip).toBeVisible({ timeout: 10_000 });
    await selectionChip.scrollIntoViewIfNeeded();
    await selectionChip.click({ timeout: 10_000 });

    let richCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
    await expandRichCard(richCard);
    let richViewer = richCard.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(richViewer).toContainText("Independent MDD resource fixture.", { timeout: 30_000 });
    const image = richViewer.locator("img.tf-rich-resource-image[src^='blob:']");
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBe(2);
    expect(await richViewer.evaluate((node) => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);
    const cssProof = await richViewer.evaluate((node) => {
      const note = node.querySelector(".mdd-note");
      const highlight = node.querySelector(".mdd-highlight");
      const imageNode = node.querySelector("img.tf-rich-resource-image");
      return {
        noteColor: note ? getComputedStyle(note).color : "",
        highlightColor: highlight ? getComputedStyle(highlight).backgroundColor : "",
        imageUrl: imageNode?.currentSrc || "",
        width: node.clientWidth,
        scrollWidth: node.scrollWidth
      };
    });
    expect(cssProof.noteColor).toBe("rgb(47, 93, 80)");
    expect(cssProof.highlightColor).toBe("rgb(248, 239, 191)");
    expect(cssProof.imageUrl).toMatch(/^blob:/u);
    expect(cssProof.scrollWidth).toBeLessThanOrEqual(cssProof.width + 1);
    expect(cssProof.width).toBeLessThanOrEqual(320);

    const audioLoader = richViewer.locator("button[data-action='load-mdd-audio']");
    await expect(audioLoader).toBeVisible();
    await audioLoader.click();
    const audio = richViewer.locator("audio.tf-rich-resource-audio[src^='blob:']");
    await expect(audio).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(2);
    await audio.evaluate((node) => {
      node.addEventListener("play", () => node.dataset.e2ePlayEvent = "true", { once: true });
    });
    await audio.scrollIntoViewIfNeeded();
    const audioBox = await audio.boundingBox();
    expect(audioBox).toBeTruthy();
    await page.mouse.click(audioBox.x + 16, audioBox.y + Math.max(16, audioBox.height / 2));
    await expect.poll(() => audio.getAttribute("data-e2e-play-event"), { timeout: 5_000 }).toBe("true");
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(2);
    expect(await page.evaluate(() => window.__mddFixtureExecuted || false)).toBe(false);
    expect(harness.server.calls).toHaveLength(0);
    expect(remoteRequests).toEqual([]);
    expect(browserErrors).toEqual([]);

    // Capture evidence without mutating editable styles and invalidating source identity.
    await options.screenshot({ path: resolve(evidenceDir, "mdd-settings-attached.png"), fullPage: true, caret: "initial" });
    await page.screenshot({ path: resolve(evidenceDir, "mdd-resources-dark-narrow.png"), fullPage: true, caret: "initial" });

    await attachMddFile(row, {
      name: "interop.mdd",
      mimeType: "application/octet-stream",
      buffer: mdd
    }, { success: true });
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(0);
    await expect(page.locator("img.tf-rich-resource-image, audio.tf-rich-resource-audio")).toHaveCount(0);
    await expect(page.locator(".tf-selection-panel")).toBeVisible();

    await page.getByRole("button", { name: "关闭" }).click();
    await expect(page.locator(".tf-selection-panel")).toBeHidden();
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(0);

    await selectElementText(page, "#mdd-interop-word");
    const reopenedChip = page.locator(".tf-selection-chip");
    await expect(reopenedChip).toBeVisible({ timeout: 10_000 });
    await reopenedChip.scrollIntoViewIfNeeded();
    await reopenedChip.click({ timeout: 10_000 });
    richCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
    await expandRichCard(richCard);
    richViewer = richCard.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(richViewer.locator("img.tf-rich-resource-image[src^='blob:']")).toBeVisible({ timeout: 30_000 });

    await row.getByRole("button", { name: "删除" }).click();
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装", {
      timeout: 30_000
    });
    const afterDelete = await readMddResource(harness, page, dictionaryId, "interop/sample.png");
    expect(afterDelete.ok).toBe(true);
    expect(afterDelete.found).toBe(false);
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(0);
    await expect(page.locator("img.tf-rich-resource-image, audio.tf-rich-resource-audio")).toHaveCount(0);
    await expect(page.locator(".tf-selection-panel")).toBeVisible();
    expect(harness.server.calls).toHaveLength(0);

    const report = {
      status: "PASS",
      purpose: lock.purpose,
      writerCommit: lock.independentWriter.commit,
      dictionaryId,
      resourceMimeAndHashesMatched: true,
      resourcesPersistedAfterSettingsReload: true,
      corruptReplacementPreservedOldResources: true,
      visibleImageAfterReload: true,
      userPlaybackEvent: "play",
      css: cssProof,
      darkColorScheme: true,
      viewport: { width: 320, horizontalOverflow: false },
      remoteRequests: remoteRequests.length,
      providerCalls: harness.server.calls.length,
      objectUrlsAfterViewerClose: 0,
      objectUrlsAfterDictionaryDelete: await activeObjectUrlCount(harness, page),
      deleted: true,
      generatedAt: new Date().toISOString()
    };
    await writeFile(resolve(evidenceDir, "mdd-resources-e2e-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log("[MDD_RESOURCES_E2E]", JSON.stringify(report));
  });
});

async function attachMddFile(row, file, { success }) {
  await row.getByRole("button", { name: /添加或替换 MDD 附件/u }).click();
  await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles(file);
  const status = row.page().locator("#status");
  if (success) await expect(status).toContainText("本地资源已更新", { timeout: 60_000 });
  else await expect(status).toContainText("MDD", { timeout: 60_000 });
}

async function readMddResourceFromOptions(options, dictionaryId, path) {
  return options.evaluate(({ dictionaryId, path }) => chrome.runtime.sendMessage({
    type: "RICH_MDD_RESOURCE",
    dictionaryId,
    path
  }), { dictionaryId, path });
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

async function expandRichCard(card) {
  await expect(card).toBeVisible({ timeout: 30_000 });
  if (!await card.evaluate((node) => node.open)) {
    await card.locator("summary").click();
  }
  await expect(card).toHaveAttribute("data-state", "success", { timeout: 30_000 });
}

async function activeObjectUrlCount(harness, page) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async ({ tabId }) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.__TRANSLATE_FLOW_CONTENT__?.modules?.richResourceResolver?.activeObjectUrlCount ?? 0
    });
    return result?.result || 0;
  }, { tabId });
}

async function selectElementText(page, selector) {
  await page.locator(selector).evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "center" });
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  });
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function firstRecordBlockOffset(bytes) {
  const headerLength = bytes.readUInt32BE(0);
  const keyPreambleOffset = headerLength + 8;
  const keyInfoCompressedBytes = Number(bytes.readBigUInt64BE(keyPreambleOffset + 24));
  const keyBlocksBytes = Number(bytes.readBigUInt64BE(keyPreambleOffset + 32));
  const keyInfoOffset = keyPreambleOffset + 44;
  const keyBlocksOffset = keyInfoOffset + keyInfoCompressedBytes;
  const recordSectionOffset = keyBlocksOffset + keyBlocksBytes;
  const recordBlockCount = Number(bytes.readBigUInt64BE(recordSectionOffset));
  return recordSectionOffset + 32 + recordBlockCount * 16;
}
