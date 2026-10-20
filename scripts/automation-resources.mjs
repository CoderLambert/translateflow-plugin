import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";

export async function selectPageWord(page, word = "building") {
  await page.bringToFront();
  const found = await page.locator("main").first().evaluate((body, word) => {
    const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      if (node.parentElement?.closest("script,style,button,a[href],nav,.abt-translation,.tf-selection-panel")) continue;
      if (!node.parentElement?.getClientRects().length) continue;
      const index = node.textContent.toLowerCase().indexOf(word);
      if (index < 0 || /[a-z]/iu.test(node.textContent[index-1] || "") || /[a-z]/iu.test(node.textContent[index+word.length] || "")) continue;
      node.parentElement.scrollIntoView({block:"center"});
      const range = document.createRange(); range.setStart(node,index); range.setEnd(node,index+word.length);
      getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange")); return true;
    } return false;
  }, word);
  if (!found) throw new Error("The real page does not expose the requested visible word");
  await page.getByRole("button", { name: "查词", exact: true }).click();
}
export async function runResourceAcceptance(h) {
  const { config, context, openOptions, getOptions, getReader, current, step, blocked, inject, select, budget } = h;
  let nativeReady = false, nativeSupported = false, dictionaryReady = false;
  let page;
  await step("探测 Chrome 原生英译中能力", async () => {
    page = await openOptions("#general"); current.page = page;
    await page.locator("#native-models").scrollIntoViewIfNeeded();
    if(!config.chromeLocal.enabled)throw Object.assign(new Error("配置未启用 Chrome 原生模型验收。"),{status:"SKIP"});
    const status = await page.evaluate(async () => {
      const safe = async fn => { try { return await Promise.race([fn(), new Promise(resolve=>setTimeout(()=>resolve("unknown"),5000))]); } catch { return "unavailable"; } };
      return { translator: globalThis.Translator?.availability ? await safe(()=>Translator.availability({ sourceLanguage: "en", targetLanguage: "zh" })) : "unsupported",
        detector: globalThis.LanguageDetector?.availability ? await safe(()=>LanguageDetector.availability()) : "unsupported" };
    });
    nativeSupported=[status.translator,status.detector].every(value=>["available","downloadable","downloading"].includes(value));
    if (!nativeSupported) blocked(`真实 Chrome 能力 ${JSON.stringify(status)}；没有注入模拟 API 或强制假定模型成功。`);
    return { detail: `真实能力 ${JSON.stringify(status)}；允许按产品按钮下载英译中模型。` };
  });
  let preparation = false;
  await step("点击模型准备并记录下载状态", async () => {
    const button = page.locator("#native-models").getByRole("button", { name: "准备并校验两个模型", exact: true });
    if (!nativeSupported || !config.chromeLocal.allowModelDownload || !await button.isEnabled()) blocked("当前浏览器能力探测不支持准备，无法通过允许下载来强行获得模型。");
    await button.click(); preparation = true;
    await page.locator("#native-models").scrollIntoViewIfNeeded();
    return { detail: "已由真实用户手势点击产品准备按钮，未替换 Translator 或 LanguageDetector。" };
  });
  await step("等待真实模型自检完成", async () => {
    if (!preparation) blocked("未能开始真实模型准备。");
    try {
      await expect.poll(async()=>{
        if(await page.locator("#native-models").getByText("语言识别与翻译自检通过",{exact:true}).isVisible())return "ready";
        if(await page.locator("#native-models [role=alert]").count())return "failed";
        return "pending";
      },{timeout:config.chromeLocal.timeoutMs}).not.toBe("pending");
      if(await page.locator("#native-models [role=alert]").count()) blocked("Chrome 原生模型准备失败，真实界面保留诊断；没有使用模拟模型替代。");
    }
    catch(error) {
      if(error.status)throw error;
      const cancel=page.locator("#native-models").getByRole("button",{name:"取消",exact:true});
      if(await cancel.isVisible())await cancel.click();
      blocked("在配置时限内模型未完成准备，已取消本次准备；不能视为推理成功。");
    }
    nativeReady = true;
  });
  await step("Chrome 本地翻译真实网页标题，确认零付费请求", async () => {
    if (!nativeReady || !getReader()) blocked("依赖真实模型和页面就绪。");
    const before = budget.count();
    await page.getByRole("group", { name: "句段与全文翻译方式" }).getByRole("radio", { name: "Chrome 本地", exact: true }).check();
    await page.locator("#mt-save").click(); await expect(page.getByText("翻译偏好已保存。", { exact: true })).toBeVisible();
    current.page = getReader(); await select(getReader().locator("h1").first());
    await expect(getReader().locator(".tf-selection-primary")).toContainText(/[\u3400-\u9fff]/u,{timeout:60000});
    await expect(getReader().locator(".tf-selection-result")).toContainText("Chrome 本地译文"); expect(budget.count()).toBe(before);
  });
  const names = config.dictionary?.directory ? (await readdir(config.dictionary.directory)).filter(name=>/\.(mdx|mdd|css|png)$/iu.test(name)) : [];
  let existingDictionary=null;
  const expectedResources=names.filter(name=>/\.mdd$/iu.test(name)).length;
  await step("定位指定 Oxford MDX 与所有伴随 MDD 文件", async () => {
    if (!names.some(name=>/\.mdx$/iu.test(name))) blocked("未找到配置中的 MDX 文件。");
    page = await openOptions("#dictionary-packs"); current.page = page; current.privateDictionary = true;
    const installed=await page.evaluate(()=>chrome.runtime.sendMessage({type:"RICH_MDICT_LIST"}));
    expect(installed.ok).toBe(true);
    existingDictionary=installed.dictionaries.find(item=>names.includes(item.fileName)) || null;
    if(existingDictionary){await page.locator(`[data-dictionary-id="${existingDictionary.id}"]`).first().scrollIntoViewIfNeeded();return {detail:"复用此 campaign 已导入的同名测试词典，检查资源完整性；不重复覆盖 MDX，不触碰用户日常安装。"};}
    await page.locator("#localDictionaryFiles").setInputFiles(names.map(name=>join(config.dictionary.directory,name)));
    await expect(page.locator("#localDictionaryImportButton")).toBeEnabled({ timeout: 180000 });
    return { detail: `从用户指定目录读取 ${names.filter(name=>/\.mdx$/iu.test(name)).length} 个 MDX、${names.filter(name=>/\.mdd$/iu.test(name)).length} 个 MDD；未读取或执行旁边的 JS 文件。文件与正文不进入报告或仓库。` };
  });
  let importStarted = false;
  await step("确认导入词典，记录实际导入进度", async () => {
    if(existingDictionary){
      if(existingDictionary.resourceCount!==expectedResources){
        const row=page.locator(`#richMdictInstalledList [data-dictionary-id="${existingDictionary.id}"]`);
        await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles(names.filter(name=>! /\.mdx$/iu.test(name)).map(name=>join(config.dictionary.directory,name)));
      }
      importStarted=true;return {detail:existingDictionary.resourceCount===expectedResources?"已存在完整附件，复用并校验，不重复拷贝。":"MDX 已存在；通过产品的添加/重新选择资源入口恢复真实 MDD 与安全 sidecar。"};
    }
    const button = page?.locator("#localDictionaryImportButton");
    if (!button || !await button.isEnabled()) blocked("词典预检未通过。");
    await button.click(); importStarted = true;
  });
  await step("验证词典导入完成并重载设置页", async () => {
    if (!importStarted) blocked("词典未开始导入。");
    if(existingDictionary){
      await expect.poll(async()=>{
        const listed=await page.evaluate(()=>chrome.runtime.sendMessage({type:"RICH_MDICT_LIST"}));
        return listed.dictionaries.find(item=>item.id===existingDictionary.id)?.resourceCount;
      },{timeout:600000}).toBe(expectedResources);
    }else await expect(page.locator("#localDictionaryImportProgress")).toHaveText("完成 · 富文本词典已安装",{timeout:600000});
    await expect(page.locator("#richMdictInstalledList .site-row").first()).toBeVisible();
    const listed=await page.evaluate(()=>chrome.runtime.sendMessage({type:"RICH_MDICT_LIST"}));
    expect(listed.dictionaries.some(item=>item.resourceCount===expectedResources)).toBe(true);
    await page.reload(); await expect(page.locator("#richMdictInstalledList .site-row").first()).toBeVisible({timeout:30000});
    dictionaryReady = true;
    return { detail: "真实文件经过生产预检、OPFS 导入与重载路径；不等于该词典全部媒体和全部词条已兼容。" };
  });
  await step("选择词典查词，在真实正文查询 building 且零 AI 请求", async () => {
    if (!dictionaryReady || !getReader()) blocked("依赖词典导入及真实页面。");
    const before = budget.count(); await openOptions("#general"); page = getOptions();
    await page.getByRole("group", { name: "单词查词方式" }).getByRole("radio", { name: "词典", exact: true }).check();
    await page.locator("#mt-save").click(); await expect(page.getByText("翻译偏好已保存。", { exact: true })).toBeVisible();
    const reader = getReader(); current.page = reader; await reader.keyboard.press("Escape"); await inject(reader); await selectPageWord(reader);
    await expect(reader.locator(".tf-selection-rich-record").first()).toBeVisible({timeout:60000});
    await expect(reader.locator(".tf-selection-result")).toContainText("词典释义"); expect(budget.count()).toBe(before);
    return { detail: "使用真实词典命中正文单词 building；截图遮盖私有词典正文，保留来源与操作状态。" };
  });
}
