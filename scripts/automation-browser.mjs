import { chromium, expect } from "@playwright/test";
import { join } from "node:path";
import { prepareAutomationArtifact } from "./automation-artifact.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";
import { runResourceAcceptance, selectPageWord } from "./automation-resources.mjs";

export async function runBrowserAcceptance({ config, key, relay, budget, dir, campaign, profile, record, flush }) {
  const {extensionDir,artifact}=await prepareAutomationArtifact(config,campaign,relay.baseUrl);
  const launch = () => chromium.launchPersistentContext(profile, { headless: config.browser.headless !== false, executablePath: config.browser.executablePath || undefined,
    channel: config.browser.executablePath ? undefined : "chromium",
    // Playwright normally disables component updates. Real-model acceptance
    // must allow the Chrome downloads explicitly authorized in this config.
    ignoreDefaultArgs: config.chromeLocal.allowModelDownload ? ["--disable-component-update", "--disable-background-networking"] : [],
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`], viewport: { width: 1360, height: 1000 } });
  let context = await launch(), options, reader, extensionId;
  const current = { page: null, privateDictionary: false };
  const screenshot = async id => {
    const page = current.page;
    if (!page || page.isClosed()) return null;
    const path = `screenshots/${String(id).padStart(3, "0")}.png`;
    const mask = [page.locator('input[type="password"]')];
    if (current.privateDictionary) mask.push(page.locator(".tf-selection-rich-text,.tf-selection-primary,.tf-selection-senses"));
    await page.screenshot({ path: join(dir, path), fullPage: false, mask, maskColor: "#d7ddd2", animations: "disabled" });
    return path;
  };
  async function step(title, fn, kind = "真实浏览器验收") {
    const started = Date.now(), id = record.steps.length + 1;
    const item = { title, status: "PASS", kind };
    try { const result = await fn(); if (result) Object.assign(item, result); }
    catch (error) { item.status = error.status || "FAIL"; item.detail = String(error.message).slice(0, 1400); }
    try { item.image = await screenshot(id); } catch { item.detail = `${item.detail || ""}\n截图未生成`; }
    item.durationMs = Date.now() - started; record.steps.push(item); flush();
    console.log(`[AUTOMATION] ${item.status} ${title}`); return item.status === "PASS";
  }
  const blocked = message => { throw Object.assign(new Error(message), { status: "BLOCKED" }); };
  const openOptions = async hash => { options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html${hash}`); current.page = options; return options; };
  const select = async locator => {
    await reader.bringToFront();
    await reader.keyboard.press("Escape");
    await locator.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange")); });
    await reader.getByRole("button", { name: /^(查词|翻译选段)$/u }).click();
  };
  const inject = async page => {
    const token = `automation-${Date.now()}`;
    await page.evaluate(token => { document.documentElement.dataset.automationToken = token; }, token);
    const tabId = await options.evaluate(async token => {
      for (const tab of await chrome.tabs.query({})) try {
        const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.documentElement.dataset.automationToken });
        if (result.result === token) return tab.id;
      } catch {} return null;
    }, token);
    if (!tabId) throw new Error("Cannot locate the isolated test tab");
    await options.evaluate(async ({ tabId, scripts, styles }) => {
      try { if ((await chrome.tabs.sendMessage(tabId, { type: "ABT_STATUS" }))?.ok) return; } catch {}
      await chrome.scripting.insertCSS({ target: { tabId }, files: styles });
      await chrome.scripting.executeScript({ target: { tabId }, files: scripts });
    }, { tabId, scripts: CONTENT_SCRIPT_FILES, styles: CONTENT_STYLE_FILES });
    return tabId;
  };
  try {
    const sw = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"); extensionId = new URL(sw.url()).host;
    await openOptions("#provider");
    await step("打开独立测试浏览器与设置页", async () => {
      await expect(options.locator("#connectionPlatform")).toBeVisible();
      await options.evaluate(() => chrome.storage.local.set({ uiLocale: "zh_CN", targetLanguage: "Simplified Chinese", browserSourceLanguage: "en", autoSites: [], cacheRestoreSites: [] }));
      await options.reload();
      return { detail: `使用生产包隔离副本；浏览器 ${context.browser().version()}。无真实服务 trace 或网络录制。` };
    });
    const configured = await step("填写并保存 DeepSeek 连接", async () => {
      if(!config.realAi.enabled)throw Object.assign(new Error("配置未启用真实 AI 服务，零付费请求。"),{status:"SKIP"});
      const editor = options.locator(".connection-editor");
      const existing = options.locator(".connection-card").filter({ hasText: "DeepSeek 自动验收" });
      if (await existing.count()) await existing.getByRole("button", { name: "编辑", exact: true }).click();
      await editor.locator("#connectionPlatform").selectOption("deepseek");
      if (!await editor.locator("#connectionId").isDisabled()) await editor.locator("#connectionId").fill("automation-deepseek");
      await editor.locator("#connectionName").fill("DeepSeek 自动验收");
      await editor.locator("#connectionBaseUrl").fill(relay.baseUrl);
      await editor.locator("#connectionModel").fill(config.realAi.model);
      await editor.locator("#connectionOutputTokens").fill(String(config.realAi.maxOutputTokens));
      await editor.locator('input[type="checkbox"]').first().uncheck();
      await editor.getByLabel("本地或自托管服务允许 HTTP").check();
      await editor.locator("#connectionApiKey").fill(key);
      await editor.getByRole("button", { name: "保存连接", exact: true }).click();
      await expect(options.locator("#status")).toContainText("已保存连接");
      await expect(editor.locator("#connectionApiKey")).toHaveValue("");
      await options.locator("#defaultService").selectOption("api-key:automation-deepseek");
      await expect(options.locator("#status")).toContainText("默认翻译服务已更新");
      return { detail: "真实 DeepSeek 经本机限额转发：上游 https://api.deepseek.com，模型 deepseek-flash。转发器仅强制输出长度上限，不模拟响应；本项不代表浏览器直连 DeepSeek TLS 已验收。" };
    });
    await step("点击连接测试，验证真实模型返回", async () => {
      if (!configured) blocked("连接保存失败，未发送付费请求。");
      const before = budget.count(), card = options.locator(".connection-card").filter({ hasText: "DeepSeek 自动验收" });
      await card.getByRole("button", { name: "测试", exact: true }).click();
      await expect.poll(()=>card.locator(".connection-test-status").getAttribute("data-kind"),{timeout:150000}).not.toBe("loading");
      await expect(card.locator(".connection-test-status")).toHaveAttribute("data-kind", "success");
      if (budget.count() <= before) throw new Error("未观察到限额转发请求，不能宣称真实连接通过。");
      return { detail: `真实模型按产品连接校验返回 OK；累计请求 ${budget.count()} / ${config.realAi.maxRequests}。` };
    });
    await step("保存单词与句段 AI 偏好，编辑期间不翻译", async () => {
      if (!configured) blocked("依赖连接保存。");
      const before = budget.count(); await options.goto(`chrome-extension://${extensionId}/options.html#general`);
      await options.getByRole("group", { name: "单词查词方式" }).getByRole("radio", { name: "AI", exact: true }).check();
      await options.getByRole("group", { name: "句段与全文翻译方式" }).getByRole("radio", { name: "AI", exact: true }).check();
      await options.locator("#mt-save").click(); await expect(options.getByText("翻译偏好已保存。", { exact: true })).toBeVisible();
      expect(budget.count()).toBe(before);
    });
    let loaded = false;
    await step("打开用户指定的 Next.js 真实页面", async () => {
      if(!config.livePages.enabled)throw Object.assign(new Error("配置未启用真实网页。"),{status:"SKIP"});
      reader = await context.newPage(); current.page = reader;
      await reader.goto(config.livePages.urls[0], { waitUntil: "domcontentloaded", timeout: 60000 });
      await expect(reader.locator("h1").first()).toBeVisible(); await inject(reader); loaded = true;
      return { detail: `真实导航 ${config.livePages.urls[0]}，直接读取页面内容，未替换为 fixture。` };
    });
    await step("真实网页划选标题并翻译成中文", async () => {
      if (!configured || !loaded) blocked("依赖真实页面及连接保存。");
      current.page = reader; await select(reader.locator("h1").first());
      await expect(reader.locator(".tf-selection-primary")).toContainText(/[\u3400-\u9fff]/u, { timeout: 150000 });
      await expect(reader.locator(".tf-selection-result")).toContainText("AI 译文");
    });
    await step("重复划选命中缓存，确认零新增付费请求", async () => {
      if (!configured || !loaded || !await reader.locator(".tf-selection-primary").isVisible()) blocked("依赖第一次译文成功。");
      const before = budget.count(); await select(reader.locator("h1").first());
      await expect(reader.locator(".tf-selection-primary")).toContainText(/[\u3400-\u9fff]/u); expect(budget.count()).toBe(before);
      return { detail: `缓存复用前后累计请求均为 ${before}。` };
    });
    let wordReady=false;
    await step("真实页面单词查词使用已保存的 AI 方式",async()=>{
      if(!configured||!loaded)blocked("依赖连接配置和真实页面；连接自检失败独立记录，不替代实际翻译验收。");
      current.page=reader;await reader.keyboard.press("Escape");await selectPageWord(reader);
      await expect(reader.locator(".tf-selection-primary")).toContainText(/[\u3400-\u9fff]/u,{timeout:150000});
      await expect(reader.locator(".tf-selection-result")).toContainText("AI 译文");wordReady=true;
    });
    await step("收藏真实 AI 查词结果并核对保存来源",async()=>{
      if(!wordReady)blocked("依赖真实查词成功。");
      await reader.getByRole("button",{name:"收藏到生词本",exact:true}).click();
      await expect(reader.getByRole("button",{name:"打开生词本",exact:true})).toBeVisible();
      const opened=context.waitForEvent("page");
      await reader.getByRole("button",{name:"打开生词本",exact:true}).click();
      const center=await opened;await center.waitForURL(/learning-center\.html/);current.page=center;
      const book=await center.evaluate(()=>chrome.runtime.sendMessage({type:"VOCABULARY_BOOK_LIST"}));
      expect(book.ok).toBe(true);
      expect(book.entries.some(e=>e.headword.toLowerCase()==="building"&&e.sources.some(s=>s.sourceId==="ai-translation"))).toBe(true);
    });
    await step("明确点击 AI 理解，验证真实 AI 解释",async()=>{
      if(!wordReady)blocked("依赖真实查词成功。");
      current.page=reader;await reader.bringToFront();
      await reader.locator(".tf-selection-view-tab").filter({hasText:"AI · 理解"}).click();
      await expect(reader.locator('.tf-selection-ai-detail[data-state="success"]').first()).toBeVisible({timeout:150000});
      await expect(reader.locator(".tf-selection-generated-body").first()).toContainText(/[\u3400-\u9fff]/u);
    });
    await step("Popup 唯一主按钮翻译 Next.js 当前页面",async()=>{
      if(!configured||!loaded)blocked("依赖真实连接配置和页面。");
      await reader.keyboard.press("Escape");
      const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await reader.bringToFront();await popup.reload();current.page=popup;
      await expect(popup.locator("#translate")).toBeEnabled();await popup.locator("#translate").click();
      await expect(reader.locator(".abt-translation").first()).toContainText(/[\u3400-\u9fff]/u,{timeout:150000});
      await expect(popup.locator("#translate")).toBeEnabled({timeout:150000});
      await expect(popup.locator("#status")).toHaveText(/^(?:完成：缓存命中 \d+，API 新翻译 \d+。|翻译完成\s+(\d+)\/\1)$/u);
      await expect(popup.locator("#status")).not.toContainText("未返回");
      current.page=reader;
      return {detail:"通过产品 Popup 主按钮触发，真实网页出现中文译文。请求及失败重试均累计计入同一限额。"};
    });
    await runResourceAcceptance({ config, context, getOptions: () => options, openOptions, getReader: () => reader, setReader: p => { reader = p; }, current, step, blocked, inject, select, budget });
    await step("重启独立浏览器，检查连接与全局偏好持久化", async () => {
      await context.close(); context = await launch();
      const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
      if (new URL(worker.url()).host !== extensionId) throw new Error("Extension identity changed");
      await openOptions("#provider");
      await expect(options.locator("#defaultService")).toHaveValue("api-key:automation-deepseek");
      const result = await options.evaluate(() => chrome.runtime.sendMessage({ type: "PROVIDER_CONNECTIONS_LIST" }));
      expect(result.connections.some(c => c.id === "automation-deepseek" && c.hasApiKey)).toBe(true);
      expect(JSON.stringify(result).includes(key)).toBe(false);
      return { detail: "同一隔离 profile 重启后保留连接，公开 DTO 不包含密钥。" };
    });
    return artifact;
  } finally { await context.close(); }
}
