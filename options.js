import { BACKGROUND_MESSAGES, DEFAULT_CONFIG } from "./src/shared/constants.js";

const apiKey = document.getElementById("apiKey");
const model = document.getElementById("model");
const prompt = document.getElementById("prompt");
const cacheMaxMB = document.getElementById("cacheMaxMB");
const save = document.getElementById("save");
const test = document.getElementById("test");
const reveal = document.getElementById("reveal");
const status = document.getElementById("status");
const cacheStats = document.getElementById("cacheStats");
const refreshCache = document.getElementById("refreshCache");
const pruneCache = document.getElementById("pruneCache");
const clearAllCache = document.getElementById("clearAllCache");
const autoSitesList = document.getElementById("autoSitesList");
const refreshAutoSites = document.getElementById("refreshAutoSites");

load();
refreshCacheStats();
refreshAutoSiteList();

save.addEventListener("click", async () => {
  await saveConfig();
  setStatus("设置已保存。模型或 Prompt 变化后将自动使用新的缓存版本。", false);
});

test.addEventListener("click", async () => {
  test.disabled = true;
  setStatus("正在测试 API…", false);
  try {
    await saveConfig();
    const response = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGES.TEST_API });
    if (!response?.ok) throw new Error(response?.error || "API 测试失败");
    setStatus(`连接成功。模型返回：${response.result}`, false);
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    test.disabled = false;
  }
});

reveal.addEventListener("click", () => {
  const visible = apiKey.type === "text";
  apiKey.type = visible ? "password" : "text";
  reveal.textContent = visible ? "显示" : "隐藏";
});

refreshCache.addEventListener("click", refreshCacheStats);
refreshAutoSites.addEventListener("click", refreshAutoSiteList);

pruneCache.addEventListener("click", async () => {
  await saveConfig();
  setStatus("正在清理缓存…", false);
  const response = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CACHE_PRUNE });
  if (!response?.ok) return setStatus(response?.error || "缓存清理失败", true);
  setStatus(`清理完成，删除 ${response.deleted || 0} 条旧记录。`, false);
  await refreshCacheStats();
});

clearAllCache.addEventListener("click", async () => {
  if (!confirm("确定清空全部网页翻译缓存？API Key 和设置不会删除。")) return;
  const response = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CACHE_CLEAR_ALL });
  if (!response?.ok) return setStatus(response?.error || "清空缓存失败", true);
  setStatus("全部翻译缓存已清空。", false);
  await refreshCacheStats();
});

async function load() {
  const config = await chrome.storage.local.get(["apiKey", "model", "prompt", "cacheMaxMB"]);
  apiKey.value = config.apiKey || DEFAULT_CONFIG.apiKey;
  model.value = config.model || DEFAULT_CONFIG.model;
  prompt.value = config.prompt || DEFAULT_CONFIG.prompt;
  cacheMaxMB.value = Number(config.cacheMaxMB || DEFAULT_CONFIG.cacheMaxMB);
}

async function saveConfig() {
  const maxMB = Math.min(2048, Math.max(20, Number(cacheMaxMB.value) || DEFAULT_CONFIG.cacheMaxMB));
  cacheMaxMB.value = maxMB;
  await chrome.storage.local.set({
    apiKey: apiKey.value.trim(),
    model: model.value.trim() || DEFAULT_CONFIG.model,
    prompt: prompt.value.trim() || DEFAULT_CONFIG.prompt,
    cacheMaxMB: maxMB
  });
}

async function refreshCacheStats() {
  cacheStats.textContent = "正在读取缓存统计…";
  try {
    const response = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CACHE_STATS });
    if (!response?.ok) throw new Error(response?.error || "读取失败");
    cacheStats.textContent = `${response.pageCount || 0} 个网页 · ${response.segmentCount || 0} 个翻译段落 · 约 ${formatBytes(response.bytes || 0)}`;
  } catch (error) {
    cacheStats.textContent = `读取缓存统计失败：${error.message || error}`;
  }
}

async function refreshAutoSiteList() {
  autoSitesList.textContent = "正在读取已授权站点…";
  try {
    const { autoSites = [] } = await chrome.storage.local.get(["autoSites"]);
    const sites = Array.isArray(autoSites) ? [...new Set(autoSites)].sort() : [];
    autoSitesList.replaceChildren();

    if (!sites.length) {
      autoSitesList.textContent = "暂无自动翻译站点。请在目标网页的插件弹窗中开启。";
      return;
    }

    for (const site of sites) {
      const row = document.createElement("div");
      row.className = "site-row";
      const text = document.createElement("span");
      text.textContent = site;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "移除";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          const response = await chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGES.AUTO_SITE_UNREGISTER,
            origin: site
          });
          if (!response?.ok) throw new Error(response?.error || "移除站点失败");
          await chrome.permissions.remove({ origins: [`${site}/*`] });
          setStatus(`已关闭 ${site} 的自动翻译。`, false);
          await refreshAutoSiteList();
        } catch (error) {
          setStatus(error.message || String(error), true);
          remove.disabled = false;
        }
      });
      row.append(text, remove);
      autoSitesList.appendChild(row);
    }
  } catch (error) {
    autoSitesList.textContent = `读取站点失败：${error.message || error}`;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function setStatus(message, isError) {
  status.textContent = message;
  status.style.color = isError ? "#c62828" : "";
}
