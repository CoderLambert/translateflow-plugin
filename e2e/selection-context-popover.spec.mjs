import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";

const evidenceDir = resolve("docs/task-execution/local/selection-context-popover-scroll");

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

async function openDetail(page) {
  await page.locator(".tf-selection-chip").click();
  await expect(page.locator(".tf-selection-panel")).toBeVisible();
}

test("AI explanation receives bounded local context from div/span text", async ({ harness }) => {
  await harness.reset();
  await harness.setStorage({
    uiLocale: "zh_CN",
    openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true }
  });
  harness.server.setPage("/selection-context", `<!doctype html><html><body>
    <main><div class="markdown-line">A <span id="target">persistent</span> connection remains available across reconnects.</div>
    <div>UNRELATED_SECRET_PAGE_TEXT must stay outside the local context.</div></main>
  </body></html>`);
  const page = await harness.open("/selection-context");
  await harness.inject(page);
  await selectText(page, "#target", "persistent");
  const captured = await harness.captureSelectionContext(page);
  expect(captured).toMatchObject({
    sensitive: false,
    source: "visible-local",
    text: "A persistent connection remains available across reconnects."
  });

  await openDetail(page);
  await page.getByRole("button", { name: "解释这里是什么意思" }).click();
  await expect(page.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  const payload = JSON.parse(harness.server.calls.at(-1).userContent);
  expect(payload.text).toBe("persistent");
  expect(payload.context).toBe("A persistent connection remains available across reconnects.");
  expect(payload.context).not.toContain("UNRELATED_SECRET_PAGE_TEXT");

  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir, "selection-context-ai-detail.png") });
});

test("page and detail scrolling retain the popover while Esc and outside click close it", async ({ harness }) => {
  await harness.reset();
  harness.server.setPage("/selection-scroll", `<!doctype html><html><body style="min-height:3000px">
    <p id="line">A persistent connection remains available across reconnects.</p>
    <div style="height:2400px"></div>
    <script>addEventListener('scroll', () => document.body.append(document.createElement('i')), { once: true });</script>
  </body></html>`);
  const page = await harness.open("/selection-scroll");
  await harness.inject(page);
  await selectText(page, "#line", "persistent");
  await openDetail(page);

  await page.evaluate(() => scrollTo(0, 500));
  await page.waitForTimeout(150);
  await expect(page.locator(".tf-selection-panel")).toBeVisible();

  const result = page.locator(".tf-selection-result");
  await result.evaluate((result) => {
    result.hidden = false;
    for (let index = 0; index < 80; index++) {
      const row = document.createElement("div");
      row.textContent = `Synthetic detail row ${index}`;
      result.append(row);
    }
  });
  const before = { page: await page.evaluate(() => scrollY), detail: await result.evaluate(node => node.scrollTop) };
  await result.hover();
  await page.mouse.wheel(0, 420);
  await expect.poll(() => result.evaluate(node => node.scrollTop)).toBeGreaterThan(before.detail);
  expect(await page.evaluate(() => scrollY)).toBe(before.page);
  await expect(page.locator(".tf-selection-panel")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".tf-selection-panel")).toHaveCount(0);
  await selectText(page, "#line", "persistent");
  await openDetail(page);
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await expect(page.locator(".tf-selection-panel")).toHaveCount(0);
});
