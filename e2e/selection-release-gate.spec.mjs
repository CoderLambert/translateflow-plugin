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

    const dictionaryDetails = page.locator(".tf-selection-dictionary-disclosure");
    await expect(dictionaryDetails).toHaveCount(1);
    await expect(dictionaryDetails).toHaveJSProperty("open", false);
    await dictionaryDetails.locator("summary").click();
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

  test("composition Enter stays explicit and dictionary details remain keyboard accessible", async ({ harness }) => {
    const page = await harness.open("/selection");
    await page.setViewportSize({ width: 320, height: 240 });
    await harness.inject(page);
    await page.locator("#ambiguous").evaluate((element) => {
      element.style.cssText = "position: fixed; bottom: 2px; left: 2px; z-index: 1;";
    });

    await page.locator("#ambiguous").scrollIntoViewIfNeeded();
    await selectElementText(page, "#ambiguous");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible();
    const composingEnter = await chip.evaluate((node) => {
      node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "阅" }));
      const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "阅读" }));
      return { isComposing: event.isComposing, defaultPrevented: event.defaultPrevented };
    });
    expect(composingEnter).toEqual({ isComposing: true, defaultPrevented: false });
    await expect(page.locator(".tf-selection-panel")).toBeHidden();
    expect(harness.server.calls).toHaveLength(0);

    await chip.click();
    await expect(page.locator(".tf-selection-result > .tf-selection-primary")).toContainText("持久的");
    const panel = page.locator(".tf-selection-panel");
    const result = page.locator(".tf-selection-result");
    const actions = page.locator(".tf-selection-actions");
    const close = page.getByRole("button", { name: "关闭" });
    const assertReachable = async (width, height, { scrollable = false, primaryVisible = false } = {}) => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const measurements = await panel.evaluate((panel) => {
        const result = panel.querySelector(".tf-selection-result");
        const actions = panel.querySelector(".tf-selection-actions");
        const close = panel.querySelector(".tf-selection-icon-button");
        const recordStatus = panel.querySelector(".tf-selection-record-status");
        const primary = result.querySelector(":scope > .tf-selection-primary");
        const bounds = (node) => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        return {
          panel: { ...bounds(panel), scrollHeight: panel.scrollHeight, scrollTop: panel.scrollTop, overflowY: getComputedStyle(panel).overflowY },
          result: { ...bounds(result), scrollHeight: result.scrollHeight, scrollTop: result.scrollTop, overflowY: getComputedStyle(result).overflowY },
          primary: primary ? bounds(primary) : null,
          actions: bounds(actions),
          close: bounds(close),
          recordStatus: recordStatus ? bounds(recordStatus) : null,
          viewport: { width: innerWidth, height: innerHeight }
        };
      });
      expect(measurements.panel.x).toBeGreaterThanOrEqual(0);
      expect(measurements.panel.y).toBeGreaterThanOrEqual(0);
      expect(measurements.panel.right).toBeLessThanOrEqual(width);
      expect(measurements.panel.bottom).toBeLessThanOrEqual(height);
      expect(measurements.result.height).toBeGreaterThanOrEqual(56);
      expect(measurements.result.overflowY).toBe("auto");
      if (scrollable) expect(measurements.result.scrollHeight).toBeGreaterThan(measurements.result.height);
      if (scrollable) {
        expect(measurements.panel.overflowY).toBe("auto");
        expect(measurements.panel.scrollHeight).toBeGreaterThan(measurements.panel.height);
      }
      if (primaryVisible) {
        expect(measurements.primary).not.toBeNull();
        expect(measurements.primary.y).toBeGreaterThanOrEqual(measurements.result.y);
        expect(measurements.primary.bottom).toBeLessThanOrEqual(measurements.result.bottom);
      }
      for (const control of [measurements.actions, measurements.close]) {
        expect(control.x).toBeGreaterThanOrEqual(measurements.panel.x);
        expect(control.right).toBeLessThanOrEqual(measurements.panel.right);
        expect(control.y).toBeGreaterThanOrEqual(measurements.panel.y);
        expect(control.bottom).toBeLessThanOrEqual(measurements.panel.bottom);
        expect(control.bottom).toBeLessThanOrEqual(height);
      }
      return measurements;
    };

    await expect(result.locator(".tf-selection-headword")).toBeVisible();
    await expect(page.locator(".tf-selection-result > .tf-selection-primary")).toBeVisible();
    await expect(page.locator(".tf-selection-record-status")).toBeVisible();
    await assertReachable(320, 240, { scrollable: true, primaryVisible: true });

    const details = page.locator(".tf-selection-dictionary-disclosure");
    const summary = details.locator("summary");
    await result.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await summary.scrollIntoViewIfNeeded();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", true);
    await assertReachable(320, 240, { scrollable: true });
    await expect(result).toContainText("持久的");
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", false);
    await assertReachable(320, 240, { scrollable: true });
    await panel.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const footerReachability = await panel.evaluate((node) => {
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
      };
      return {
        panel: rect(node),
        close: rect(node.querySelector(".tf-selection-icon-button")),
        readingStatus: rect(node.querySelector(".tf-selection-record-status")),
        readingAction: rect(node.querySelector(".tf-selection-record-status .tf-selection-actions button")),
        scrollTop: node.scrollTop
      };
    });
    expect(footerReachability.scrollTop).toBeGreaterThan(0);
    for (const control of [footerReachability.close, footerReachability.readingStatus, footerReachability.readingAction]) {
      expect(control.x).toBeGreaterThanOrEqual(footerReachability.panel.x);
      expect(control.right).toBeLessThanOrEqual(footerReachability.panel.right);
      expect(control.y).toBeGreaterThanOrEqual(footerReachability.panel.y);
      expect(control.bottom).toBeLessThanOrEqual(footerReachability.panel.bottom);
    }
    await close.click();
    await expect(panel).toBeHidden();
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

  test("Selection restores the prior page focus for Escape and close, but respects later focus movement", async ({ harness }) => {
    const page = await harness.open("/selection");
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await harness.inject(page);
    const prior = page.locator("#focus-return-before");
    const moved = page.locator("#focus-moved-after");
    const panel = page.getByRole("dialog", { name: "TranslateFlow 划词翻译" });

    await prior.focus();
    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result > .tf-selection-primary")).toContainText("持久的");
    const close = page.getByRole("button", { name: "关闭" });
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(prior).toBeFocused();

    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result > .tf-selection-primary")).toContainText("持久的");
    await page.getByRole("button", { name: "关闭" }).click();
    await expect(panel).toBeHidden();
    await expect(prior).toBeFocused();

    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result > .tf-selection-primary")).toContainText("持久的");
    await moved.focus();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(moved).toBeFocused();

    await prior.focus();
    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result > .tf-selection-primary")).toContainText("持久的");
    await page.locator("#ambiguous").evaluate((element) => element.remove());
    await expect(panel).toBeHidden();
    await expect(prior).not.toBeFocused();

    await prior.focus();
    await selectElementText(page, "#entity");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result")).toContainText("tmux");
    await prior.evaluate((element) => element.remove());
    await expect(panel).toBeHidden();
    expect(await prior.count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.id || "")).not.toBe("focus-return-before");

    await moved.focus();
    await selectElementText(page, "#entity");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result")).toContainText("tmux");
    await page.goto(new URL("/article", page.url()).href, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#intro")).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.id || "")).not.toBe("focus-moved-after");
    expect(pageErrors).toEqual([]);

    expect(harness.server.calls).toHaveLength(0);
  });

  test("new Selection supersedes in-flight AI detail and outside click dismisses the current card", async ({ harness }) => {
    const page = await harness.open("/selection");
    await harness.inject(page);

    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result > .tf-selection-primary")).toContainText("持久的");

    // Keep the mock stream pending long enough to exercise superseding an
    // in-flight Selection response on slower extension runners.
    harness.server.setDelay(1_200);
    await page.getByRole("button", { name: "使用 AI 结合上下文详解" }).click();
    await expect(page.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "streaming");
    await expect.poll(() => harness.server.calls.length).toBe(1);
    await expect.poll(() => harness.server.calls[0].responseState).toBe("pending");

    await selectElementText(page, "#entity");
    await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result")).toContainText("tmux");
    await expect(page.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "actions");
    await expect.poll(() => harness.server.calls[0].responseState).toMatch(/^(?:finished|closed)$/u);
    await expect(page.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "actions");
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
