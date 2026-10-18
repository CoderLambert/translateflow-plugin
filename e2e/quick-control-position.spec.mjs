import { test, expect } from "./support/extension-fixture.mjs";
import { mkdir } from "node:fs/promises";

const evidence = "docs/task-execution/local/quick-control-position";
test.use({ lexiconPacks: "missing" });
test.beforeEach(async ({ harness }) => { await harness.reset(); });

async function openControl(harness) {
  await harness.setStorage({ quickControlSites: ["http://127.0.0.1"] });
  const page = await harness.open("/article");
  await harness.inject(page);
  await harness.sendContent(page, "TF_QUICK_CONTROL_SHOW");
  await expect(page.locator(".tf-quick-trigger")).toBeVisible();
  return page;
}
async function saved(harness) {
  return (await harness.getStorage(["quickControlPositions"])).quickControlPositions?.sites?.["http://127.0.0.1"] ?? null;
}
async function drag(page, x, y, finish = true) {
  const box = await page.locator(".tf-quick-trigger").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  if (finish) await page.mouse.up();
}
async function inside(locator, page) {
  await expect.poll(async () => {
    const box = await locator.boundingBox(), size = page.viewportSize();
    return Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1);
  }).toBe(true);
}

test("drag frees the website floating button and persists across refresh without translating", async ({ harness }) => {
  const page = await openControl(harness);
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "website-floating-button"; button.textContent = "网站助手";
    button.style.cssText = "position:fixed;right:18px;bottom:18px;width:52px;height:52px;border-radius:50%;background:#ffc475;z-index:1000";
    button.onclick = () => { button.textContent = "已打开"; };
    document.body.append(button);
  });
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/overlap-before.png` });
  await drag(page, 100, 380);
  await expect(page.locator(".tf-quick-panel")).toBeHidden();
  await page.locator("#website-floating-button").click();
  await expect(page.locator("#website-floating-button")).toHaveText("已打开");
  await expect.poll(() => saved(harness)).not.toBeNull();
  const position = await saved(harness), before = await page.locator(".tf-quick-trigger").boundingBox();
  expect(harness.server.calls).toHaveLength(0);
  await page.screenshot({ path: `${evidence}/moved-website-button-usable.png` });
  await page.reload();
  await expect(page.locator(".tf-quick-trigger")).toBeVisible();
  await expect.poll(async () => Math.round((await page.locator(".tf-quick-trigger").boundingBox()).x)).toBe(Math.round(before.x));
  expect(await saved(harness)).toEqual(position);
  await page.locator(".tf-quick-trigger").click();
  await expect(page.locator(".tf-quick-panel")).toBeVisible();
  await inside(page.locator(".tf-quick-panel"), page);
  const panelBox = await page.locator(".tf-quick-panel").boundingBox(), triggerBox = await page.locator(".tf-quick-trigger").boundingBox();
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(triggerBox.y);
  await page.screenshot({ path: `${evidence}/restored-position-and-panel.png` });
  expect(harness.server.calls).toHaveLength(0);
  await page.close();
});

test("trusted touch dragging persists and suppression followed by resize restores an in-view button", async ({ harness }) => {
  const page = await openControl(harness), trigger = page.locator(".tf-quick-trigger");
  const session = await harness.context.newCDPSession(page), box = await trigger.boundingBox();
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 26, y: box.y + 26 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 180, y: 270 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => saved(harness)).not.toBeNull();
  await expect(page.locator(".tf-quick-panel")).toBeHidden();
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector("#intro"));
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.querySelector("#intro").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.locator(".tf-selection-chip")).toBeVisible();
  await expect(trigger).toBeHidden();
  await page.setViewportSize({ width: 390, height: 480 });
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await expect(trigger).toBeVisible(); await inside(trigger, page);
  await trigger.click(); await expect(page.locator(".tf-quick-panel")).toBeVisible();
  await inside(page.locator(".tf-quick-panel"), page);
  expect(harness.server.calls).toHaveLength(0);
  await session.detach(); await page.close();
});

test("keyboard moves, locale recreation, narrow dark layout and site reset remain usable", async ({ harness }) => {
  const page = await openControl(harness), trigger = page.locator(".tf-quick-trigger");
  await trigger.focus();
  const before = await trigger.boundingBox();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect.poll(() => saved(harness)).not.toBeNull();
  expect((await trigger.boundingBox()).x).toBeCloseTo(before.x - 16, 0);
  const moved = await saved(harness);
  await harness.setStorage({ uiLocale: "en" });
  await expect(trigger).toHaveAttribute("title", /Drag to move/);
  expect((await trigger.boundingBox()).x).toBeCloseTo(before.x - 16, 0);
  await trigger.focus(); await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(async () => (await saved(harness))?.y).toBeLessThan(moved.y);
  await page.setViewportSize({ width: 390, height: 480 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await inside(trigger, page);
  await trigger.click();
  await expect(page.locator(".tf-quick-panel")).toBeVisible();
  await inside(page.locator(".tf-quick-panel"), page);
  const panelBox = await page.locator(".tf-quick-panel").boundingBox(), triggerBox = await trigger.boundingBox();
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(triggerBox.y);
  await page.screenshot({ path: `${evidence}/narrow-dark-panel.png` });
  await page.getByRole("button", { name: "Reset position", exact: true }).click();
  await expect.poll(() => saved(harness)).toBeNull();
  const reset = await trigger.boundingBox();
  expect(reset.x + reset.width).toBeCloseTo(390 - 18, 0);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect.poll(() => saved(harness)).not.toBeNull();
  await page.keyboard.press("Alt+Home");
  await expect.poll(() => saved(harness)).toBeNull();
  expect(harness.server.calls).toHaveLength(0);
  await page.close();
});

test("Escape and pointer cancellation discard unfinished movement and do not activate the panel", async ({ harness }) => {
  const page = await openControl(harness), trigger = page.locator(".tf-quick-trigger");
  const before = await trigger.boundingBox();
  await drag(page, 200, 320, false);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(trigger).not.toHaveAttribute("data-dragging", "true");
  expect((await trigger.boundingBox()).x).toBeCloseTo(before.x, 0);
  await expect(page.locator(".tf-quick-panel")).toBeHidden();
  expect(await saved(harness)).toBeNull();
  await drag(page, 200, 320, false);
  // Browser touch/pointer interruption uses the same cancellation listener.
  await trigger.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  expect((await trigger.boundingBox()).x).toBeCloseTo(before.x, 0);
  expect(await saved(harness)).toBeNull();
  await trigger.focus();
  await page.keyboard.down("Alt"); await page.keyboard.down("ArrowLeft");
  await page.keyboard.press("Escape"); await page.keyboard.up("ArrowLeft"); await page.keyboard.up("Alt");
  expect((await trigger.boundingBox()).x).toBeCloseTo(before.x, 0);
  expect(await saved(harness)).toBeNull();
  await trigger.click();
  await expect(page.locator(".tf-quick-panel")).toBeVisible();
  expect(harness.server.calls).toHaveLength(0);
  await page.close();
});
