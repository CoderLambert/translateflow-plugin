import { mkdir } from "node:fs/promises";
import { test, expect } from "./support/extension-fixture.mjs";

const evidence = "docs/task-execution/local/popup-polish";
async function openPopup(harness) {
  await harness.setStorage({ uiLocale: "zh_CN", translationPreferences: { version: 1, textMethod: "ai", wordMethod: "ai" } });
  const page = await harness.open("/article");
  await harness.inject(page); await page.bringToFront();
  await harness.driver.setViewportSize({ width: 360, height: 580 });
  await harness.driver.reload();
  await expect(harness.driver.locator("#translate")).toBeEnabled();
  return page;
}
async function reachable(locator) {
  expect(await locator.evaluate(node => {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth
      && node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
}

test("Popup keeps its action reachable across themes, disclosure, long names and short windows", async ({ harness: h }) => {
  await mkdir(evidence, { recursive: true }); await h.reset();
  await h.setStorage({ providerConnectionsVersion: 1,
    providerConnections: { local: { id: "local", revision: 1, name: "hy-mt2-7b", platform: "lmstudio", protocol: "openai-chat", baseUrl: `${h.server.baseUrl}/v1`, credentialId: "local", defaultModel: "hy-mt2-7b", settings: { streaming: true, allowEmptyApiKey: true, allowInsecureHttp: true } } },
    providerCredentials: { local: "" }, defaultService: { kind: "api-key", connectionId: "local" } });
  const page = await openPopup(h), popup = h.driver;
  await expect(popup.locator(".context-grid")).toHaveText(/模型服务hy-mt2-7b$/);
  await expect(popup.locator("#status")).toBeHidden();
  await expect(popup.locator(".ready-badge")).toHaveText("就绪");
  expect(h.server.calls).toHaveLength(0);
  for (const colorScheme of ["light", "dark"]) {
    await popup.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await reachable(popup.locator("#translate")); await reachable(popup.locator("#autoSite"));
    await popup.screenshot({ path: `${evidence}/popup-${colorScheme}.png` });
  }
  await popup.locator("#mt-site-mode").focus(); await popup.keyboard.press("Tab");
  await expect(popup.locator(".method-footer a")).toBeFocused();
  expect(await popup.locator(".method-footer a").evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
  const summary = popup.locator(".tf-accordion > summary").first();
  await summary.focus(); await popup.keyboard.press("Space");
  await expect(popup.locator("#presetSelect")).toBeVisible();
  await popup.setViewportSize({ width: 360, height: 420 });
  await reachable(popup.locator("#translate"));
  await popup.locator("#learningCenter").scrollIntoViewIfNeeded();
  await reachable(popup.locator("#learningCenter")); await reachable(popup.locator("#translate"));
  await popup.screenshot({ path: `${evidence}/popup-short-expanded.png` });
  const { providerConnections } = await h.getStorage(["providerConnections"]);
  providerConnections.local.name = "Local inference service with a deliberately long display name";
  providerConnections.local.defaultModel = "Long-Model-Name-".repeat(10);
  await h.setStorage({ providerConnections, uiLocale: "en" });
  await popup.reload(); await expect(popup.locator("#translate")).toBeEnabled();
  expect(await popup.locator(".popup-content").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await reachable(popup.locator("#translate"));
  await popup.screenshot({ path: `${evidence}/popup-long-name-english.png` });
  await popup.getByRole("button", { name: "Open advanced settings" }).click();
  await expect.poll(() => h.context.pages().some(p => p.url().includes("options.html"))).toBe(true);
  await page.close();
});

test("Popup presents protected-page recovery as a keyboard-accessible card", async ({ harness: h }, testInfo) => {
  await h.reset(); await h.setStorage({ uiLocale: 'zh_CN' });
  const protectedPage = await h.context.newPage();
  await protectedPage.goto('chrome://extensions/'); await protectedPage.bringToFront();
  const popup = h.driver;
  await popup.setViewportSize({ width: 360, height: 420 }); await popup.reload();
  const card = popup.getByRole('alert', { name: '暂时无法读取页面信息' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('HTTP/HTTPS');
  await expect(popup.getByRole('button', { name: '重新读取设置' })).toBeVisible();
  await expect(popup.locator('body')).not.toContainText('缩短划词');
  await expect(popup.locator('#status')).toBeHidden();
  const retry = card.getByRole('button', { name: '重试', exact: true });
  for (const colorScheme of ['light', 'dark']) {
    await popup.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await retry.focus();
    expect(await retry.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    expect(await retry.evaluate(node => parseFloat(getComputedStyle(node).borderRadius))).toBeGreaterThanOrEqual(6);
    await reachable(retry);
    expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await popup.screenshot({ path: testInfo.outputPath(`retry-${colorScheme}.png`) });
  }
  await retry.press('Enter'); await expect(retry).toBeEnabled(); await expect(card).toBeVisible();
  const article = await h.open('/article'); await article.bringToFront();
  await retry.click(); await expect(card).toHaveCount(0);
  await expect(popup.locator('#contextSite')).toHaveText('127.0.0.1');
  await expect(popup.locator('#translate')).toBeEnabled();
  await expect(popup.locator('#autoSite')).toBeEnabled();
  expect(h.server.calls).toHaveLength(0);
  await article.close(); await protectedPage.close();
});

test("Popup keeps real cancellation reachable and shows completion only after cancellation confirms", async ({ harness: h }) => {
  await mkdir(evidence, { recursive: true }); await h.reset();
  const page = await openPopup(h), popup = h.driver;
  await popup.emulateMedia({ reducedMotion: "reduce" });
  await popup.setViewportSize({ width: 360, height: 420 });
  h.server.setDelay(4000);
  await popup.locator("#translate").click();
  await expect.poll(() => h.server.calls.length).toBeGreaterThan(0);
  await expect(popup.locator("#translate")).toHaveText("正在翻译…");
  await reachable(popup.locator("#cancelTask"));
  expect(await popup.locator(".action-spinner").evaluate(node => getComputedStyle(node).animationName)).toBe("none");
  await popup.screenshot({ path: `${evidence}/popup-running.png` });
  await popup.getByRole("button", { name: "取消当前翻译" }).focus();
  await popup.keyboard.press("Enter");
  await expect(popup.locator("#status")).toHaveText("翻译已取消");
  await expect(popup.locator("#translate")).toBeEnabled();
  await expect(page.locator(".abt-translation")).toHaveCount(0);
  await popup.screenshot({ path: `${evidence}/popup-cancelled.png` });
  h.server.setDelay(0);
  await popup.locator('#autoSite').click();
  await expect(popup.locator('#autoSite')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.locator('.abt-translation').count()).toBeGreaterThan(0);
  await popup.locator('#autoSite').click();
  await expect(popup.locator('#autoSite')).toHaveAttribute('aria-checked', 'false');
  await popup.locator("#learningCenter").click();
  await expect.poll(() => h.context.pages().some(p => p.url().includes("learning-center.html"))).toBe(true);
  await page.close();
});
