import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";

const evidenceDir = process.env.RICH_MDICT_EVIDENCE_DIR ||
  resolve("test-results/rich-mdict-evidence");

test.describe("Rich MDict local product and security behavior", () => {
  test.setTimeout(300_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("Settings install persists, Selection reads safe text locally, and delete clears it", async ({ harness }) => {
    await mkdir(evidenceDir, { recursive: true });
    const options = await harness.context.newPage();
    const browserErrors = [];
    options.on("pageerror", (error) => browserErrors.push(error.message));
    options.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const fixture = makeRichMdx([
      ["richmdictfixtureterm", "<p><b>Fixture gloss</b><br>安全文本回退<script>window.__richFixtureExecuted = true</script><img src=\"https://attacker.invalid/never-fetch.png\" onerror=\"alert(1)\">&nbsp;"]
    ], {
      title: "Rich Fixture Dictionary",
      encrypted: 2,
      compact: "Yes",
      compat: "Yes"
    });

    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "rich-fixture.mdx",
      mimeType: "application/octet-stream",
      buffer: fixture
    });
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("Rich Fixture Dictionary");
    await options.locator("#localDictionaryImportButton").click();
    await expect.poll(
      () => options.locator("#localDictionaryImportProgress").textContent(),
      { timeout: 90_000 }
    ).toMatch(/(?:完成|安装失败)/u);
    const importState = await options.evaluate(() => ({
      progress: document.querySelector("#localDictionaryImportProgress")?.textContent || "",
      status: document.querySelector("#status")?.textContent || "",
      installed: document.querySelector("#richMdictInstalledList")?.textContent || ""
    }));
    if (importState.progress.includes("安装失败")) {
      throw new Error("Rich fixture install failed: " + JSON.stringify({ ...importState, browserErrors }));
    }
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", {
      timeout: 5_000
    });
    let installed = options.locator("#richMdictInstalledList .site-row").filter({
      hasText: "Rich Fixture Dictionary"
    });
    await expect(installed).toBeVisible();
    await options.screenshot({ path: resolve(evidenceDir, "synthetic-settings-installed.png"), fullPage: true });
    await options.reload();
    installed = options.locator("#richMdictInstalledList .site-row").filter({
      hasText: "Rich Fixture Dictionary"
    });
    await expect(installed).toBeVisible();
    await expect(installed).toContainText("可用");

    const page = await harness.open("/selection");
    const remoteRequests = [];
    page.on("request", (request) => {
      if (/^https?:\/\/(?!127\.0\.0\.1(?::|\/))|^https?:\/\/attacker\.invalid/iu.test(request.url())) {
        remoteRequests.push(request.url());
      }
    });
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "rich-mdict-fixture-word";
      node.textContent = "richmdictfixtureterm";
      document.body.appendChild(node);
    });
    await harness.inject(page);
    await selectElementText(page, "#rich-mdict-fixture-word");
    await expect(page.locator(".tf-selection-chip")).toBeVisible({ timeout: 10_000 });
    await page.locator(".tf-selection-chip").click();
    const richCard = page.locator(".tf-selection-rich-record")
      .filter({ hasText: "Rich Fixture Dictionary" });
    await expandRichCard(richCard);
    const richViewer = richCard.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(richViewer)
      .toContainText("Fixture gloss", { timeout: 30_000 });
    await expect(richViewer)
      .toContainText("安全文本回退");
    const fallback = await richViewer.textContent();
    expect(fallback).not.toContain("window.__richFixtureExecuted");
    expect(fallback).not.toContain("attacker.invalid");
    expect(fallback).not.toContain("onerror");
    expect(await page.locator(".tf-selection-result script, .tf-selection-result img").count()).toBe(0);
    expect(await page.evaluate(() => window.__richFixtureExecuted || false)).toBe(false);
    expect(harness.server.calls).toHaveLength(0);
    expect(remoteRequests).toEqual([]);
    await page.screenshot({ path: resolve(evidenceDir, "synthetic-selection-safe-fallback.png"), fullPage: true });

    await installed.getByRole("button", { name: "删除" }).click();
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装", {
      timeout: 30_000
    });
    const afterDelete = await options.evaluate(() => chrome.runtime.sendMessage({
      type: "RICH_MDICT_LOOKUP",
      text: "richmdictfixtureterm"
    }));
    expect(afterDelete.ok).toBe(true);
    expect(afterDelete.found).toBe(false);
    expect(harness.server.calls).toHaveLength(0);
  });

  test("corrupt key-info metadata is rejected without creating an installed dictionary", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const corrupt = Buffer.from(makeRichMdx([
      ["richmdictcorruptfixture", "<p>Should never install</p>"]
    ], { encrypted: 2 }));
    const headerBytes = corrupt.readUInt32BE(0);
    corrupt[headerBytes + 8 + 40] ^= 0xff;

    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "corrupt-rich-fixture.mdx",
      mimeType: "application/octet-stream",
      buffer: corrupt
    });
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("文件无效", {
      timeout: 30_000
    });
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("无法读取 MDX 文件结构");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("失败阶段读取 MDX 词头索引");
    await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装");
    expect(harness.server.calls).toHaveLength(0);
  });
});

async function selectElementText(page, selector) {
  await page.locator(selector).evaluate((element) => {
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

async function expandRichCard(card) {
  await expect(card).toBeVisible({ timeout: 30_000 });
  if (!await card.evaluate((node) => node.open)) {
    await card.locator("summary").click();
  }
  await expect(card).toHaveAttribute("data-state", "success", { timeout: 30_000 });
}
