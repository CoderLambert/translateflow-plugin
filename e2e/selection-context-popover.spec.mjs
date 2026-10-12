import { test, expect } from "./support/extension-fixture.mjs";

async function selectText(page, selector, text) {
  await page.evaluate(({ selector, text }) => {
    const node = document.querySelector(selector).firstChild;
    const offset = node.nodeValue.indexOf(text);
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + text.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, { selector, text });
  await expect(page.locator(".tf-selection-chip")).toBeVisible();
}

async function selectAcross(page, startSelector, endSelector = startSelector) {
  const selected = await page.evaluate(({ startSelector, endSelector }) => {
    const start = document.querySelector(startSelector).firstChild;
    const end = document.querySelector(endSelector).lastChild;
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.nodeValue.length);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const result = { rendered: selection.toString(), raw: range.toString() };
    document.dispatchEvent(new Event("selectionchange"));
    return result;
  }, { startSelector, endSelector });
  await expect(page.locator(".tf-selection-chip")).toBeVisible();
  return selected;
}

async function openDetail(page) {
  await page.locator(".tf-selection-chip").click();
  await expect(page.locator(".tf-selection-panel")).toBeVisible();
}

async function frozenSelection(harness, page) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const capture = globalThis.__TRANSLATE_FLOW_CONTENT__?.modules?.selectionController?.getQuerySource?.();
        return capture ? {
          selectedText: capture.selectedText,
          context: capture.context,
          rawRangeText: capture.rangeIdentity?.text,
          startConnected: capture.rangeIdentity?.startContainer?.isConnected,
          endConnected: capture.rangeIdentity?.endContainer?.isConnected,
          startOffset: capture.rangeIdentity?.startOffset,
          endOffset: capture.rangeIdentity?.endOffset
        } : null;
      }
    });
    return entry?.result || null;
  }, tabId);
}

test.describe("Selection context and popover lifecycle", () => {
  test.setTimeout(60000);

  test("AI gets bounded div/span context and unrelated page changes retain the card", async ({ harness }) => {
    await harness.reset();
    await harness.setStorage({
      uiLocale: "zh_CN",
      openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true }
    });
    harness.server.setPage("/selection-context", `<!doctype html><html><body style="min-height:1800px">
      <main><div class="markdown-line">A <span id="target">persistent</span> connection remains available across reconnects.</div>
      <div id="unrelated">UNRELATED_SECRET_PAGE_TEXT must stay outside the local context.</div></main>
    </body></html>`);
    const page = await harness.open("/selection-context");
    await harness.inject(page);
    await selectText(page, "#target", "persistent");
    expect(await harness.captureSelectionContext(page)).toMatchObject({
      text: "A persistent connection remains available across reconnects.",
      sensitive: false,
      source: "visible-local"
    });

    await openDetail(page);
    await page.getByRole("button", { name: "解释这里是什么意思" }).click();
    await expect(page.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
    const payload = JSON.parse(harness.server.calls.at(-1).userContent);
    expect(payload.text).toBe("persistent");
    expect(payload.context).toBe("A persistent connection remains available across reconnects.");
    expect(payload.context).not.toContain("UNRELATED_SECRET_PAGE_TEXT");

    await page.locator("#unrelated").evaluate(node => { node.textContent = "A separate page block changed."; });
    await expect(page.locator(".tf-selection-panel")).toBeVisible();
    await expect(page.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");

    await page.locator(".markdown-line").evaluate(node => {
      node.innerHTML = 'A <span id="target">persistent</span> connection remains available across reconnects.';
    });
    await expect.poll(async () => (await frozenSelection(harness, page))?.startConnected).toBe(true);
    await expect.poll(async () => (await frozenSelection(harness, page))?.endConnected).toBe(true);
    await expect(page.locator(".tf-selection-panel")).toBeVisible();
    await expect(page.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  });

  test("adjacent div and br selections preserve rendered separators through page and detail scrolling", async ({ harness }) => {
    for (const fixture of [
      { name: "adjacent div", path: "/selection-boundary-div", markup: '<main id="selected"><div id="start">persistent</div><div id="end">connection</div></main>', start: "#start", end: "#end" },
      { name: "br", path: "/selection-boundary-br", markup: '<main id="selected"><div id="target">persistent<br>connection</div></main>', start: "#target", end: "#target" }
    ]) {
      await harness.reset();
      harness.server.setPage(fixture.path, `<!doctype html><html><body style="min-height:3600px">
        ${fixture.markup}<div id="unrelated">UNRELATED_OUTSIDE_SELECTION_CONTEXT</div><div style="height:2600px"></div>
        <script>addEventListener('scroll', () => { const node = document.createElement('i'); node.id = 'scroll-mutation'; document.body.append(node); }, { once: true });</script>
      </body></html>`);
      const page = await harness.open(fixture.path);
      await harness.inject(page);
      const actual = await selectAcross(page, fixture.start, fixture.end);
      expect(actual, fixture.name).toEqual({ rendered: "persistent\nconnection", raw: "persistentconnection" });
      expect(await harness.captureSelectionContext(page)).toMatchObject({
        text: "persistent\nconnection", sensitive: false, source: "visible-local"
      });

      await openDetail(page);
      const frozen = await frozenSelection(harness, page);
      expect(frozen).toMatchObject({ selectedText: "persistent\nconnection", rawRangeText: "persistentconnection" });

      await page.evaluate(() => window.scrollTo(0, 500));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(page.locator("#scroll-mutation")).toHaveCount(1);
      await expect(page.locator(".tf-selection-panel")).toBeVisible();

      const result = page.locator(".tf-selection-result");
      await result.evaluate(node => {
        node.hidden = false;
        for (let index = 0; index < 80; index++) {
          const row = document.createElement("div");
          row.textContent = `Synthetic detail row ${index}`;
          node.append(row);
        }
      });
      const pageScrollBefore = await page.evaluate(() => window.scrollY);
      await result.hover();
      await page.mouse.wheel(0, 420);
      await expect.poll(() => result.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
      await expect(page.locator(".tf-selection-panel")).toBeVisible();
      await page.close();
    }
  });

  test("removing selected nodes or changing selected content closes the popover", async ({ harness }) => {
    for (const mode of ["remove", "change"]) {
      await harness.reset();
      harness.server.setPage(`/selection-${mode}`, `<!doctype html><html><body>
        <main id="selected"><div id="start">persistent</div><div id="end">connection</div></main>
      </body></html>`);
      const page = await harness.open(`/selection-${mode}`);
      await harness.inject(page);
      await selectAcross(page, "#start", "#end");
      await openDetail(page);
      if (mode === "remove") await page.locator("#selected").evaluate(node => node.remove());
      else await page.locator("#end").evaluate(node => { node.firstChild.nodeValue = "changed"; });
      await expect(page.locator(".tf-selection-panel")).toHaveCount(0);
      await page.close();
    }
  });

  test("navigation closes the selection and rejects a delayed AI response", async ({ harness }) => {
    await harness.reset();
    harness.server.setPage("/selection-navigation", '<!doctype html><html><body><p id="line">A persistent connection remains available.</p></body></html>');
    const page = await harness.open("/selection-navigation");
    await harness.inject(page);
    await selectText(page, "#line", "persistent");
    await openDetail(page);
    harness.server.setDelay(600);
    const callsBefore = harness.server.calls.length;
    await page.getByRole("button", { name: "解释这里是什么意思" }).click();
    await expect.poll(() => harness.server.calls.length).toBe(callsBefore + 1);
    const call = harness.server.calls[callsBefore];
    expect(call.systemPrompt).toContain("Plain text only");

    await page.evaluate(() => {
      history.pushState({}, "", "/different-source-page");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.locator(".tf-selection-panel")).toHaveCount(0);
    await expect.poll(() => call.responseState, { timeout: 10000 }).toMatch(/^(?:finished|closed)$/u);
    await expect(page.locator(".tf-selection-ai-detail[data-state='success']")).toHaveCount(0);
  });
});
