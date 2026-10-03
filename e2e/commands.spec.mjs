import { test, expect } from "./support/extension-fixture.mjs";

test.use({ commandCallbackProbe: true });

test.describe("Chrome Commands MV3 routing (actual registered callback probe)", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test.afterEach(async ({ harness }) => {
    for (const page of harness.context.pages()) {
      if (page !== harness.driver && !page.isClosed()) await page.close();
    }
  });

  test("first-use translate injects the shipped bundle and the remaining commands toggle page state", async ({ harness }) => {
    const page = await harness.open("/article");

    const translated = await routeCommand(harness, page, "translate-page");
    expect(translated?.ok).toBe(true);
    await expect(page.locator(".abt-translation")).toHaveCount(3);
    expect(harness.server.calls).toHaveLength(1);

    let hidden = await routeCommand(harness, page, "toggle-translations");
    expect(hidden).toMatchObject({ ok: true, hidden: true });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains("abt-hide-translations")
    )).toBe(true);

    hidden = await routeCommand(harness, page, "toggle-translations");
    expect(hidden).toMatchObject({ ok: true, hidden: false });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains("abt-hide-translations")
    )).toBe(false);

    let quick = await routeCommand(harness, page, "toggle-quick-control");
    expect(quick).toMatchObject({ ok: true, visible: true });
    await expect(page.getByRole("button", { name: "TranslateFlow Quick Control" })).toBeVisible();

    quick = await routeCommand(harness, page, "toggle-quick-control");
    expect(quick).toMatchObject({ ok: true, visible: false });
    await expect(page.getByRole("button", { name: "TranslateFlow Quick Control" })).toHaveCount(0);
  });

  test("protected pages are rejected before send or content injection", async ({ harness }) => {
    // The real router sees a native active extension page, which is protected.
    await harness.driver.bringToFront();
    await harness.serviceWorker.evaluate(async () => {
      const p = globalThis.__tfCommandProbe;
      p.sends = []; p.injections = 0; p.queries = [];
      for (const callback of p.callbacks) callback("translate-page");
      await Promise.all(p.queries);
      await Promise.resolve(); await Promise.resolve();
    });
    const evidence = await harness.serviceWorker.evaluate(() => ({
      listeners: globalThis.__tfCommandProbe.callbacks.length,
      sends: globalThis.__tfCommandProbe.sends.length,
      injections: globalThis.__tfCommandProbe.injections
    }));
    expect(evidence).toEqual({ listeners: 1, sends: 0, injections: 0 });
    expect(harness.server.calls).toHaveLength(0);
  });
});

async function routeCommand(harness, page, command) {
  await page.bringToFront();
  await expect.poll(async () => harness.driver.evaluate(async ({ expectedUrl }) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.url === expectedUrl;
  }, { expectedUrl: page.url() })).toBe(true);

  const before = await harness.serviceWorker.evaluate((command) => {
    const p = globalThis.__tfCommandProbe;
    const count = p.sends.length;
    if (p.callbacks.length !== 1) throw new Error("Expected one actual production command listener");
    for (const callback of p.callbacks) callback(command);
    return count;
  }, command);
  await expect.poll(() => harness.serviceWorker.evaluate((before) => {
    const entries = globalThis.__tfCommandProbe.sends.slice(before);
    return entries.some((entry) => entry.settled && entry.value?.ok);
  }, before)).toBe(true);
  return harness.serviceWorker.evaluate((before) => globalThis.__tfCommandProbe.sends.slice(before)
    .find((entry) => entry.settled && entry.value?.ok)?.value, before);
}
