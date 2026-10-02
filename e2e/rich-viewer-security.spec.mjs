import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";
import {
  makeRichViewerSecurityFixture,
  richViewerSecurityFixtureExpectations as fixtureExpectations
} from "../tests/helpers/rich-viewer-security-fixture.mjs";

const evidenceDir = process.env.RICH_MDICT_EVIDENCE_DIR ||
  "/tmp/translateflow-rich-viewer-183";

test.describe("Rich MDict isolated viewer security and product behavior", () => {
  test.setTimeout(300_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("hostile HTML and styles stay inert while readable dictionary structure remains available", async ({ harness }) => {
    await mkdir(evidenceDir, { recursive: true });
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "rich-viewer-security-fixture.mdx",
      mimeType: "application/octet-stream",
      buffer: makeRichViewerSecurityFixture()
    });
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText(
      "Rich Viewer Security Fixture"
    );
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", {
      timeout: 90_000
    });

    const page = await harness.open("/selection");
    const remoteRequests = [];
    const pageErrors = [];
    page.on("request", (request) => {
      const url = request.url();
      if (!/^https?:/iu.test(url)) return;
      try {
        if (new URL(url).origin !== harness.server.baseUrl) remoteRequests.push(url);
      } catch {
        remoteRequests.push(url);
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.evaluate(() => {
      window.__richViewerExecuted = false;
      const proof = document.createElement("p");
      proof.id = "richviewer-outside-proof";
      proof.textContent = "host page proof";
      proof.style.color = "rgb(13, 27, 41)";
      proof.style.position = "relative";
      document.body.append(proof);

      const first = document.createElement("p");
      first.id = "rich-viewer-hostile-word";
      first.textContent = "run";
      const second = document.createElement("p");
      second.id = "rich-viewer-compact-word";
      second.textContent = "richviewercompactterm";
      document.body.append(first, second);
    });
    await harness.inject(page);
    await selectElementText(page, "#rich-viewer-hostile-word");
    await expect(page.locator(".tf-selection-chip")).toBeVisible({ timeout: 10_000 });
    await page.locator(".tf-selection-chip").click({ timeout: 10_000 });

    const richCard = page.locator(".tf-selection-rich-record")
      .filter({ hasText: "Rich Viewer Security Fixture" });
    await expandRichCard(richCard);
    const viewer = richCard.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(viewer).toBeVisible({ timeout: 30_000 });
    await expect(viewer).toContainText("Safe dictionary hierarchy");
    await expect(viewer).toContainText(fixtureExpectations.safeMeaning);
    await expect(viewer).toContainText("First meaning");
    await expect(viewer).toContainText("Remote navigation text");

    const host = page.locator(".tf-selection-rich-text").last();
    expect(await host.evaluate((element) => Boolean(element.shadowRoot))).toBe(true);
    expect(await viewer.getAttribute("role")).toBe("region");
    expect(Number(await viewer.getAttribute("tabindex"))).toBe(0);
    await expect(page.locator(".tf-selection-result")).toHaveAttribute("data-result-kind", "local");
    await expect(page.locator(".tf-selection-result .tf-selection-primary").first()).toContainText("运行");

    const contentSafety = await viewer.evaluate((root) => {
      const proof = document.querySelector("#richviewer-outside-proof");
      const proofStyle = getComputedStyle(proof);
      const richDiv = root.querySelector(".tf-rich-node-div");
      const richDivStyle = richDiv ? getComputedStyle(richDiv) : null;
      const maxFontSize = Math.max(0, ...[...root.querySelectorAll("*")].map((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize) || 0
      ));
      const placeholders = [...root.querySelectorAll(".tf-rich-placeholder")].map((item) => ({
        kind: /^(?:图片|圖片)/u.test(item.getAttribute("aria-label") || "") ? "image" : "audio",
        text: item.textContent || "",
        attributes: [...item.attributes].map(({ name }) => name)
      }));
      return {
        outsideColor: proofStyle.color,
        outsidePosition: proofStyle.position,
        richDivPosition: richDivStyle?.position || "static",
        maxFontSize,
        unsafeElements: root.querySelectorAll(
          "script, iframe, object, embed, form, input, button:not([data-action='load-mdd-audio']), link, style, a, img, audio, video, source"
        ).length,
        placeholders,
        text: root.innerText || ""
      };
    });
    expect(contentSafety.outsideColor).toBe("rgb(13, 27, 41)");
    expect(contentSafety.outsidePosition).toBe("relative");
    expect(contentSafety.richDivPosition).not.toBe("fixed");
    expect(contentSafety.maxFontSize).toBeLessThanOrEqual(48);
    expect(contentSafety.unsafeElements).toBe(0);
    expect(contentSafety.placeholders).toHaveLength(2);
    expect(contentSafety.placeholders.map(({ kind }) => kind).sort(), JSON.stringify(contentSafety.placeholders)).toEqual(["audio", "image"]);
    expect(contentSafety.placeholders.every(({ attributes }) =>
      !attributes.some((name) => /^(?:src|href|on\w+)$/iu.test(name))
    )).toBe(true);
    expect(contentSafety.placeholders.map(({ text }) => text).join(" ")).toContain(
      fixtureExpectations.localImageText
    );
    expect(contentSafety.placeholders.map(({ text }) => text).join(" ")).toContain(
      fixtureExpectations.localAudioText
    );
    expect(contentSafety.text).not.toMatch(/attacker\.invalid|remote image placeholder|remote audio placeholder/iu);
    expect(await page.evaluate(() => window.__richViewerExecuted)).toBe(false);

    await expect(page.locator(".tf-selection-result script, .tf-selection-result img, .tf-selection-result iframe")).toHaveCount(0);
    expect(harness.server.calls).toHaveLength(0);
    expect(remoteRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    await page.screenshot({
      path: resolve(evidenceDir, "rich-viewer-security-light.png"),
      fullPage: true,
      caret: "initial"
    });

    const lightColors = await viewer.evaluate((root) => ({
      foreground: getComputedStyle(root).color,
      background: getComputedStyle(root).backgroundColor
    }));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(viewer).toBeVisible();
    const darkLayout = await viewer.evaluate((root) => {
      const style = getComputedStyle(root);
      const rect = root.getBoundingClientRect();
      return {
        foreground: style.color,
        background: style.backgroundColor,
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
        tabIndex: root.tabIndex
      };
    });
    expect(darkLayout.tabIndex).toBe(0);
    expect(darkLayout.left).toBeGreaterThanOrEqual(0);
    expect(darkLayout.right).toBeLessThanOrEqual(darkLayout.viewportWidth);
    expect(darkLayout.foreground).not.toBe(darkLayout.background);
    await page.screenshot({
      path: resolve(evidenceDir, "rich-viewer-security-dark-narrow.png"),
      fullPage: true,
      caret: "initial"
    });

    await viewer.focus();
    await expect(viewer).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".tf-selection-panel")).toBeHidden();

    await page.emulateMedia({ colorScheme: "light" });
    await page.locator("#rich-viewer-compact-word").scrollIntoViewIfNeeded({ timeout: 10_000 });
    await selectElementText(page, "#rich-viewer-compact-word");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.scrollIntoViewIfNeeded({ timeout: 10_000 });
    await chip.click({ timeout: 10_000 });
    const compactCard = page.locator(".tf-selection-rich-record")
      .filter({ hasText: "Rich Viewer Security Fixture" });
    await expandRichCard(compactCard);
    const compactViewer = compactCard.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(compactViewer).toBeVisible({ timeout: 30_000 });
    await expect(compactViewer).toContainText("COMPACT HEADWORD");
    await expect(compactViewer).toContainText("[pronunciation]");
    await expect(compactViewer).toContainText("compact note");
    const compactProof = await compactViewer.evaluate((root) => {
      const findLeaf = (text) => [...root.querySelectorAll("*")].find((element) =>
        element.childElementCount === 0 && element.textContent.trim() === text
      );
      const headword = findLeaf("COMPACT HEADWORD");
      const pronunciation = findLeaf("[pronunciation]");
      const note = findLeaf("compact note");
      const markerAttack = findLeaf("CSS marker remains readable text");
      const layoutAttack = findLeaf("escaped layout marker");
      return {
        headword: headword && {
          tag: headword.tagName,
          fontSize: Number.parseFloat(getComputedStyle(headword).fontSize),
          fontWeight: getComputedStyle(headword).fontWeight
        },
        pronunciation: pronunciation && getComputedStyle(pronunciation).color,
        note: note && getComputedStyle(note).color,
        markerBackground: markerAttack && getComputedStyle(markerAttack).backgroundImage,
        layoutPosition: layoutAttack && getComputedStyle(layoutAttack).position,
        compactIds: [...root.querySelectorAll("[data-compact-id]")]
          .map((element) => element.getAttribute("data-compact-id"))
      };
    });
    expect(compactProof.headword).toBeTruthy();
    expect(compactProof.headword.fontWeight).not.toBe("400");
    expect(compactProof.pronunciation).toBe("rgb(30, 144, 255)");
    expect(compactProof.note).toBe("rgb(119, 119, 119)");
    expect(compactProof.markerBackground).not.toContain("attacker.invalid");
    expect(compactProof.layoutPosition).not.toBe("fixed");
    if (compactProof.compactIds.length) {
      expect(compactProof.compactIds).toEqual(expect.arrayContaining(["1", "2", "3", "4", "5", "6"]));
    }

    const report = {
      status: "PASS",
      fixture: "bounded-synthetic-hostile-rich-mdx-v2",
      shadowRoot: true,
      dangerousElementsInViewer: contentSafety.unsafeElements,
      maximumRenderedFontSizePx: contentSafety.maxFontSize,
      genericLocalPlaceholders: contentSafety.placeholders.map(({ kind, text }) => ({ kind, text })),
      externalRequests: remoteRequests.length,
      providerCalls: harness.server.calls.length,
      scriptExecuted: await page.evaluate(() => window.__richViewerExecuted),
      outsideStyle: {
        color: contentSafety.outsideColor,
        position: contentSafety.outsidePosition
      },
      theme: { light: lightColors, dark: darkLayout },
      compact: compactProof,
      escapeClosesViewer: true,
      generatedAt: new Date().toISOString()
    };
    await writeFile(
      resolve(evidenceDir, "rich-viewer-security-report.json"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    console.log("[RICH_VIEWER_SECURITY]", JSON.stringify(report));
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
