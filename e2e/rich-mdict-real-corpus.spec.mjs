import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./support/extension-fixture.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(
  resolve(repoRoot, "lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json"),
  "utf8"
));
const mdxPath = process.env.RICH_MDICT_REAL_MDX ||
  "";
const evidenceDir = process.env.RICH_MDICT_EVIDENCE_DIR ||
  resolve(repoRoot, "test-results/rich-mdict-evidence");

test.describe("pinned real ECDICT rich MDict product gate", () => {
  test.setTimeout(12 * 60 * 1000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test.skip(!process.env.RICH_MDICT_REAL_MDX,
    "Set RICH_MDICT_REAL_MDX in the dedicated pinned-corpus compatibility gate.");

  test("Settings install survives reload, Selection shows a real record with zero Provider calls, and delete removes it", async ({ harness }) => {
    await mkdir(evidenceDir, { recursive: true });
    const packageFiles = await listFiles(harness.extensionDir);
    expect(packageFiles.filter((path) => /\.(?:mdx|mdd|zip)$/iu.test(path))).toEqual([]);
    expect(harness.buildReport.totalBytes).toBeLessThan(lock.mdx.bytes);
    const productionManifest = JSON.parse(await readFile(resolve(repoRoot, "manifest.json"), "utf8"));
    expect(productionManifest.host_permissions.some((permission) => /github\.com|githubusercontent\.com/iu.test(permission))).toBe(false);

    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装");

    const installStarted = Date.now();
    await options.locator("#richMdictFile").setInputFiles(mdxPath);
    await expect(options.locator("#richMdictInspectionMeta")).toContainText("简明英汉字典增强版");
    await expect(options.locator("#richMdictInspectionMeta")).toContainText("安全纯文本预览");
    await options.locator("#richMdictImportButton").click();
    await expect(options.locator("#richMdictImportProgress")).toContainText("完成", {
      timeout: 10 * 60 * 1000
    });
    const installMs = Date.now() - installStarted;

    let installed = options.locator("#richMdictInstalledList .site-row").filter({
      hasText: "简明英汉字典增强版"
    });
    await expect(installed).toBeVisible();
    await expect(installed).toContainText("3,402,564 条词目");
    await expect(installed).toContainText("可查词");

    await options.locator("#richMdictInstalledList").screenshot({
      path: resolve(evidenceDir, "ecdict-settings-card.png")
    });
    await options.screenshot({ path: resolve(evidenceDir, "ecdict-settings-installed.png"), fullPage: true });
    await options.reload();
    installed = options.locator("#richMdictInstalledList .site-row").filter({
      hasText: "简明英汉字典增强版"
    });
    await expect(installed).toBeVisible({ timeout: 30_000 });
    await expect(installed).toContainText("可查词");

    const corpusLookups = [];
    for (const expected of lock.independentDecode.recordExcerpts) {
      const started = Date.now();
      const lookup = await sendOptionsRuntime(options, {
        type: "RICH_MDICT_LOOKUP",
        text: expected.query
      });
      const lookupMs = Date.now() - started;
      expect(lookup.ok, expected.query).toBe(true);
      expect(lookup.found, expected.query).toBe(true);
      const record = lookup.dictionaries.find((item) =>
        item.headword.toLowerCase() === expected.headword.toLowerCase()
      );
      expect(record, expected.query).toBeTruthy();
      expect(record.text, expected.query).toContain(expected.rawRecordIncludes);
      corpusLookups.push({
        query: expected.query,
        lookupMs,
        headword: record.headword,
        excerpt: record.text.slice(0, 180),
        metrics: record.debugMetrics || null
      });
    }

    const page = await harness.open("/selection");
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "rich-ecdict-word";
      node.textContent = "run";
      document.body.appendChild(node);
    });
    await harness.inject(page);
    await selectElementText(page, "#rich-ecdict-word");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result")).toContainText("运行");
    const richViewer = page.locator(".tf-selection-rich-text .tf-rich-viewer").last();
    await expect(richViewer)
      .toContainText("n. 跑, 赛跑, 奔跑, 奔跑的路程", { timeout: 90_000 });
    await expect(page.locator(".tf-selection-rich-record")).toContainText("简明英汉字典增强版");
    expect(await page.locator(".tf-selection-result").getAttribute("data-result-kind")).toBe("local");
    expect(await page.locator(".tf-selection-result .tf-selection-primary").first().textContent()).toContain("运行");
    expect(await page.locator(".tf-selection-rich-text").last().evaluate((host) => Boolean(host.shadowRoot))).toBe(true);
    const compactPresentation = await richViewer.evaluate((root) => {
      const nodes = [...root.querySelectorAll("[data-compact-id]")];
      const forId = (id) => nodes.filter((node) => node.getAttribute("data-compact-id") === id);
      const styleOf = (node) => {
        const presentation = node?.querySelector("*") || node;
        if (!presentation) return null;
        const style = getComputedStyle(presentation);
        return {
          fontSize: Number.parseFloat(style.fontSize),
          fontWeight: style.fontWeight,
          color: style.color,
          display: style.display
        };
      };
      const headword = forId("1").find((node) => node.textContent.includes("run"));
      const pronunciation = forId("3").find((node) => node.textContent.includes("[rʌn]"));
      const note = forId("4").find((node) => node.textContent.includes("-K5"));
      return {
        ids: [...new Set(nodes.map((node) => node.getAttribute("data-compact-id")))].sort(),
        headword: headword ? styleOf(headword) : null,
        pronunciation: pronunciation ? styleOf(pronunciation) : null,
        note: note ? styleOf(note) : null,
        text: root.innerText || ""
      };
    });
    expect(compactPresentation.ids).toEqual(expect.arrayContaining(["1", "2", "3", "4"]));
    expect(compactPresentation.headword).toBeTruthy();
    expect(compactPresentation.pronunciation).toBeTruthy();
    expect(compactPresentation.note).toBeTruthy();
    expect(compactPresentation.headword.fontSize).toBeGreaterThan(15);
    expect(compactPresentation.headword.fontWeight).not.toBe("400");
    expect(compactPresentation.pronunciation.color).toBe("rgb(30, 144, 255)");
    expect(compactPresentation.note.color).toBe("rgb(119, 119, 119)");
    expect(harness.server.calls).toHaveLength(0);
    await page.locator(".tf-selection-panel").screenshot({
      path: resolve(evidenceDir, "ecdict-selection-panel.png")
    });
    await page.screenshot({ path: resolve(evidenceDir, "ecdict-selection-real-record.png"), fullPage: true });

    const listing = await sendOptionsRuntime(options, { type: "RICH_MDICT_LIST" });
    expect(listing.ok).toBe(true);
    const persisted = listing.dictionaries.find((item) => item.title === "简明英汉字典增强版");
    expect(persisted?.status).toBe("ready");
    expect(persisted?.entryCount).toBe(lock.mdx.entryCount);

    const report = {
      status: "pending-delete-verification",
      source: lock.source.releaseUrl,
      assetSha256: lock.archive.sha256,
      mdxSha256: lock.mdx.sha256,
      mdxBytes: lock.mdx.bytes,
      entryCount: persisted.entryCount,
      keyBlockCount: lock.mdx.keyBlockCount,
      recordBlockCount: lock.mdx.recordBlockCount,
      encryptedKeyInfo: lock.mdx.encrypted === 2,
      extensionPackageBytes: harness.buildReport.totalBytes,
      installMs,
      corpusLookups,
      richViewer: {
        shadowRoot: true,
        structuredPrimary: "local",
        compactPresentation,
        providerCalls: harness.server.calls.length
      },
      providerCalls: harness.server.calls.length,
      generatedAt: new Date().toISOString()
    };

    await installed.getByRole("button", { name: "删除" }).click();
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装", {
      timeout: 30_000
    });
    const afterDelete = await sendOptionsRuntime(options, { type: "RICH_MDICT_LOOKUP", text: "run" });
    expect(afterDelete.ok).toBe(true);
    expect(afterDelete.found).toBe(false);
    expect(afterDelete.dictionaries).toEqual([]);
    expect(harness.server.calls).toHaveLength(0);

    report.status = "PASS";
    report.deleted = true;
    report.providerCallsAfterDelete = harness.server.calls.length;
    report.generatedAt = new Date().toISOString();
    await writeFile(resolve(evidenceDir, "ecdict-real-corpus-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log("[RICH_MDICT_REAL_CORPUS]", JSON.stringify(report));
  });
});

async function sendOptionsRuntime(options, message) {
  return options.evaluate((input) => chrome.runtime.sendMessage(input), message);
}

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

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
