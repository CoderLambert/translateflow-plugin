import {
  BACKGROUND_MESSAGES,
  DEFAULT_CONFIG,
  DEFAULT_OPENAI_COMPATIBLE,
  PROVIDER_IDS
} from "./src/shared/constants.js";
import {
  getProviderHostPermissionPattern,
  normalizeOpenAIBaseUrl,
  normalizeSiteProfile
} from "./src/shared/provider-config.js";
import { TRANSLATION_PRESETS, getPresetLabel } from "./src/shared/presets.js";
import {
  DEFAULT_APPEARANCE_ID,
  TRANSLATION_APPEARANCES,
  getAppearanceLabel,
  normalizeAppearanceId
} from "./src/shared/appearance.js";
import { normalizeOrigin } from "./src/shared/url.js";
import { initializeGlossaryUi } from "./src/options/glossary-ui.js";

const $ = (id) => document.getElementById(id);

const defaultProvider = $("defaultProvider");
const prompt = $("prompt");
const targetLanguage = $("targetLanguage");
const defaultAppearance = $("defaultAppearance");
const youtubeSubtitleMode = $("youtubeSubtitleMode");
const youtubeSubtitleSize = $("youtubeSubtitleSize");
const deepseekApiKey = $("deepseekApiKey");
const deepseekModel = $("deepseekModel");
const revealDeepSeek = $("revealDeepSeek");
const openaiBaseUrl = $("openaiBaseUrl");
const openaiApiKey = $("openaiApiKey");
const openaiModel = $("openaiModel");
const openaiStreaming = $("openaiStreaming");
const revealOpenAI = $("revealOpenAI");
const cacheMaxMB = $("cacheMaxMB");
const save = $("save");
const test = $("test");
const status = $("status");
const extensionVersion = $("extensionVersion");
if (extensionVersion) extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;

const siteOrigin = $("siteOrigin");
const siteProvider = $("siteProvider");
const sitePreset = $("sitePreset");
const siteAppearance = $("siteAppearance");
const siteModel = $("siteModel");
const sitePrompt = $("sitePrompt");
const siteTargetLanguage = $("siteTargetLanguage");
const saveSiteProfile = $("saveSiteProfile");
const clearSiteEditor = $("clearSiteEditor");
const siteProfilesList = $("siteProfilesList");

const cacheStats = $("cacheStats");
const refreshCache = $("refreshCache");
const pruneCache = $("pruneCache");
const clearAllCache = $("clearAllCache");
const cacheRestoreSitesList = $("cacheRestoreSitesList");
const autoSitesList = $("autoSitesList");
const refreshAutoSites = $("refreshAutoSites");

populateSitePresetOptions();
populateAppearanceOptions(defaultAppearance);
populateAppearanceOptions(siteAppearance, { includeInherit: true });

await Promise.allSettled([
  load(),
  refreshCacheStats(),
  refreshSiteBehaviorLists(),
  refreshSiteProfiles(),
  initializeGlossaryUi({ setStatus })
]);

save.addEventListener("click", async () => {
  save.disabled = true;
  try {
    await saveGlobalConfig({ requestPermission: true });
    setStatus("全局设置已保存。翻译配置变化会使用新的缓存版本；阅读外观只改变显示，不影响缓存版本。");
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    save.disabled = false;
  }
});

test.addEventListener("click", async () => {
  test.disabled = true;
  try {
    setStatus("正在保存并测试当前默认 Provider…");
    await saveGlobalConfig({ requestPermission: true });
    const response = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGES.TEST_API });
    if (!response?.ok) throw new Error(response?.error || "API 测试失败");
    setStatus(`连接成功。模型返回：${response.result}`);
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    test.disabled = false;
  }
});

bindPasswordToggle(revealDeepSeek, deepseekApiKey);
bindPasswordToggle(revealOpenAI, openaiApiKey);

refreshCache.addEventListener("click", refreshCacheStats);
refreshAutoSites.addEventListener("click", refreshSiteBehaviorLists);
clearSiteEditor.addEventListener("click", clearProfileEditor);

pruneCache.addEventListener("click", async () => {
  try {
    await saveGlobalConfig({ requestPermission: false });
    setStatus("正在清理缓存…");
    const response = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CACHE_PRUNE });
    if (!response?.ok) throw new Error(response?.error || "缓存清理失败");
    setStatus(`清理完成，删除 ${response.deleted || 0} 条旧记录。`);
    await refreshCacheStats();
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
});

clearAllCache.addEventListener("click", async () => {
  if (!confirm("确定清空全部网页翻译缓存？API Key 和设置不会删除。")) return;
  const response = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CACHE_CLEAR_ALL });
  if (!response?.ok) return setStatus(response?.error || "清空缓存失败", true);
  setStatus("全部翻译缓存已清空。");
  await refreshCacheStats();
});

saveSiteProfile.addEventListener("click", async () => {
  saveSiteProfile.disabled = true;
  try {
    const origin = normalizeOrigin(siteOrigin.value);
    const profile = normalizeSiteProfile({
      provider: siteProvider.value,
      preset: sitePreset.value,
      appearance: siteAppearance.value,
      model: siteModel.value,
      prompt: sitePrompt.value,
      targetLanguage: siteTargetLanguage.value
    });

    const provider = profile.provider || defaultProvider.value || PROVIDER_IDS.DEEPSEEK;
    if (provider === PROVIDER_IDS.OPENAI_COMPATIBLE) {
      await ensureOpenAIPermission(openaiBaseUrl.value);
    }

    const { siteProfiles = {} } = await chrome.storage.local.get(["siteProfiles"]);
    const next = { ...(siteProfiles || {}) };
    if (Object.keys(profile).length) next[origin] = profile;
    else delete next[origin];

    await chrome.storage.local.set({ siteProfiles: next });
    setStatus(Object.keys(profile).length ? `已保存 ${origin} 的站点配置。` : `已移除 ${origin} 的站点覆盖。`);
    clearProfileEditor();
    await refreshSiteProfiles();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    saveSiteProfile.disabled = false;
  }
});

async function load() {
  const config = await chrome.storage.local.get([
    "provider",
    "apiKey",
    "model",
    "prompt",
    "targetLanguage",
    "appearance",
    "cacheMaxMB",
    "openAICompatible",
    "youtubeSubtitleMode",
    "youtubeSubtitleSize"
  ]);
  const openAI = { ...DEFAULT_OPENAI_COMPATIBLE, ...(config.openAICompatible || {}) };

  defaultProvider.value = config.provider || DEFAULT_CONFIG.provider;
  deepseekApiKey.value = config.apiKey || "";
  deepseekModel.value = config.model || DEFAULT_CONFIG.model;
  prompt.value = config.prompt || DEFAULT_CONFIG.prompt;
  targetLanguage.value = config.targetLanguage || DEFAULT_CONFIG.targetLanguage;
  defaultAppearance.value = normalizeAppearanceId(config.appearance) || DEFAULT_APPEARANCE_ID;
  cacheMaxMB.value = Number(config.cacheMaxMB || DEFAULT_CONFIG.cacheMaxMB);
  openaiBaseUrl.value = openAI.baseUrl || "";
  openaiApiKey.value = openAI.apiKey || "";
  openaiModel.value = openAI.model || "";
  openaiStreaming.checked = Boolean(openAI.streaming);
  youtubeSubtitleMode.value = ["bilingual", "original", "off"].includes(config.youtubeSubtitleMode) ? config.youtubeSubtitleMode : "bilingual";
  youtubeSubtitleSize.value = ["small", "standard", "large"].includes(config.youtubeSubtitleSize) ? config.youtubeSubtitleSize : "standard";
}

async function saveGlobalConfig({ requestPermission }) {
  const provider = defaultProvider.value || PROVIDER_IDS.DEEPSEEK;
  const baseUrl = normalizeOpenAIBaseUrl(openaiBaseUrl.value);
  const maxMB = Math.min(2048, Math.max(20, Number(cacheMaxMB.value) || DEFAULT_CONFIG.cacheMaxMB));
  cacheMaxMB.value = maxMB;

  if (requestPermission && provider === PROVIDER_IDS.OPENAI_COMPATIBLE) {
    await ensureOpenAIPermission(baseUrl);
  }

  await chrome.storage.local.set({
    provider,
    apiKey: deepseekApiKey.value.trim(),
    model: deepseekModel.value.trim() || DEFAULT_CONFIG.model,
    prompt: prompt.value.trim() || DEFAULT_CONFIG.prompt,
    targetLanguage: targetLanguage.value.trim() || DEFAULT_CONFIG.targetLanguage,
    appearance: normalizeAppearanceId(defaultAppearance.value) || DEFAULT_APPEARANCE_ID,
    cacheMaxMB: maxMB,
    openAICompatible: {
      baseUrl,
      apiKey: openaiApiKey.value.trim(),
      model: openaiModel.value.trim(),
      streaming: Boolean(openaiStreaming.checked)
    },
    youtubeSubtitleMode: ["bilingual", "original", "off"].includes(youtubeSubtitleMode.value) ? youtubeSubtitleMode.value : "bilingual",
    youtubeSubtitleSize: ["small", "standard", "large"].includes(youtubeSubtitleSize.value) ? youtubeSubtitleSize.value : "standard"
  });
}

async function ensureOpenAIPermission(rawBaseUrl) {
  const pattern = getProviderHostPermissionPattern(rawBaseUrl);
  if (!pattern) throw new Error("请先填写 OpenAI-compatible Base URL。");

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new Error(`未授予 API 地址权限：${pattern}`);
  return pattern;
}

async function refreshSiteProfiles() {
  siteProfilesList.textContent = "正在读取站点配置…";
  try {
    const { siteProfiles = {} } = await chrome.storage.local.get(["siteProfiles"]);
    const entries = Object.entries(siteProfiles || {}).sort(([a], [b]) => a.localeCompare(b));
    siteProfilesList.replaceChildren();

    if (!entries.length) {
      siteProfilesList.textContent = "暂无站点级覆盖。";
      return;
    }

    for (const [origin, rawProfile] of entries) {
      const profile = normalizeSiteProfile(rawProfile);
      const row = document.createElement("div");
      row.className = "site-row";

      const summary = document.createElement("div");
      summary.className = "site-summary";
      const title = document.createElement("strong");
      title.textContent = origin;
      const detail = document.createElement("small");
      detail.textContent = [
        profile.provider ? `Provider: ${profile.provider}` : "Provider: 继承",
        profile.preset ? `Mode: ${getPresetLabel(profile.preset)}` : "Mode: 无",
        profile.appearance ? `外观: ${getAppearanceLabel(profile.appearance)}` : "外观: 继承",
        profile.model ? `Model: ${profile.model}` : "Model: 继承",
        profile.prompt ? "Prompt: 自定义" : "Prompt: 继承",
        profile.targetLanguage ? `目标语言: ${profile.targetLanguage}` : "目标语言: 继承"
      ].join(" · ");
      summary.append(title, detail);

      const actions = document.createElement("div");
      actions.className = "site-actions";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "编辑";
      edit.addEventListener("click", () => {
        siteOrigin.value = origin;
        siteProvider.value = profile.provider || "";
        sitePreset.value = profile.preset || "";
        siteAppearance.value = profile.appearance || "";
        siteModel.value = profile.model || "";
        sitePrompt.value = profile.prompt || "";
        siteTargetLanguage.value = profile.targetLanguage || "";
        siteOrigin.scrollIntoView({ behavior: "smooth", block: "center" });
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "删除";
      remove.addEventListener("click", async () => {
        const { siteProfiles: latest = {} } = await chrome.storage.local.get(["siteProfiles"]);
        const next = { ...(latest || {}) };
        delete next[origin];
        await chrome.storage.local.set({ siteProfiles: next });
        setStatus(`已删除 ${origin} 的站点配置。`);
        await refreshSiteProfiles();
      });

      actions.append(edit, remove);
      row.append(summary, actions);
      siteProfilesList.appendChild(row);
    }
  } catch (error) {
    siteProfilesList.textContent = `读取站点配置失败：${error.message || error}`;
  }
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

async function refreshSiteBehaviorLists() {
  await Promise.all([
    refreshCacheRestoreSiteList(),
    refreshAutoSiteList()
  ]);
}

async function refreshCacheRestoreSiteList() {
  return renderPersistentSiteList({
    element: cacheRestoreSitesList,
    storageKey: "cacheRestoreSites",
    emptyText: "暂无自动恢复缓存站点。请在目标网页的插件弹窗中开启。",
    messageType: BACKGROUND_MESSAGES.CACHE_RESTORE_SITE_UNREGISTER,
    removeError: "移除自动恢复缓存站点失败",
    successText: (site) => `已关闭 ${site} 的自动缓存恢复。`
  });
}

async function refreshAutoSiteList() {
  return renderPersistentSiteList({
    element: autoSitesList,
    storageKey: "autoSites",
    emptyText: "暂无自动翻译站点。请在目标网页的插件弹窗中开启。",
    messageType: BACKGROUND_MESSAGES.AUTO_SITE_UNREGISTER,
    removeError: "移除自动翻译站点失败",
    successText: (site) => `已关闭 ${site} 的自动翻译。`
  });
}

async function renderPersistentSiteList({
  element,
  storageKey,
  emptyText,
  messageType,
  removeError,
  successText
}) {
  element.textContent = "正在读取已授权站点…";
  try {
    const stored = await chrome.storage.local.get([storageKey]);
    const rawSites = stored?.[storageKey];
    const sites = Array.isArray(rawSites) ? [...new Set(rawSites)].sort() : [];
    element.replaceChildren();

    if (!sites.length) {
      element.textContent = emptyText;
      return;
    }

    for (const site of sites) {
      const row = document.createElement("div");
      row.className = "site-row";

      const summary = document.createElement("div");
      summary.className = "site-summary";
      const title = document.createElement("strong");
      title.textContent = site;
      summary.append(title);

      const actions = document.createElement("div");
      actions.className = "site-actions";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "关闭";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          const response = await chrome.runtime.sendMessage({
            type: messageType,
            origin: site
          });
          if (!response?.ok) throw new Error(response?.error || removeError);

          await maybeReleaseSitePermission(site);
          setStatus(successText(site));
          await refreshSiteBehaviorLists();
        } catch (error) {
          setStatus(error.message || String(error), true);
          remove.disabled = false;
        }
      });

      actions.append(remove);
      row.append(summary, actions);
      element.appendChild(row);
    }
  } catch (error) {
    element.textContent = `读取站点失败：${error.message || error}`;
  }
}

async function maybeReleaseSitePermission(site) {
  const pattern = `${site}/*`;
  const {
    cacheRestoreSites = [],
    autoSites = [],
    quickControlSites = []
  } = await chrome.storage.local.get([
    "cacheRestoreSites",
    "autoSites",
    "quickControlSites"
  ]);
  const stillNeeded = [cacheRestoreSites, autoSites, quickControlSites]
    .some((values) => Array.isArray(values) && values.includes(site));
  if (stillNeeded || await isProviderPermission(pattern)) return false;
  return chrome.permissions.remove({ origins: [pattern] });
}

async function isProviderPermission(pattern) {
  const { openAICompatible = {} } = await chrome.storage.local.get(["openAICompatible"]);
  try {
    return getProviderHostPermissionPattern(openAICompatible.baseUrl) === pattern;
  } catch {
    return false;
  }
}

function bindPasswordToggle(button, input) {
  button.addEventListener("click", () => {
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.textContent = visible ? "显示" : "隐藏";
  });
}

function clearProfileEditor() {
  siteOrigin.value = "";
  siteProvider.value = "";
  sitePreset.value = "";
  siteAppearance.value = "";
  siteModel.value = "";
  sitePrompt.value = "";
  siteTargetLanguage.value = "";
}

function populateSitePresetOptions() {
  for (const preset of TRANSLATION_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = `${preset.label} · ${preset.description}`;
    sitePreset.appendChild(option);
  }
}

function populateAppearanceOptions(select, { includeInherit = false } = {}) {
  if (includeInherit) {
    const inherit = document.createElement("option");
    inherit.value = "";
    inherit.textContent = "继承默认外观";
    select.appendChild(inherit);
  }
  for (const appearance of TRANSLATION_APPEARANCES) {
    const option = document.createElement("option");
    option.value = appearance.id;
    option.textContent = `${appearance.label} · ${appearance.description}`;
    select.appendChild(option);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", Boolean(isError));
}

const settingsNavLinks = [...document.querySelectorAll(".settings-nav a[href^='#']")];
for (const link of settingsNavLinks) {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    history.replaceState(null, "", link.getAttribute("href"));
    setActiveSettingsNav(link.getAttribute("href"));
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  });
}
window.addEventListener("hashchange", () => setActiveSettingsNav(location.hash));
setActiveSettingsNav(location.hash || "#general");

function setActiveSettingsNav(hash) {
  for (const link of settingsNavLinks) {
    if (link.getAttribute("href") === hash) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
