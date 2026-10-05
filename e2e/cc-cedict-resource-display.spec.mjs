import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";

const mdxPath = process.env.CC_CEDICT_REAL_MDX || "";
const mddPath = process.env.CC_CEDICT_REAL_MDD || "";
const evidenceDir = process.env.CC_CEDICT_EVIDENCE_DIR || "/tmp/translateflow-real-dict";

test.describe("real CC-CEDICT rich resource display", () => {
  test.setTimeout(12 * 60 * 1000);
  test.skip(!mdxPath || !mddPath, "Set CC_CEDICT_REAL_MDX and CC_CEDICT_REAL_MDD to the original public package files.");

  test("imports original MDX/MDD, displays a selected record with safe styles, and survives restart", async ({ harness }) => {
    await mkdir(evidenceDir, { recursive: true });
    const [mdx, mdd] = await Promise.all([readFile(mdxPath), readFile(mddPath)]);
    const mdxSha256 = sha256(mdx);
    const mddSha256 = sha256(mdd);
    expect(mdxSha256).toBe("e8d1a20cf1540470f18c3aec3695df5e5c4d102f5f56a1394f014468718f124a");
    expect(mddSha256).toBe("19b7bf816cc344829aa95d56d63754b6879560f052537cee51e299296d9b7f23");

    const options = await harness.context.newPage();
    const observedPageErrors = [];
    const selectionPageExternalRequests = [];
    options.on("pageerror", (error) => observedPageErrors.push(error.message));
    options.on("console", (message) => {
      if (message.type() === "error") observedPageErrors.push(message.text());
    });
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装");
    await options.locator("#localDictionaryFiles").setInputFiles([mdxPath, mddPath]);
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("CC-CEDICT 230908");
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("MDX 富文本词典");
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 10 * 60 * 1000 });

    let installed = options.locator("#richMdictInstalledList .site-row").filter({ hasText: "CC-CEDICT 230908" });
    await expect(installed).toBeVisible();
    await options.reload();
    installed = options.locator("#richMdictInstalledList .site-row").filter({ hasText: "CC-CEDICT 230908" });
    await expect(installed).toBeVisible();
    await expect(installed).toContainText("可用");

    const restart = await harness.restartBrowser();
    expect(restart.restartedPersistentProfile).toBe(true);
    const reopenedOptions = await harness.context.newPage();
    await reopenedOptions.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    installed = reopenedOptions.locator("#richMdictInstalledList .site-row").filter({ hasText: "CC-CEDICT 230908" });
    await expect(installed).toBeVisible({ timeout: 30_000 });
    await expect(installed).toContainText("可用");
    const backgroundProbe = await reopenedOptions.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "RICH_MDICT_LOOKUP", text: "IP" });
      return { ok: Boolean(response?.ok), found: Boolean(response?.found), dictionaryCount: response?.dictionaries?.length || 0 };
    });
    expect(backgroundProbe).toMatchObject({ ok: true, found: true });

    const page = await harness.open("/selection");
    await page.setViewportSize({ width: 1440, height: 900 });
    page.on("pageerror", (error) => observedPageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") observedPageErrors.push(message.text());
    });
    page.on("request", (request) => {
      if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) {
        selectionPageExternalRequests.push(request.url());
      }
    });
    await page.evaluate(() => {
      document.body.replaceChildren();
      const node = document.createElement("p");
      node.append("Select the term ");
      const selected = document.createElement("span");
      selected.id = "cc-cedict-real-word";
      selected.textContent = "IP";
      node.append(selected, " from this webpage.");
      document.body.appendChild(node);
    });
    await harness.inject(page);
    await selectElementText(page, "#cc-cedict-real-word");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();

    const card = page.locator(".tf-selection-rich-record").filter({ hasText: "CC-CEDICT 230908" });
    await expandRichCard(card);
    await expect.poll(() => card.evaluate((node) => node.open)).toBe(true);
    const viewer = card.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(viewer).toBeVisible();
    await expect.poll(() => viewer.evaluate((node) => {
      const root = node.getRootNode();
      const dictionaryStyles = [...root.querySelectorAll("style")].slice(1);
      const descendants = [node, ...node.querySelectorAll("*")];
      let matchedDictionaryRules = 0;
      function countMatchedRules(rules) {
        for (const rule of [...(rules || [])]) {
          if (rule.selectorText && descendants.some((element) => {
            try { return element.matches(rule.selectorText); } catch { return false; }
          })) matchedDictionaryRules += 1;
          if (rule.cssRules) countMatchedRules(rule.cssRules);
        }
      }
      for (const style of dictionaryStyles) countMatchedRules(style.sheet?.cssRules);
      return matchedDictionaryRules;
    }), { timeout: 30_000 }).toBeGreaterThan(0);
    const displayProof = await viewer.evaluate((node) => {
      const root = node.getRootNode();
      const styleNodes = [...root.querySelectorAll("style")];
      const dictionaryStyles = styleNodes.slice(1).map((style) => style.textContent || "");
      let matchedDictionaryRules = 0;
      const descendants = [node, ...node.querySelectorAll("*")];
      function countMatchedRules(rules) {
        for (const rule of [...(rules || [])]) {
          if (rule.selectorText && descendants.some((element) => {
            try { return element.matches(rule.selectorText); } catch { return false; }
          })) matchedDictionaryRules += 1;
          if (rule.cssRules) countMatchedRules(rule.cssRules);
        }
      }
      for (const style of styleNodes.slice(1)) countMatchedRules(style.sheet?.cssRules);
      const images = [...node.querySelectorAll("img.tf-rich-resource-image")];
      const text = node.innerText || node.textContent || "";
      return {
        recordTextLength: text.trim().length,
        dictionaryStylesheetCount: dictionaryStyles.filter((css) => css.includes(".tf-rich-viewer")).length,
        dictionaryStylesheetBytes: dictionaryStyles.reduce((sum, css) => sum + css.length, 0),
        dictionaryCssRules: dictionaryStyles.reduce((sum, css) => sum + (css.match(/\{/gu) || []).length, 0),
        matchedDictionaryRules,
        imageCount: images.length,
        loadedImageCount: images.filter((image) => image.complete && image.naturalWidth > 0).length,
        audioCount: node.querySelectorAll("audio.tf-rich-resource-audio").length,
        placeholderCount: node.querySelectorAll(".tf-rich-placeholder").length
      };
    });
    expect(displayProof.recordTextLength).toBeGreaterThan(0);
    expect(displayProof.dictionaryStylesheetCount).toBeGreaterThan(0);
    expect(displayProof.dictionaryStylesheetBytes).toBeGreaterThan(0);
    expect(displayProof.matchedDictionaryRules).toBeGreaterThan(0);
    await viewer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(evidenceDir, "cc-cedict-selection.png"), fullPage: false, caret: "initial" });

    const report = {
      status: "PASS",
      mdxSha256,
      mddSha256,
      sourceBytes: { mdx: mdx.byteLength, mdd: mdd.byteLength },
      browserVersion: harness.context.browser().version(),
      importedAndReloaded: true,
      survivedPersistentBrowserRestart: true,
      query: "IP",
      backgroundLookup: backgroundProbe,
      primaryResultKind: await page.locator(".tf-selection-result").getAttribute("data-result-kind"),
      richDictionaryCardState: await card.getAttribute("data-state"),
      richDictionaryCardExpanded: await card.evaluate((node) => node.open),
      displayProof,
      selectionPageExternalRequests: selectionPageExternalRequests.length,
      providerFixtureCalls: harness.server.calls.length,
      pageErrorsObservedOnInitialOptionsAndSelectionPages: observedPageErrors.length
    };
    expect(selectionPageExternalRequests).toEqual([]);
    expect(harness.server.calls).toHaveLength(0);
    expect(observedPageErrors).toEqual([]);
    await writeFile(resolve(evidenceDir, "cc-cedict-resource-display.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log("[CC_CEDICT_REAL_RESOURCE_DISPLAY]", JSON.stringify(report));
  });
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function selectElementText(page, selector) {
  await page.locator(selector).selectText();
}

async function expandRichCard(card) {
  await expect(card).toBeVisible({ timeout: 60_000 });
  if (!await card.evaluate((node) => node.open)) await card.locator("summary").click();
  await expect(card).toHaveAttribute("data-state", "success", { timeout: 60_000 });
}
