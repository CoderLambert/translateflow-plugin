import { normalizeOrigin } from "../src/shared/url.js";
import { mkdir } from "node:fs/promises";
import { test, expect } from "./support/extension-fixture.mjs";

const evidence = "docs/task-execution/local/translation-method";
const machine = (mode = "legacy", routing = "auto", providerId = "mt-microsoft-web") => ({ version: 2, mode, routing, providerId, sourceLanguage: "auto" });
const calls = h => h.serviceWorker.evaluate(() => globalThis.__methodCalls);

test.beforeEach(async ({ harness: h }) => {
  await mkdir(evidence, { recursive: true }); await h.reset();
  await h.setStorage({ uiLocale: "zh_CN", machineTranslation: machine(), translationPreferences: { version: 1, textMethod: "ai", wordMethod: "free-online" }, siteProfiles: {} });
  // Synthetic external responses, with the production UI/router/config/cache intact.
  await h.serviceWorker.evaluate(() => {
    globalThis.__methodCalls = [];
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      const host = new URL(url).hostname;
      if (!["edge.microsoft.com", "transmart.qq.com"].includes(host)) return original(url, init);
      globalThis.__methodCalls.push(host);
      const body = JSON.parse(init.body), microsoft = host === "edge.microsoft.com";
      const texts = microsoft ? body : body.source.text_list;
      return Response.json(microsoft ? texts.map(text => ({ translations: [{ text: `微软测试译文：${text}` }] })) : { header: { ret_code: "succ" }, auto_translation: texts.map(text => `腾讯测试译文：${text}`) });
    };
  });
});
async function popup(h) {
  const page = await h.open("/article"); await h.inject(page); await page.bringToFront(); await h.driver.reload();
  await expect(h.driver.locator("#mt-site-mode")).toBeEnabled();
  return page;
}
async function free(h, fixed = false) {
  await h.driver.locator("#mt-site-mode").selectOption("free-online");
  if (fixed) {
    await h.driver.locator(".mt-manual summary").click(); await h.driver.locator("#mt-site-provider").selectOption("mt-tencent-transmart");
    await h.driver.locator(".mt-manual summary").click();
    await expect(h.driver.locator(".mt-manual summary")).toHaveText("手动选择服务 · 腾讯翻译");
  }
  await h.driver.locator(".mt-consent input").check();
}
for (const fixed of [false, true]) {
  test(`sole primary action applies ${fixed ? "fixed" : "automatic"} configuration before translating`, async ({ harness: h }) => {
    const page = await popup(h); await free(h, fixed);
    await expect(h.driver.locator(".tf-button--primary")).toHaveCount(1);
    await expect(h.driver.locator("#translate")).toHaveText("应用并翻译");
    expect((await h.getStorage(["siteProfiles"])).siteProfiles).toEqual({}); expect(await calls(h)).toHaveLength(0);
    await h.driver.locator("#translate").click();
    await expect(page.locator(".abt-translation").first()).toContainText(fixed ? "腾讯测试译文" : "微软测试译文");
    const profiles = (await h.getStorage(["siteProfiles"])).siteProfiles;
    expect(profiles[normalizeOrigin(h.server.baseUrl)].machineTranslation).toMatchObject({ routing: fixed ? "fixed" : "auto", providerId: fixed ? "mt-tencent-transmart" : "mt-microsoft-web" });
    expect((await calls(h)).every(host => host === (fixed ? "transmart.qq.com" : "edge.microsoft.com"))).toBe(true);
    expect(h.server.calls).toHaveLength(0);
    await h.driver.reload(); await expect(h.driver.locator("#translate")).toHaveText("翻译当前页面");
    await expect(h.driver.locator(".method-scope")).toHaveAttribute("title", new RegExp(fixed ? "腾讯翻译" : "自动选择"));
    if (fixed) {
      await h.driver.getByRole("button", { name: "跟随默认设置", exact: true }).click();
      expect((await h.getStorage(["siteProfiles"])).siteProfiles[normalizeOrigin(h.server.baseUrl)].machineTranslation.routing).toBe("fixed");
      await expect(h.driver.locator("#translate")).toHaveText("应用并翻译");
      // Restore to the configured legacy AI route; this is an explicit second translation.
      await h.driver.locator("#translate").click();
      await expect.poll(async () => (await h.getStorage(["siteProfiles"])).siteProfiles[normalizeOrigin(h.server.baseUrl)]?.machineTranslation).toBeUndefined();
      await expect.poll(() => h.server.calls.length).toBeGreaterThan(0);
    }
    await h.driver.setViewportSize({ width: 360, height: 820 });
    await h.driver.screenshot({ path: `${evidence}/popup-${fixed ? "restored" : "automatic"}.png`, fullPage: true });
    await page.close();
  });
}

test("closing abandons a draft and a fixed service survives keyboard disclosure toggles", async ({ harness: h }) => {
  const page = await popup(h); await free(h, true);
  await h.driver.reload(); await expect(h.driver.locator("#mt-site-mode")).toHaveValue("ai");
  expect(await calls(h)).toHaveLength(0); expect((await h.getStorage(["siteProfiles"])).siteProfiles).toEqual({});
  await h.setStorage({ siteProfiles: { [normalizeOrigin(h.server.baseUrl)]: { textMethod: "free-online", machineTranslation: machine("free-online", "fixed", "mt-tencent-transmart") } } });
  await h.driver.reload(); const summary = h.driver.locator(".mt-manual summary");
  await expect(summary).toHaveText("手动选择服务 · 腾讯翻译");
  await summary.focus(); await h.driver.keyboard.press("Space"); await expect(h.driver.locator("#mt-site-provider")).toBeVisible();
  await h.driver.keyboard.press("Space"); await expect(h.driver.locator("#mt-site-provider")).not.toBeVisible();
  await expect(h.driver.locator(".mt-pending")).toHaveCount(0); expect(await calls(h)).toHaveLength(0);
  await h.driver.getByRole("button", { name: "恢复自动选择", exact: true }).click();
  await expect(h.driver.locator("#translate")).toHaveText("应用并翻译");
  await h.driver.locator(".mt-consent input").check(); await h.driver.locator("#translate").click();
  await expect(page.locator(".abt-translation").first()).toContainText("微软测试译文");
  await page.close();
});

for (const failure of ["permission", "storage"]) {
  test(`${failure} rejection preserves pending draft with zero translation requests`, async ({ harness: h }) => {
    const page = await popup(h); await free(h, true);
    if (failure === "permission") await h.driver.evaluate(() => { chrome.permissions.request = async () => false; });
    else await h.serviceWorker.evaluate(() => {
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async values => { if ("siteProfiles" in values) throw new Error("Synthetic save failure"); return original(values); };
    });
    await h.driver.locator("#translate").click();
    await expect(h.driver.locator("#status.error")).toBeVisible();
    await h.driver.setViewportSize({ width: 360, height: 420 });
    expect(await h.driver.locator("#status").evaluate(node => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight && node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await expect(h.driver.locator("#translate")).toBeEnabled();
    await expect(h.driver.locator(".mt-pending")).toHaveText("待应用");
    expect((await h.getStorage(["siteProfiles"])).siteProfiles).toEqual({}); expect(await calls(h)).toHaveLength(0); expect(h.server.calls).toHaveLength(0);
    await h.driver.screenshot({ path: `${evidence}/popup-${failure}-error.png` }); await page.close();
  });
}

test("Options reads and edits issue zero translation requests, with scoped saves and unobstructed narrow layouts", async ({ harness: h }) => {
  const options = await h.context.newPage(); await options.goto(`chrome-extension://${h.extensionId}/options.html`);
  await expect(options.getByRole("heading", { name: "翻译方式", exact: true })).toBeVisible();
  await options.locator('.mt-text-method input[value="free-online"]').check();
  await expect(options.getByRole("radio", { name: "自动选择（推荐）", exact: true })).toBeChecked();
  await expect(options.locator("#mt-provider")).not.toBeVisible(); await expect(options.locator("#mt-source")).not.toBeVisible();
  await options.locator(".mt-manual summary").click(); await options.locator("#mt-provider").selectOption("mt-tencent-transmart");
  await options.locator(".mt-manual summary").click(); await options.locator(".mt-more summary").click();
  await options.locator("#mt-source").selectOption("en");
  await options.getByRole("button", { name: "恢复自动选择", exact: true }).click();
  await options.locator("#mt-consent").check();
  expect(await calls(h)).toHaveLength(0); expect(h.server.calls).toHaveLength(0);
  expect((await h.getStorage(["machineTranslation"])).machineTranslation.mode).toBe("legacy");
  for (const colorScheme of ["light", "dark"]) {
    await options.emulateMedia({ colorScheme, reducedMotion: "reduce" }); await options.setViewportSize({ width: 390, height: 800 });
    await options.locator("#mt-save").scrollIntoViewIfNeeded();
    expect(await options.locator("#mt-save").evaluate(node => {
      const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await options.locator(".sticky-actions").evaluate(node => getComputedStyle(node).position)).toBe("static");
    await options.screenshot({ path: `${evidence}/options-narrow-${colorScheme}.png`, fullPage: true });
    await options.screenshot({ path: `${evidence}/options-viewport-${colorScheme}.png` });
  }
  await options.locator("#mt-save").click(); await expect(options.locator(".mt-settings .status")).toHaveText("翻译偏好已保存。");
  expect(await calls(h)).toHaveLength(0); expect(h.server.calls).toHaveLength(0);
  await options.reload(); await expect(options.locator('.mt-text-method input[value="free-online"]')).toBeChecked();
  await expect(options.getByRole("radio", { name: "自动选择（推荐）", exact: true })).toBeChecked();
  await expect(options.locator(".mt-pending")).toHaveCount(0);
  expect(await calls(h)).toHaveLength(0); expect(h.server.calls).toHaveLength(0);
  await options.close();
});
