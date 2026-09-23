const $ = (id) => document.getElementById(id);
const autoBtn = $("autoSite");
const translateBtn = $("translate");
const restoreBtn = $("restore");
const toggleBtn = $("toggle");
const clearBtn = $("clear");
const clearCacheBtn = $("clearCache");
const settingsBtn = $("settings");
const status = $("status");
const cacheInfo = $("cacheInfo");
const autoInfo = $("autoInfo");

let currentAutoEnabled = false;
let currentSite = null;

autoBtn.addEventListener("click", async () => {
  setBusy(true, currentAutoEnabled ? "正在关闭本站自动翻译…" : "正在申请本站权限…");
  try {
    const site = currentSite;
    if (!site) throw new Error("当前页面不支持站点自动翻译。");
    if (currentAutoEnabled) {
      try { await sendToActiveTab("ABT_DISABLE_AUTO"); } catch {}
      const response = await chrome.runtime.sendMessage({ type: "AUTO_SITE_UNREGISTER", origin: site.origin });
      if (!response?.ok) throw new Error(response?.error || "关闭自动翻译失败");
      await chrome.permissions.remove({ origins: [site.match] });
      setStatus("已关闭本站自动增量翻译；已有 IndexedDB 缓存仍保留。 ");
    } else {
      const granted = await chrome.permissions.request({ origins: [site.match] });
      if (!granted) throw new Error("未授予本站权限，自动翻译未开启。");

      const response = await chrome.runtime.sendMessage({ type: "AUTO_SITE_REGISTER", origin: site.origin });
      if (!response?.ok) throw new Error(response?.error || "自动翻译注册失败");
      await ensureInjected(site.tab.id);
      const started = await chrome.tabs.sendMessage(site.tab.id, { type: "ABT_ENABLE_AUTO" });
      if (!started?.ok) throw new Error(started?.error || "当前页面自动翻译启动失败");
      setStatus("本站已开启自动增量翻译。以后进入该站会自动恢复缓存并补译新增内容。 ");
    }
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    setBusy(false);
    await refreshAutoStatus();
    await refreshCacheStatus();
  }
});

translateBtn.addEventListener("click", async () => {
  await runOnActiveTab("ABT_TRANSLATE_PAGE", true);
  await refreshCacheStatus();
});

restoreBtn.addEventListener("click", async () => {
  await runOnActiveTab("ABT_RESTORE_CACHE", true);
});

toggleBtn.addEventListener("click", async () => {
  await runOnActiveTab("ABT_TOGGLE_TRANSLATIONS", false);
});

clearBtn.addEventListener("click", async () => {
  await runOnActiveTab("ABT_CLEAR_TRANSLATIONS", false);
});

clearCacheBtn.addEventListener("click", async () => {
  const response = await runOnActiveTab("ABT_CLEAR_PAGE_CACHE", false, { silentSuccess: true });
  if (response?.ok) {
    setStatus(`已删除本页 ${response.deleted || 0} 条缓存记录。`);
    await refreshCacheStatus();
  }
});

settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

Promise.allSettled([refreshCacheStatus(), refreshAutoStatus()]);

async function refreshAutoStatus() {
  try {
    const site = await getActiveSite();
    currentSite = site;
    const { autoSites = [] } = await chrome.storage.local.get(["autoSites"]);
    const listed = Array.isArray(autoSites) && autoSites.includes(site.origin);
    const permitted = await chrome.permissions.contains({ origins: [site.match] });
    currentAutoEnabled = listed && permitted;

    autoInfo.textContent = currentAutoEnabled
      ? `本站自动增量翻译：已开启（${site.origin}）`
      : "本站自动增量翻译：未开启";
    autoBtn.textContent = currentAutoEnabled ? "关闭此站自动增量翻译" : "开启此站自动增量翻译";
    autoBtn.classList.toggle("enabled", currentAutoEnabled);
    autoBtn.disabled = false;
  } catch {
    currentSite = null;
    currentAutoEnabled = false;
    autoInfo.textContent = "当前页面不支持站点自动翻译";
    autoBtn.textContent = "开启此站自动增量翻译";
    autoBtn.disabled = true;
  }
}

async function refreshCacheStatus() {
  try {
    const result = await sendToActiveTab("ABT_CACHE_STATUS");
    if (!result?.ok) throw new Error(result?.error || "无法读取缓存状态");
    const current = Number(result.count || 0);
    const total = Number(result.totalCount || 0);
    const time = result.lastAccessedAt ? formatTime(result.lastAccessedAt) : "";
    if (current > 0) {
      const oldVersions = Math.max(0, total - current);
      cacheInfo.textContent = `当前配置 ${current} 条${oldVersions ? ` · 历史版本 ${oldVersions} 条` : ""}${time ? ` · ${time}` : ""}`;
    } else if (total > 0) {
      cacheInfo.textContent = `当前配置暂无缓存 · 另有 ${total} 条历史配置缓存`;
    } else {
      cacheInfo.textContent = "本页暂无翻译缓存";
    }
    restoreBtn.disabled = false;
    clearCacheBtn.disabled = total === 0;
  } catch {
    cacheInfo.textContent = "普通 http/https 网页可使用翻译缓存";
  }
}

async function runOnActiveTab(type, longRunning, options = {}) {
  setBusy(true, longRunning ? "正在处理页面…" : "处理中…");
  try {
    const response = await sendToActiveTab(type);
    if (!response?.ok) throw new Error(response?.error || "操作失败");

    if (!options.silentSuccess) {
      if (type === "ABT_TOGGLE_TRANSLATIONS") {
        setStatus(response.hidden ? "译文已隐藏" : "译文已显示");
      } else if (type === "ABT_CLEAR_TRANSLATIONS") {
        setStatus("已从页面移除译文；IndexedDB 缓存仍保留。 ");
      } else {
        setStatus(response.message || `已处理 ${response.count || 0} 个段落`);
      }
    }
    return response;
  } catch (error) {
    setStatus(error.message || String(error), true);
    return null;
  } finally {
    setBusy(false);
  }
}

async function sendToActiveTab(type) {
  const site = await getActiveSite();
  await ensureInjected(site.tab.id);
  return chrome.tabs.sendMessage(site.tab.id, { type });
}

async function getActiveSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("未找到当前标签页。");
  if (!/^https?:/i.test(tab.url || "")) {
    throw new Error("Chrome 内部页面、扩展页等受保护页面无法注入脚本。请在普通 http/https 网页上使用。");
  }
  const url = new URL(tab.url);
  const origin = `${url.protocol}//${url.hostname}`;
  return { tab, origin, match: `${origin}/*` };
}

async function ensureInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ABT_STATUS" });
    return;
  } catch {}

  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

function setBusy(busy, message) {
  autoBtn.disabled = busy;
  translateBtn.disabled = busy;
  restoreBtn.disabled = busy;
  toggleBtn.disabled = busy;
  clearBtn.disabled = busy;
  clearCacheBtn.disabled = busy;
  if (message) setStatus(message);
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#c62828" : "";
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
