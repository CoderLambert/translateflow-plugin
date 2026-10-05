import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";

const fixtureDir = process.env.TF_LARGE_MDD_FIXTURE_DIR || "";
const evidenceDir = process.env.TF_LARGE_MDD_EVIDENCE_DIR || "/tmp/large-mdd-evidence";
const reportPath = resolve(evidenceDir, "large-mdd-browser-import.json");

test.describe("large synthetic MDD product import", () => {
  test.setTimeout(45 * 60 * 1000);
  test.skip(!fixtureDir, "Set TF_LARGE_MDD_FIXTURE_DIR to the generated synthetic MDX/MDD pair.");

  test("imports the 1.63 GB logical resource stream into OPFS and reads its tail after restart", async ({ harness }) => {
    const manifest = JSON.parse(await readFile(resolve(fixtureDir, "manifest.json"), "utf8"));
    const { mdx, mdd } = manifest.generation;
    const mdxPath = resolve(fixtureDir, mdx.file);
    const mddPath = resolve(fixtureDir, mdd.file);
    const [mdxStat, mddStat, mdxSha256, mddSha256] = await Promise.all([
      stat(mdxPath), stat(mddPath), sha256File(mdxPath), sha256File(mddPath)
    ]);
    assert.equal(mdxStat.size, mdx.bytes, "generated MDX size matches its manifest");
    assert.equal(mddStat.size, mdd.bytes, "generated MDD size matches its manifest");
    assert.equal(mdxSha256, mdx.sha256, "generated MDX hash matches its manifest");
    assert.equal(mddSha256, mdd.sha256, "generated MDD hash matches its manifest");
    assert.equal(mdd.logicalRecordBytes, 1_630_000_000);
    assert.ok(mdd.bytes > 1_400_000_000, "fixture exercises a >1.4 GB physical MDD file");

    await mkdir(evidenceDir, { recursive: true });
    const startedAt = new Date().toISOString();
    const runStarted = performance.now();
    const evidence = {
      status: "preflight",
      startedAt,
      sourceHead: harness.buildReport.sourceHead,
      artifactTreeSha256: harness.buildReport.treeSha256,
      package: {
        mdx: { file: basename(mdxPath), bytes: mdxStat.size, sha256: mdxSha256 },
        mdd: { file: basename(mddPath), bytes: mddStat.size, sha256: mddSha256 },
        totalBytes: mdxStat.size + mddStat.size,
        logicalMddRecordBytes: mdd.logicalRecordBytes,
        resourceCount: mdd.resourceCount,
        recordBlockCount: mdd.recordBlockCount,
        recordBlockRawMaxBytes: mdd.recordBlockRawMaxBytes,
        tailProbePath: mdd.tailProbePath,
        tailProbeBytes: mdd.tailProbeBytes,
        tailProbeSha256: mdd.tailProbeSha256
      },
      providerCalls: null,
      quotaBefore: null,
      preflightObservation: null,
      preflightMs: null,
      importMs: null,
      browserRestartMs: null,
      installedResource: null,
      tailProbe: null
    };
    const saveEvidence = () => writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await saveEvidence();

    const options = await harness.context.newPage();
    evidence.status = "opening-options";
    await saveEvidence();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    evidence.status = "options-open";
    evidence.quotaBefore = await options.evaluate(async () => {
      const estimate = await Promise.race([
        navigator.storage.estimate(),
        new Promise((resolve) => setTimeout(() => resolve(null), 5_000))
      ]);
      return estimate
        ? { usage: estimate.usage ?? null, quota: estimate.quota ?? null }
        : { unavailable: "storage estimate timed out after 5 seconds" };
    });
    await saveEvidence();
    evidence.status = "selecting-files";
    await saveEvidence();
    await options.locator("#localDictionaryFiles").setInputFiles([mdxPath, mddPath], { timeout: 120_000 });
    evidence.status = "file-selection-complete";
    await saveEvidence();
    const summary = options.locator("#localDictionaryPreflightSummary");
    let lastPreflight = "";
    evidence.status = "preflight-running";
    await saveEvidence();
    await expect.poll(async () => {
      const observation = await options.evaluate(() => {
        const node = document.querySelector("#localDictionaryPreflightSummary");
        return {
          status: node?.dataset.status || "",
          summary: (node?.innerText || "").slice(0, 1200),
          importEnabled: !document.querySelector("#localDictionaryImportButton")?.disabled,
          has196MddResources: (node?.innerText || "").includes("synthetic-large.mdd（196 项）")
        };
      });
      const serialized = JSON.stringify(observation);
      if (serialized !== lastPreflight) {
        lastPreflight = serialized;
        evidence.preflightObservation = observation;
        await saveEvidence();
        console.log("[LARGE_MDD_PREFLIGHT]", serialized);
      }
      return {
        title: observation.summary.includes("TranslateFlow Large Synthetic Package Fixture"),
        associatedMdd: observation.summary.includes("将关联的 MDD"),
        importEnabled: observation.importEnabled,
        has196MddResources: observation.has196MddResources
      };
    }, { timeout: 5 * 60 * 1000, intervals: [1_000, 3_000, 10_000] })
      .toMatchObject({ title: true, associatedMdd: true, importEnabled: true, has196MddResources: true });
    evidence.preflightMs = Math.round(performance.now() - runStarted);
    evidence.status = "ready-to-import";
    await saveEvidence();

    const importStarted = performance.now();
    await options.locator("#localDictionaryImportButton").click();
    const progress = options.locator("#localDictionaryImportProgress");
    const transitions = [];
    let lastProgress = "";
    evidence.status = "importing";
    await saveEvidence();
    await expect.poll(async () => {
      const value = (await progress.textContent())?.trim() || "";
      if (value && value !== lastProgress) {
        lastProgress = value;
        transitions.push(value.slice(0, 240));
        evidence.progressTransitions = transitions;
        evidence.currentProgress = value.slice(0, 240);
        await saveEvidence();
        console.log("[LARGE_MDD_PROGRESS]", value.slice(0, 240));
      }
      return value;
    }, { timeout: 35 * 60 * 1000, intervals: [1_000, 3_000, 10_000] }).toMatch(/完成|安装失败/u);
    evidence.importMs = Math.round(performance.now() - importStarted);
    evidence.progressTransitions = transitions;
    const progressText = await progress.textContent();
    if (!progressText?.includes("完成")) {
      evidence.status = "import-failed";
      evidence.error = progressText || "Import ended without a completion message.";
      await saveEvidence();
      throw new Error(`Large synthetic MDD import failed: ${evidence.error}`);
    }

    let installed = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({
      hasText: "TranslateFlow Large Synthetic Package Fixture"
    });
    await expect(installed).toBeVisible({ timeout: 60_000 });
    await expect(installed).toContainText("1 个 MDD 文件", { timeout: 60_000 });
    evidence.status = "installed";
    evidence.providerCalls = harness.server.calls.length;
    evidence.installedResource = await installed.evaluate((node) => ({
      id: node.getAttribute("data-dictionary-id"),
      text: (node.innerText || "").slice(0, 1200)
    }));
    await saveEvidence();

    const restartStarted = performance.now();
    await harness.restartBrowser();
    evidence.browserRestartMs = Math.round(performance.now() - restartStarted);
    const restoredOptions = await harness.context.newPage();
    await restoredOptions.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    installed = restoredOptions.locator("#richMdictInstalledList [data-dictionary-id]").filter({
      hasText: "TranslateFlow Large Synthetic Package Fixture"
    });
    await expect(installed).toBeVisible({ timeout: 60_000 });
    await expect(installed).toContainText("可用", { timeout: 60_000 });

    const dictionaryId = await installed.getAttribute("data-dictionary-id");
    const page = await harness.open("/selection");
    await harness.inject(page);
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "large-mdd-fixture-word";
      node.textContent = "largepackageprobe";
      document.body.appendChild(node);
    });
    await selectElementText(page, "#large-mdd-fixture-word");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();
    const card = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
    await expandRichCard(card);
    const viewer = card.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(viewer).toContainText("SYNTHETIC LARGE PACKAGE", { timeout: 30_000 });
    const viewerImage = viewer.locator("img.tf-rich-resource-image[src^='blob:']");
    await expect(viewerImage).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => viewerImage.evaluate((image) => image.naturalWidth)).toBe(2);
    const response = await readMddResource(harness, page, dictionaryId, mdd.tailProbePath);
    expect(response.ok).toBe(true);
    expect(response.found).toBe(true);
    expect(response.mime).toBe("image/png");
    const tailBytes = Buffer.from(response.base64, "base64");
    expect(tailBytes.byteLength).toBe(mdd.tailProbeBytes);
    const tailSha256 = createHash("sha256").update(tailBytes).digest("hex");
    expect(tailSha256).toBe(mdd.tailProbeSha256);
    evidence.tailProbe = {
      path: mdd.tailProbePath,
      found: true,
      mime: response.mime,
      bytes: tailBytes.byteLength,
      sha256: tailSha256
    };
    evidence.quotaAfterRestart = await restoredOptions.evaluate(async () => {
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
    });
    evidence.status = "PASS";
    evidence.providerCalls = harness.server.calls.length;
    evidence.completedAt = new Date().toISOString();
    await saveEvidence();
    expect(harness.server.calls).toHaveLength(0);
    console.log("[LARGE_MDD_E2E]", JSON.stringify({ reportPath, ...evidence }));
  });
});

async function sha256File(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
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

async function selectElementText(page, selector) {
  await page.locator(selector).evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  });
}

async function expandRichCard(card) {
  await expect(card).toBeVisible({ timeout: 30_000 });
  if (!await card.evaluate((node) => node.open)) await card.locator("summary").click();
  await expect(card).toHaveAttribute("data-state", "success", { timeout: 30_000 });
}
