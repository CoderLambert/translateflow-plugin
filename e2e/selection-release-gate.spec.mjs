import { test, expect } from "./support/extension-fixture.mjs";

test.describe("Selection UX release gate", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test.afterEach(async ({ harness }) => {
    for (const page of harness.context.pages()) {
      if (page !== harness.driver && !page.isClosed()) await page.close();
    }
  });

  test("technical Core/Technical competition stays local, attributable and Provider-free", async ({ harness }) => {
    const page = await harness.open("/selection");
    await harness.inject(page);

    await selectElementText(page, "#technical-competition");
    await page.locator(".tf-selection-chip").click();

    const resolved = await harness.runtime({
      type: "SELECTION_RESOLVE",
      text: "session",
      pageUrl: page.url(),
      context: {
        text: "Open tmux in the terminal and attach to a session.",
        source: "visible-local",
        sensitive: false,
        truncated: false
      }
    });
    const kinds = resolved.decision.candidates.map((candidate) => candidate.kind);
    expect(kinds).toContain("lexical");
    expect(kinds.some((kind) => kind === "technical-concept" || kind === "technical-entity")).toBe(true);

    const result = page.locator(".tf-selection-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText("session");

    const provenance = page.locator(".tf-selection-entry-provenance");
    await expect(provenance).toHaveCount(2);
    expect(new Set(await provenance.allTextContents())).toEqual(new Set(["本地词典", "技术词条"]));
    await expect(page.locator(".tf-selection-source")).toBeHidden();
    expect(harness.server.calls).toHaveLength(0);
  });

  test("unknown multi-word phrase falls back to ordinary translation without lexical concatenation", async ({ harness }) => {
    const page = await harness.open("/selection");
    await harness.inject(page);

    await selectElementText(page, "#unknown-phrase");
    await page.locator(".tf-selection-chip").click();

    await expect(page.locator(".tf-selection-source")).toBeVisible();
    await expect(page.locator(".tf-selection-source")).toHaveText("persistent session");
    await expect(page.locator(".tf-selection-result")).toHaveAttribute("data-result-kind", "translation");
    await expect(page.locator(".tf-selection-result-badge")).toContainText("翻译");
    await expect(page.locator(".tf-selection-dictionary-entry")).toHaveCount(0);

    expect(harness.server.calls).toHaveLength(1);
    expect(harness.server.calls[0].systemPrompt).toContain("Translate the segments and return JSON only.");
    expect(harness.server.calls[0].systemPrompt).not.toContain("Selection Explain");
  });

  test("Selection remains readable in dark reduced-motion mode without page overflow", async ({ harness }) => {
    const page = await harness.open("/selection");
    await page.setViewportSize({ width: 360, height: 260 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await harness.inject(page);

    await page.locator("#ambiguous").scrollIntoViewIfNeeded();
    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").focus();
    await page.keyboard.press("Enter");

    const panel = page.getByRole("dialog", { name: "TranslateFlow 划词翻译" });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("button", { name: "关闭" })).toBeFocused();

    const visual = await panel.evaluate((node) => {
      const style = getComputedStyle(node);
      const button = node.querySelector(".tf-ui-button");
      const buttonStyle = button ? getComputedStyle(button) : null;
      return {
        color: style.color,
        background: style.backgroundColor,
        transitionDuration: buttonStyle?.transitionDuration || ""
      };
    });
    expect(visual.color).not.toBe(visual.background);
    expect(visual.transitionDuration).toBe("0s");

    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(box.y + box.height).toBeLessThanOrEqual(260);
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);
    expect(harness.server.calls).toHaveLength(0);
  });

  test("long lexical card remains inside the viewport at every selection edge", async ({ harness }) => {
    const page = await harness.open("/selection");
    await page.setViewportSize({ width: 420, height: 240 });
    await harness.inject(page);

    const positions = [
      "top: 2px; left: 2px;",
      "top: 2px; right: 2px;",
      "bottom: 2px; left: 2px;",
      "bottom: 2px; right: 2px;"
    ];

    for (const position of positions) {
      await page.locator("#ambiguous").evaluate((element, position) => {
        element.style.cssText = `position: fixed; ${position} z-index: 1;`;
      }, position);

      await selectElementText(page, "#ambiguous");
      await page.locator(".tf-selection-chip").click();

      const panel = page.getByRole("dialog", { name: "TranslateFlow 划词翻译" });
      await expect(panel).toBeVisible();
      await expect(page.locator(".tf-selection-dictionary-entry")).toHaveCount(2);

      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(420);
      expect(box.y + box.height).toBeLessThanOrEqual(240);

      await page.getByRole("button", { name: "关闭" }).click();
      await expect(panel).toBeHidden();
    }

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);
    expect(harness.server.calls).toHaveLength(0);
  });

  test("new Selection supersedes in-flight AI detail and outside click dismisses the current card", async ({ harness }) => {
    const page = await harness.open("/selection");
    await harness.inject(page);

    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-primary")).toContainText("持久的");

    harness.server.setDelay(300);
    await page.getByRole("button", { name: "使用 AI 结合上下文详解" }).click();
    await expect(page.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "loading");
    await expect.poll(() => harness.server.calls.length).toBe(1);

    await selectElementText(page, "#entity");
    await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result")).toContainText("tmux");
    await expect(page.locator(".tf-selection-ai-detail")).toBeHidden();

    await page.waitForTimeout(350);
    await expect(page.locator(".tf-selection-result")).toContainText("tmux");
    await expect(page.locator(".tf-selection-result")).not.toContainText("持续存在或保持有效");

    await page.locator("#unrelated").dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      composed: true
    });
    await expect(page.getByRole("dialog", { name: "TranslateFlow 划词翻译" })).toBeHidden();
    harness.server.setDelay(0);
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
