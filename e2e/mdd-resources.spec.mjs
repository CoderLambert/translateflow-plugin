import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { makeMdd } from "../tests/helpers/mdd-fixture.mjs";
import { test, expect } from "./support/extension-fixture.mjs";
import { readMddAudio526Fixture, readMddInteropFixture, readMddLinkedPackageFixture } from "../tests/helpers/mdd-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { buildRichMdictIndex, lookupRichMdict } from "../src/background/packs/importers/mdict-rich.js";

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
      expect(response.ok, `${expected.path}: ${JSON.stringify(response)}`).toBe(true);
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
    // A full-page Chromium capture clears the live selection and tears down this panel.
    await page.screenshot({ path: resolve(evidenceDir, "mdd-resources-dark-narrow.png"), fullPage: false, caret: "initial" });

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

  test("wide synthetic screenshot shows the actual rich viewer definition, media, and fragment jump", async ({ harness }) => {
    const mdd = makeMdd([
      ["\\interop\\sample.png", makeDemoPng()],
      ["\\interop\\tone.wav", makeDemoWav()]
    ], { title: "Synthetic Visual Resource Fixture" });
    const visualRecord = [
      '<div class="mdd-note">',
      '<p><b>SYNTHETIC SAMPLE</b> — Definition: local demo. <a href="#usage">Usage jump</a> <span id="usage">Example.</span></p>',
      '<img alt="Synthetic local illustration" src="interop/sample.png">',
      '<audio title="Synthetic pronunciation" src="interop/tone.wav"></audio>',
      '</div>'
    ].join("");
    const mdx = makeRichMdx([["visualdemo", visualRecord]], {
      title: "Synthetic Rich Viewer Screenshot Fixture"
    });
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "visualdemo.mdx", mimeType: "application/octet-stream", buffer: mdx
    });
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("Synthetic Rich Viewer Screenshot Fixture");
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });
    const row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({
      hasText: "Synthetic Rich Viewer Screenshot Fixture"
    });
    await expect(row).toBeVisible();
    const dictionaryId = await row.getAttribute("data-dictionary-id");
    await attachMddFile(row, {
      name: "visualdemo.mdd", mimeType: "application/octet-stream", buffer: mdd
    }, { success: true });

    const page = await harness.open("/selection");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => {
      document.title = "Synthetic reading page";
      document.body.replaceChildren();
      const heading = document.createElement("h1");
      heading.textContent = "Synthetic reading page";
      const context = document.createElement("p");
      context.append("Select ");
      const selected = document.createElement("span");
      selected.id = "visual-demo-word";
      selected.textContent = "visualdemo";
      context.append(selected, " to view the local dictionary example.");
      document.body.append(heading, context);
    });
    await harness.inject(page);
    await selectElementText(page, "#visual-demo-word");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();
    const card = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
    await expandRichCard(card);
    const viewer = card.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(viewer).toContainText("SYNTHETIC SAMPLE");
    await expect(viewer).toContainText("Definition: local demo.");
    const image = viewer.locator("img.tf-rich-resource-image[src^='blob:']");
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBe(240);
    const audioButton = viewer.locator("button[data-action='load-mdd-audio']");
    await expect(audioButton).toBeVisible();
    await audioButton.click();
    const audio = viewer.locator("audio.tf-rich-resource-audio[src^='blob:']");
    await expect(audio).toBeVisible({ timeout: 30_000 });
    const fragmentLink = viewer.locator("button[data-rich-fragment-target='usage']");
    await expect(fragmentLink).toContainText("Usage jump");
    await fragmentLink.click();
    await expect.poll(() => viewer.evaluate((root) => {
      return root.getRootNode().activeElement?.getAttribute("data-rich-target-id") === "usage";
    })).toBe(true);
    await expect(viewer).toContainText("Example.");

    const screenshotPath = resolve(process.env.TF_RICH_DICTIONARY_SCREENSHOT || "/tmp/translateflow-rich-dictionary-demo.png");
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false, caret: "initial" });
    console.log("[RICH_VIEWER_SCREENSHOT]", JSON.stringify({
      status: "PASS",
      screenshotPath,
      testedSourceHead: harness.buildReport.sourceHead,
      artifactTreeSha256: harness.buildReport.treeSha256,
      viewport: [1440, 900],
      syntheticContentMarker: "SYNTHETIC SAMPLE",
      definitionVisible: true,
      imageLoaded: true,
      audioLoadedOnClick: true,
      fragmentJumpVerified: true,
      providerCalls: harness.server.calls.length
    }));
    await page.getByRole("button", { name: "关闭" }).click();
  });

  test("offscreen tall MDD image keeps the viewer scroll position and reloads on return", async ({ harness }) => {
    const { mdx } = await readMddInteropFixture();
    const tallMdd = makeMdd([
      ["\\interop\\sample.png", makeDemoPng({ height: 600 })]
    ], { title: "Synthetic Tall Image Scroll Fixture" });
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles([
      { name: "interop.mdx", mimeType: "application/octet-stream", buffer: mdx },
      { name: "interop.mdd", mimeType: "application/octet-stream", buffer: tallMdd }
    ]);
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("TranslateFlow MDD Interop Fixture");
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });

    const row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({ hasText: "TranslateFlow MDD Interop Fixture" });
    await expect(row).toBeVisible();
    const dictionaryId = await row.getAttribute("data-dictionary-id");
    await attachMddFile(row, {
      name: "interop.mdd", mimeType: "application/octet-stream", buffer: tallMdd
    }, { success: true });

    const page = await harness.open("/selection");
    await harness.inject(page);
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "tall-image-scroll-fixture-word";
      node.textContent = "mddinteropfixture";
      document.body.appendChild(node);
    });
    await selectElementText(page, "#tall-image-scroll-fixture-word");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();
    const card = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
    await expandRichCard(card);
    const viewer = card.locator(".tf-selection-rich-text .tf-rich-viewer");
    const image = viewer.locator("img.tf-rich-resource-image[src^='blob:']");
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => image.evaluate((node) => node.naturalHeight)).toBe(600);

    const layoutBeforeUnload = await viewer.evaluate((root) => {
      const currentImage = root.querySelector("img.tf-rich-resource-image");
      const tail = document.createElement("p");
      tail.dataset.testScrollTail = "true";
      tail.textContent = "TAIL_AFTER_TALL_IMAGE";
      tail.style.height = "600px";
      tail.style.margin = "0";
      currentImage.after(tail);
      const imageBottom = currentImage.getBoundingClientRect().bottom - root.getBoundingClientRect().top + root.scrollTop;
      root.scrollTop = imageBottom + 10;
      const tailRect = tail.getBoundingClientRect();
      return {
        scrollHeight: root.scrollHeight,
        scrollTop: root.scrollTop,
        tailTop: tailRect.top - root.getBoundingClientRect().top,
        tailText: tail.textContent,
        imageTop: currentImage.getBoundingClientRect().top - root.getBoundingClientRect().top
      };
    });
    expect(layoutBeforeUnload.imageTop).toBeLessThan(-200);
    expect(layoutBeforeUnload.tailText).toBe("TAIL_AFTER_TALL_IMAGE");
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(0);
    const layoutAfterUnload = await viewer.evaluate((root) => {
      const currentImage = root.querySelector("img.tf-rich-resource-image");
      const tail = root.querySelector("[data-test-scroll-tail]");
      const tailRect = tail.getBoundingClientRect();
      return {
        scrollHeight: root.scrollHeight,
        scrollTop: root.scrollTop,
        tailTop: tailRect.top - root.getBoundingClientRect().top,
        imageWidth: currentImage.width,
        imageHeight: currentImage.height,
        imageHasSource: currentImage.hasAttribute("src"),
        imageVisibility: currentImage.style.visibility
      };
    });
    expect(layoutAfterUnload.scrollHeight).toBe(layoutBeforeUnload.scrollHeight);
    expect(layoutAfterUnload.scrollTop).toBe(layoutBeforeUnload.scrollTop);
    expect(layoutAfterUnload.tailTop).toBe(layoutBeforeUnload.tailTop);
    expect(layoutAfterUnload).toMatchObject({ imageWidth: 240, imageHeight: 600, imageHasSource: false, imageVisibility: "hidden" });

    await viewer.evaluate((root) => { root.scrollTop = 0; });
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => image.evaluate((node) => node.naturalHeight)).toBe(600);
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(1);
    const layoutAfterReturn = await viewer.evaluate((root) => ({ scrollHeight: root.scrollHeight, scrollTop: root.scrollTop }));
    expect(layoutAfterReturn.scrollHeight).toBe(layoutBeforeUnload.scrollHeight);
    expect(layoutAfterReturn.scrollTop).toBe(0);
    expect(harness.server.calls).toHaveLength(0);

    console.log("[RICH_TALL_IMAGE_SCROLL_E2E]", JSON.stringify({
      status: "PASS",
      testedSourceHead: harness.buildReport.sourceHead,
      artifactTreeSha256: harness.buildReport.treeSha256,
      existingMdxFixture: "tests/fixtures/mdd-interop/interop.mdx",
      testImage: { width: 240, height: 600 },
      layoutBeforeUnload,
      layoutAfterUnload,
      layoutAfterReturn,
      blobUrlsAfterUnload: 0,
      blobUrlsAfterReturn: 1,
      providerCalls: harness.server.calls.length
    }));
    await page.getByRole("button", { name: "关闭" }).click();
  });

  test("selecting MDX and its MDD together installs one linked offline dictionary", async ({ harness }) => {
    const { mdx, mdd } = await readMddInteropFixture();
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles([
      { name: "interop.mdx", mimeType: "application/octet-stream", buffer: mdx },
      { name: "interop.mdd", mimeType: "application/octet-stream", buffer: mdd }
    ]);

    const summary = options.locator("#localDictionaryPreflightSummary");
    await expect(summary).toContainText("TranslateFlow MDD Interop Fixture");
    await expect(summary).toContainText("将关联的 MDD");
    await expect(summary).toContainText("interop.mdd");
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", {
      timeout: 60_000
    });

    let row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({
      hasText: "TranslateFlow MDD Interop Fixture"
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText("1 个 MDD 文件");
    const dictionaryId = await row.getAttribute("data-dictionary-id");
    expect(dictionaryId).toMatch(/^rich-mdict-/u);

    await options.reload();
    row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({
      hasText: "TranslateFlow MDD Interop Fixture"
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText("1 个 MDD 文件");

    const resourceProbe = await harness.open("/selection");
    await harness.inject(resourceProbe);
    for (const expected of lock.generation.resources) {
      const response = await readMddResource(harness, resourceProbe, dictionaryId, expected.path);
      expect(response.ok, expected.path).toBe(true);
      expect(response.found, expected.path).toBe(true);
      expect(response.mime, expected.path).toBe(expected.mime);
      const bytes = Buffer.from(response.base64, "base64");
      expect(bytes.byteLength, expected.path).toBe(expected.bytes);
      expect(sha256(bytes), expected.path).toBe(expected.sha256);
    }
    expect(harness.server.calls).toHaveLength(0);
    console.log("[MDD_FILESET_E2E]", JSON.stringify({
      status: "PASS",
      purpose: lock.purpose,
      writerCommit: lock.independentWriter.commit,
      selectedMdxAndMddAsSingleGroup: true,
      attachedResourceCount: lock.generation.resources.length,
      exactResourceBytesAndHashesMatched: true,
      persistedAcrossOptionsReload: true,
      providerCalls: harness.server.calls.length
    }));
    await resourceProbe.close();
  });

  test("long rich record keeps its tail and lazy single-slot audio over an independent MDD fixture", async ({ harness }) => {
    await mkdir(evidenceDir, { recursive: true });
    const { mdd, lock: audioFixtureLock } = await readMddAudio526Fixture();
    const audioPaths = audioFixtureLock.generation.distinctAudioPaths;
    expect(audioPaths).toHaveLength(526);
    expect(new Set(audioPaths).size).toBe(526);
    const repeatedNodes = "<span>x</span>".repeat(15_000);
    const repeatedResources = audioPaths.map((path) => {
      const name = path.split("/").at(-1);
      return `<audio aria-label="${name}" src="${path}"/>`;
    }).join("") + '<img src="interop/sample.png" alt="lazy sample"/>';
    const prefix = `<div>BEGIN${repeatedNodes}${repeatedResources}`;
    const suffix = "<p>TAIL_SENTINEL</p></div>";
    const fillerBytes = 778_100 - prefix.length - suffix.length - 7;
    const rawRecord = `${prefix}<!--${"x".repeat(fillerBytes)}-->${suffix}`;
    expect(Buffer.byteLength(rawRecord, "utf8")).toBe(778_100);
    const mdx = makeRichMdx([["longrecordfixture", rawRecord]], { title: "Bounded Long Record Fixture" });

    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "longrecordfixture.mdx", mimeType: "application/octet-stream", buffer: mdx
    });
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("Bounded Long Record Fixture");
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });
    const row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({ hasText: "Bounded Long Record Fixture" });
    await expect(row).toBeVisible();
    const dictionaryId = await row.getAttribute("data-dictionary-id");
    await attachMddFile(row, {
      name: "longrecordfixture.mdd", mimeType: "application/octet-stream", buffer: mdd
    }, { success: true });

    const page = await harness.open("/selection");
    const remoteRequests = [];
    const browserErrors = [];
    page.on("request", (request) => {
      if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) remoteRequests.push(request.url());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "long-record-fixture-word";
      node.textContent = "longrecordfixture";
      document.body.appendChild(node);
    });
    await harness.inject(page);
    await selectElementText(page, "#long-record-fixture-word");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();
    const card = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
    await expandRichCard(card);
    const viewer = card.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(viewer).toContainText("TAIL_SENTINEL", { timeout: 30_000 });
    const audioLoaders = viewer.locator("button[data-action='load-mdd-audio']");
    await expect(audioLoaders).toHaveCount(526);
    await expect(viewer.locator("audio")).toHaveCount(0);
    await expect(viewer.locator("img.tf-rich-resource-image[src^='blob:']")).toHaveCount(0);
    expect(await activeObjectUrlCount(harness, page)).toBe(0);
    for (const index of [0, 262, 525]) {
      const audioName = `tone-${String(index).padStart(3, "0")}.wav`;
      await expect(viewer.locator(`button[data-action='load-mdd-audio'][aria-label*='${audioName}']`)).toHaveCount(1);
    }

    await viewer.locator("button[data-action='load-mdd-audio'][aria-label*='tone-000.wav']").click();
    let audio = viewer.locator("audio.tf-rich-resource-audio[src^='blob:']");
    await expect(audio).toHaveCount(1, { timeout: 30_000 });
    await expect(audio).toHaveAttribute("preload", "none");
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(1);
    await viewer.locator("button[data-action='load-mdd-audio'][aria-label*='tone-262.wav']").click();
    await expect(viewer.locator("audio.tf-rich-resource-audio[src^='blob:']")).toHaveCount(1);
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(1);
    await expect(viewer.locator("button[data-action='load-mdd-audio']")).toHaveCount(525);
    await expect(viewer.locator("img.tf-rich-resource-image[src^='blob:']")).toHaveCount(0);
    await viewer.locator("button[data-action='load-mdd-audio'][aria-label*='tone-000.wav']").click();
    audio = viewer.locator("audio.tf-rich-resource-audio[src^='blob:']");
    await expect(audio).toHaveCount(1);
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(1);
    await viewer.locator("button[data-action='load-mdd-audio'][aria-label*='tone-525.wav']").click();
    await expect(viewer.locator("audio.tf-rich-resource-audio[src^='blob:']")).toHaveCount(1);
    const urlsAfterLastAudioSwitch = await activeObjectUrlCount(harness, page);
    expect(urlsAfterLastAudioSwitch).toBeGreaterThanOrEqual(1);
    expect(urlsAfterLastAudioSwitch).toBeLessThanOrEqual(2, "the one audio URL may coexist with the lazy image after it enters view");
    expect(await audio.getAttribute("autoplay")).toBeNull();
    await viewer.evaluate((root) => { root.scrollTop = root.scrollHeight; });
    const lazyImage = viewer.locator("img.tf-rich-resource-image[src^='blob:']");
    await expect(lazyImage).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => lazyImage.evaluate((node) => node.naturalWidth)).toBe(2);
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(2);
    expect(await harness.server.calls).toHaveLength(0);
    expect(remoteRequests).toEqual([]);
    expect(browserErrors).toEqual([]);

    await page.getByRole("button", { name: "关闭" }).click();
    await expect(page.locator(".tf-selection-panel")).toBeHidden();
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(0);
    const report = {
      status: "PASS",
      fixture: "778100-byte-synthetic-record-with-independent-writemdict-mdd",
      testedSourceHead: harness.buildReport.sourceHead,
      artifactTreeSha256: harness.buildReport.treeSha256,
      independentMddWriterCommit: lock.independentWriter.commit,
      distinctAudioResourcePaths: audioPaths.length,
      audioFixtureMddBytes: mdd.byteLength,
      audioFixtureMddSha256: audioFixtureLock.generation.mdd.sha256,
      rawRecordBytes: Buffer.byteLength(rawRecord, "utf8"),
      tailSentinelRendered: true,
      repeatedAudioReferences: 526,
      allAudioReferencesUseDistinctMddPaths: new Set(audioPaths).size === 526,
      audioRequestedOnClickOnly: true,
      firstMiddleLastAudioControlsLoaded: true,
      offscreenImageLoadedOnlyAfterScrolling: true,
      activeAudioSlotCount: 1,
      previousAudioCanBeSelectedAgain: true,
      objectUrlsAfterViewerClose: await activeObjectUrlCount(harness, page),
      providerCalls: harness.server.calls.length,
      remoteRequests: remoteRequests.length,
      browserErrors,
      generatedAt: new Date().toISOString()
    };
    await writeFile(resolve(evidenceDir, "rich-long-record-resources-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log("[RICH_LONG_RECORD_RESOURCES_E2E]", JSON.stringify(report));
  });

  test("UTF-16 record keeps separate source and decoded sizes through selection lookup and viewer", async ({ harness }) => {
    await mkdir(evidenceDir, { recursive: true });
    const record = `<div>${"漢".repeat(400_000)}<span>UTF16_TAIL_SENTINEL</span></div>`;
    const mdx = makeRichMdx([["utf16fixture", record]], {
      title: "UTF-16 Rich Record Fixture",
      encoding: "UTF-16"
    });
    const source = {
      size: mdx.byteLength,
      async read(offset, length) { return new Uint8Array(mdx.subarray(offset, offset + length)); }
    };
    const index = await buildRichMdictIndex({ source });
    const decoded = await lookupRichMdict({ source, index, text: "utf16fixture" });
    expect(decoded.found).toBe(true);
    expect(decoded.sourceRecordBytes).toBeGreaterThan(800_000);
    expect(decoded.sourceRecordBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(decoded.decodedTextBytes).toBe(Buffer.byteLength(record, "utf8"));
    expect(decoded.decodedTextBytes).toBeGreaterThan(1024 * 1024);
    expect(decoded.rawRecord).toContain("UTF16_TAIL_SENTINEL");

    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "utf16-record.mdx", mimeType: "application/octet-stream", buffer: mdx
    });
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("UTF-16 Rich Record Fixture");
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });
    const row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({ hasText: "UTF-16 Rich Record Fixture" });
    await expect(row).toBeVisible();
    const dictionaryId = await row.getAttribute("data-dictionary-id");

    const page = await harness.open("/selection");
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "utf16-rich-fixture-word";
      node.textContent = "utf16fixture";
      document.body.appendChild(node);
    });
    await harness.inject(page);
    const lookupMessage = await readRichMdictLookup(harness, page, dictionaryId, "utf16fixture");
    const messageDictionaries = lookupMessage?.dictionaries || lookupMessage?.data?.dictionaries || [];
    const messageDictionary = messageDictionaries.find((item) => item.id === dictionaryId) || messageDictionaries[0];
    const messageRecord = messageDictionary?.richRecord;
    console.log("[RICH_UTF16_LOOKUP_MESSAGE]", JSON.stringify({
      responseKeys: Object.keys(lookupMessage || {}),
      ok: lookupMessage?.ok,
      found: lookupMessage?.found,
      dictionaryCount: messageDictionaries.length,
      dictionaryKeys: Object.keys(messageDictionary || {}),
      dictionaryId: messageDictionary?.id,
      richRecordKeys: Object.keys(messageRecord || {}),
      sourceBytes: messageRecord?.sourceBytes,
      textBytes: messageRecord?.textBytes,
      rawChars: messageRecord?.rawRecord?.length,
      rawTail: messageRecord?.rawRecord?.slice(-48),
      hasSentinel: Boolean(messageRecord?.rawRecord?.includes("UTF16_TAIL_SENTINEL")),
      errors: lookupMessage?.errors?.map((item) => ({ code: item.code, message: item.message }))
    }));
    expect(lookupMessage?.ok).toBe(true);
    expect(messageRecord?.sourceBytes).toBe(decoded.sourceRecordBytes);
    expect(messageRecord?.textBytes).toBe(decoded.decodedTextBytes);
    expect(messageRecord?.rawRecord?.includes("UTF16_TAIL_SENTINEL")).toBe(true);
    await selectElementText(page, "#utf16-rich-fixture-word");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();
    const card = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
    await expandRichCard(card);
    const viewer = card.locator(".tf-selection-rich-text .tf-rich-viewer");
    const renderedMetrics = await viewer.evaluate((root) => {
      const text = root.textContent || "";
      return {
        textChars: text.length,
        tail: text.slice(-48),
        hasSentinel: text.includes("UTF16_TAIL_SENTINEL"),
        truncated: Boolean(root.querySelector(".tf-rich-truncated"))
      };
    });
    console.log("[RICH_UTF16_RENDERED_METRICS]", JSON.stringify(renderedMetrics));
    expect(renderedMetrics.hasSentinel, JSON.stringify(renderedMetrics)).toBe(true);
    await expect(viewer.locator(".tf-rich-truncated")).toHaveCount(0);

    const report = {
      status: "PASS",
      testedSourceHead: harness.buildReport.sourceHead,
      artifactTreeSha256: harness.buildReport.treeSha256,
      sourceEncoding: "UTF-16LE",
      sourceRecordBytes: decoded.sourceRecordBytes,
      decodedTextBytes: decoded.decodedTextBytes,
      messageSourceBytes: messageRecord.sourceBytes,
      messageTextBytes: messageRecord.textBytes,
      tailSentinelRendered: true,
      truncationNoticeCount: 0,
      providerCalls: harness.server.calls.length,
      generatedAt: new Date().toISOString()
    };
    await writeFile(resolve(evidenceDir, "rich-utf16-message-viewer-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log("[RICH_UTF16_MESSAGE_VIEWER_E2E]", JSON.stringify(report));
    await page.getByRole("button", { name: "关闭" }).click();
  });

  test("six-file MDX/MDD package keeps sidecars versioned across a real browser restart", async ({ harness }) => {
    await mkdir(evidenceDir, { recursive: true });
    const files = await readMddLinkedPackageFixture();
    const packageLock = JSON.parse(await readFile(
      new URL("../tests/fixtures/mdd-linked-package/corpus-lock.json", import.meta.url), "utf8"
    ));
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles([
      ...Object.entries(files).map(([name, buffer]) => ({ name, mimeType: "application/octet-stream", buffer }))
    ]);
    const summary = options.locator("#localDictionaryPreflightSummary");
    await expect(summary).toContainText("TranslateFlow Linked MDD Package Fixture");
    await expect(summary).toContainText("linked-package.1.mdd");
    await expect(summary).toContainText("fixture.css");
    await expect(summary).toContainText("sample.png");
    await expect(summary).toContainText("tone.wav");
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });

    const row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({
      hasText: "TranslateFlow Linked MDD Package Fixture"
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText("2 个 MDD 文件");
    const dictionaryId = await row.getAttribute("data-dictionary-id");
    expect(dictionaryId).toMatch(/^rich-mdict-/u);

    const resourceProbe = await harness.open("/selection");
    await harness.inject(resourceProbe);
    let packageVersion = await readRichPackageVersion(harness, resourceProbe, dictionaryId);
    expect(packageVersion).toMatch(/^import-/u);
    const sourceHashes = {};
    const assetResponses = {};
    for (const expected of packageLock.resources) {
      const response = await readMddResource(harness, resourceProbe, dictionaryId, expected.path, packageVersion);
      expect(response.ok, `${expected.path}: ${JSON.stringify(response)}`).toBe(true);
      expect(response.found, expected.path).toBe(true);
      expect(response.packageVersion, expected.path).toBe(packageVersion);
      expect(response.mime, expected.path).toBe(expected.mime);
      expect(response.sourceKind, expected.path).toBe("sidecar");
      expect(response.sourceSha256, expected.path).toBe(expected.sha256);
      const data = Buffer.from(response.base64, "base64");
      expect(data.byteLength, expected.path).toBe(expected.bytes);
      expect(sha256(data), expected.path).toBe(expected.sha256);
      expect(response.diagnostics || []).toContain("resource.sidecar_overrode_mdd");
      assetResponses[expected.path] = response;
      sourceHashes[expected.path] = sha256(data);
    }
    const cssResponse = assetResponses["fixture.css"];
    expect(cssResponse.safeCss).toContain(".tf-rich-viewer .mdd-note");
    expect(cssResponse.safeCss).toContain("tfasset0");
    expect(cssResponse.safeCss).not.toMatch(/attacker\.invalid|@import|#outside\s*\{/iu);
    const stale = await readMddResource(harness, resourceProbe, dictionaryId, "sample.png", "import-stale-923e4567");
    expect(stale.found).toBe(false);
    expect(stale.stale).toBe(true);
    expect(stale.packageVersion).toBe(packageVersion);
    await resourceProbe.close();

    const page = await harness.open("/selection");
    await page.setViewportSize({ width: 360, height: 720 });
    const remoteRequests = [];
    const browserErrors = [];
    page.on("request", (request) => {
      if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) remoteRequests.push(request.url());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "mdd-linked-package-word";
      node.textContent = "linkedpackagefixture";
      document.body.appendChild(node);
    });
    await harness.inject(page);
    await selectElementText(page, "#mdd-linked-package-word");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    let card = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
    await expandRichCard(card);
    let viewer = card.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(viewer).toContainText("Synthetic linked package resources.", { timeout: 30_000 });
    let image = viewer.locator("img.tf-rich-resource-image[src^='blob:']");
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => image.evaluate((node) => [node.naturalWidth, node.naturalHeight])).toEqual([3, 2]);
    const cssComputed = await viewer.evaluate((node) => {
      const note = node.querySelector(".mdd-note");
      const highlight = node.querySelector(".mdd-highlight");
      const badge = node.querySelector(".mdd-badge");
      return {
        noteColor: note ? getComputedStyle(note).color : "",
        highlightColor: highlight ? getComputedStyle(highlight).backgroundColor : "",
        badgeBackground: badge ? getComputedStyle(badge).backgroundImage : ""
      };
    });
    expect(cssComputed.noteColor).toBe("rgb(47, 93, 80)");
    expect(cssComputed.highlightColor).toBe("rgb(248, 239, 191)");
    expect(cssComputed.badgeBackground).toMatch(/^url\("?blob:/u);

    const jump = viewer.locator("button[data-rich-fragment-target='media-anchor']");
    await expect(jump).toBeVisible();
    await jump.click();
    await expect.poll(() => viewer.evaluate((node) => node.getRootNode().activeElement?.dataset.richTargetId || "")).toBe("media-anchor");
    const audioLoader = viewer.locator("button[data-action='load-mdd-audio']");
    await expect(audioLoader).toBeVisible();
    await audioLoader.click();
    const audio = viewer.locator("audio.tf-rich-resource-audio[src^='blob:']");
    await expect(audio).toBeVisible({ timeout: 30_000 });
    await audio.evaluate((node) => node.addEventListener("play", () => { node.dataset.e2ePlayEvent = "true"; }, { once: true }));
    await audio.scrollIntoViewIfNeeded();
    const audioBox = await audio.boundingBox();
    expect(audioBox).toBeTruthy();
    await page.mouse.click(audioBox.x + 16, audioBox.y + Math.max(16, audioBox.height / 2));
    await expect.poll(() => audio.getAttribute("data-e2e-play-event"), { timeout: 5_000 }).toBe("true");
    expect(await page.evaluate(() => window.__mddLinkedPackageExecuted || false)).toBe(false);
    expect(remoteRequests).toEqual([]);
    expect(harness.server.calls).toHaveLength(0);
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(3);

    const restart = await harness.restartBrowser();
    expect(restart.restartedPersistentProfile).toBe(true);
    let revisited = await harness.open("/selection");
    await revisited.setViewportSize({ width: 360, height: 720 });
    const revisitRemoteRequests = [];
    revisited.on("request", (request) => {
      if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) revisitRemoteRequests.push(request.url());
    });
    await revisited.evaluate(() => {
      const node = document.createElement("p");
      node.id = "mdd-linked-package-word";
      node.textContent = "linkedpackagefixture";
      document.body.appendChild(node);
    });
    await harness.inject(revisited);
    await selectElementText(revisited, "#mdd-linked-package-word");
    const revisitChip = revisited.locator(".tf-selection-chip");
    await expect(revisitChip).toBeVisible({ timeout: 10_000 });
    await revisitChip.scrollIntoViewIfNeeded();
    await revisitChip.click();
    card = revisited.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
    await expandRichCard(card);
    viewer = card.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(viewer).toContainText("Synthetic linked package resources.", { timeout: 30_000 });
    image = viewer.locator("img.tf-rich-resource-image[src^='blob:']");
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBe(3);
    expect(await viewer.evaluate((node) => getComputedStyle(node.querySelector(".mdd-note")).color)).toBe("rgb(47, 93, 80)");
    const packageVersionAfterRestart = await readRichPackageVersion(harness, revisited, dictionaryId);
    expect(packageVersionAfterRestart).toBe(packageVersion);
    const persistedAudio = await readMddResource(harness, revisited, dictionaryId, "tone.wav", packageVersion);
    expect(persistedAudio.found).toBe(true);
    expect(persistedAudio.sourceSha256).toBe(packageLock.resources.find((item) => item.path === "tone.wav").sha256);
    expect(revisitRemoteRequests).toEqual([]);
    expect(harness.server.calls).toHaveLength(0);
    expect(await revisited.evaluate(() => window.__mddLinkedPackageExecuted || false)).toBe(false);

    const optionsAfterRestart = await harness.context.newPage();
    await optionsAfterRestart.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const persistedRow = optionsAfterRestart.locator(`#richMdictInstalledList [data-dictionary-id="${dictionaryId}"]`);
    await expect(persistedRow).toBeVisible();
    await persistedRow.getByRole("button", { name: "删除" }).click();
    await expect(optionsAfterRestart.locator("#richMdictInstalledList")).toContainText("尚未安装", { timeout: 30_000 });
    const afterDelete = await readMddResource(harness, revisited, dictionaryId, "sample.png", packageVersion);
    expect(afterDelete.ok).toBe(true);
    expect(afterDelete.found).toBe(false);
    expect(await activeObjectUrlCount(harness, revisited)).toBe(0);

    const report = {
      status: "PASS",
      fixturePurpose: packageLock.purpose,
      independentWriterCommit: packageLock.independentWriter.commit,
      packageFiles: packageLock.files,
      selectedAllSixPackageFiles: true,
      mddVolumes: 2,
      sidecars: packageLock.resources.map((item) => ({ path: item.path, sha256: item.sha256 })),
      sourceHashes,
      sidecarsWonConflictingMddResources: true,
      stylesheetAstWasScopedAndRemoteRulesDropped: true,
      cssImageSlotsResolvedToLocalBlob: true,
      fragmentJumpTarget: "media-anchor",
      audioPlaybackEvent: "play",
      realPersistentContextRestart: restart.restartedPersistentProfile,
      packageVersionPersisted: packageVersionAfterRestart,
      resourceHashesPersisted: true,
      remoteRequests: remoteRequests.length + revisitRemoteRequests.length,
      providerCalls: harness.server.calls.length,
      deletedAfterRestart: true,
      objectUrlsAfterDelete: await activeObjectUrlCount(harness, revisited),
      browserErrors,
      testedSourceHead: harness.buildReport.sourceHead,
      artifactTreeSha256: harness.buildReport.treeSha256,
      generatedAt: new Date().toISOString()
    };
    expect(browserErrors).toEqual([]);
    await writeFile(resolve(evidenceDir, "mdd-linked-package-e2e-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log("[MDD_LINKED_PACKAGE_E2E]", JSON.stringify(report));
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

async function readRichMdictLookup(harness, page, dictionaryId, text) {
  const tabId = await harness.tabId(page);
  const [result] = await harness.driver.evaluate(async ({ tabId, dictionaryId, text }) => {
    return chrome.scripting.executeScript({
      target: { tabId },
      func: async ({ dictionaryId, text }) => chrome.runtime.sendMessage({
        type: "RICH_MDICT_LOOKUP",
        requestId: `selection-rich-lookup-${crypto.randomUUID().replaceAll("-", "")}`,
        ownerToken: crypto.randomUUID().replaceAll("-", ""),
        dictionaryId,
        text
      }),
      args: [{ dictionaryId, text }]
    });
  }, { tabId, dictionaryId, text });
  return result?.result;
}

async function readMddResource(harness, page, dictionaryId, path, packageVersion = "") {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async ({ tabId, dictionaryId, path, packageVersion }) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async ({ dictionaryId, path, packageVersion }) => chrome.runtime.sendMessage({
        type: "RICH_MDD_RESOURCE",
        requestId: `selection-mdd-resource-${crypto.randomUUID().replaceAll("-", "")}`,
        ownerToken: crypto.randomUUID().replaceAll("-", ""),
        dictionaryId,
        path,
        ...(packageVersion ? { packageVersion } : {})
      }),
      args: [{ dictionaryId, path, packageVersion }]
    });
    return result?.result;
  }, { tabId, dictionaryId, path, packageVersion });
}

async function readRichPackageVersion(harness, page, dictionaryId) {
  const tabId = await harness.tabId(page);
  const response = await harness.driver.evaluate(async (tabId) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => chrome.runtime.sendMessage({ type: "RICH_MDICT_VIEWER_LIST" })
    });
    return result?.result;
  }, tabId);
  return response?.dictionaries?.find((item) => item.id === dictionaryId)?.packageVersion || "";
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

function makeDemoPng({ width = 240, height = 32 } = {}) {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      const grid = x % 24 < 2 || y % 16 < 2;
      scanlines[pixel] = grid ? 239 : 55 + Math.round(x / width * 45);
      scanlines[pixel + 1] = grid ? 246 : 121 + Math.round(y / height * 55);
      scanlines[pixel + 2] = grid ? 236 : 118 + Math.round(x / width * 58);
      scanlines[pixel + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeDemoWav() {
  const sampleCount = 960;
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    pcm.writeInt16LE(Math.round(5000 * Math.sin(2 * Math.PI * 440 * index / 8000)), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
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
