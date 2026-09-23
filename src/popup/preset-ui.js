import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import {
  TRANSLATION_PRESETS,
  getPresetLabel
} from "../shared/presets.js";

export function initializePresetUi({
  getActiveSite,
  translateCurrentPage,
  refreshCacheStatus,
  setStatus
}) {
  const $ = (id) => document.getElementById(id);
  const card = $("effectiveContext");
  const siteValue = $("contextSite");
  const modeValue = $("contextMode");
  const providerValue = $("contextProvider");
  const modelValue = $("contextModel");
  const presetSelect = $("presetSelect");
  const applyButton = $("applyPreset");
  const saveButton = $("savePreset");
  const hint = $("presetHint");

  if (
    !card || !siteValue || !modeValue || !providerValue || !modelValue
    || !presetSelect || !applyButton || !saveButton || !hint
  ) {
    return { refresh: async () => {}, setDisabled: () => {} };
  }

  populateOptions();
  applyButton.addEventListener("click", () => applyPreset(false));
  saveButton.addEventListener("click", () => applyPreset(true));

  return {
    refresh,
    setDisabled(disabled) {
      applyButton.disabled = disabled;
      saveButton.disabled = disabled;
      presetSelect.disabled = disabled;
    }
  };

  async function refresh() {
    try {
      const site = await getActiveSite();
      const response = await chrome.runtime.sendMessage({
        type: BACKGROUND_MESSAGES.EFFECTIVE_CONTEXT,
        pageUrl: site.tab.url
      });
      if (!response?.ok) throw new Error(response?.error || "无法读取有效翻译配置。");

      renderContext(response.context);
      card.hidden = false;
    } catch (error) {
      card.hidden = true;
      hint.textContent = error?.message || "当前页面无法读取翻译模式。";
    }
  }

  async function applyPreset(persist) {
    applyButton.disabled = true;
    saveButton.disabled = true;
    presetSelect.disabled = true;

    try {
      const site = await getActiveSite();
      const before = await readContext(site.tab.url);
      const type = persist
        ? BACKGROUND_MESSAGES.SITE_PRESET_SAVE
        : BACKGROUND_MESSAGES.TEMP_PRESET_SET;
      const response = await chrome.runtime.sendMessage({
        type,
        pageUrl: site.tab.url,
        preset: presetSelect.value
      });
      if (!response?.ok) throw new Error(response?.error || "翻译模式切换失败。");

      renderContext(response.context);
      await refreshCacheStatus();

      const behaviorChanged = before?.presetId !== response.context?.presetId;
      if (response.context?.hasSitePromptOverride) {
        setStatus(
          persist
            ? "模式已保存到本站，但本站自定义 Prompt 优先，因此当前翻译行为不变。"
            : "已记录临时模式，但本站自定义 Prompt 优先，因此当前翻译行为不变。"
        );
        return;
      }

      setStatus(persist ? "翻译模式已保存到本站。" : "已临时切换当前站点的翻译模式。");
      if (behaviorChanged) await translateCurrentPage();
    } catch (error) {
      setStatus(error?.message || String(error), true);
    } finally {
      applyButton.disabled = false;
      saveButton.disabled = false;
      presetSelect.disabled = false;
    }
  }

  async function readContext(pageUrl) {
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGES.EFFECTIVE_CONTEXT,
      pageUrl
    });
    return response?.ok ? response.context : null;
  }

  function renderContext(context) {
    if (!context) return;

    siteValue.textContent = context.hostname || context.origin || "—";
    providerValue.textContent = formatProvider(context.provider);
    modelValue.textContent = context.model || "—";

    if (context.hasSitePromptOverride) {
      modeValue.textContent = "Custom Prompt";
    } else {
      modeValue.textContent = context.presetLabel || "Default";
    }

    if (context.temporaryPresetActive) {
      presetSelect.value = context.temporaryPresetId || "none";
    } else if (context.savedPresetId) {
      presetSelect.value = context.savedPresetId;
    } else {
      presetSelect.value = "inherit";
    }

    hint.textContent = describeContext(context);
  }

  function populateOptions() {
    presetSelect.replaceChildren(
      option("inherit", "继承本站设置"),
      option("none", "无 Preset / 使用默认 Prompt"),
      ...TRANSLATION_PRESETS.map((preset) => option(
        preset.id,
        `${preset.label} · ${preset.description}`
      ))
    );
  }
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function formatProvider(provider) {
  if (provider === "openai-compatible") return "OpenAI-compatible";
  if (provider === "deepseek") return "DeepSeek";
  return provider || "—";
}

function describeContext(context) {
  if (context.hasSitePromptOverride) {
    const configured = getPresetLabel(context.selectedPresetId);
    return configured
      ? `本站自定义 Prompt 优先；已配置 ${configured}，当前不生效。`
      : "本站自定义 Prompt 优先。";
  }

  if (context.presetSource === "temporary") {
    return context.presetId
      ? `临时模式：${getPresetLabel(context.presetId)}；浏览器会话结束后自动清除。`
      : "临时关闭 Preset；浏览器会话结束后自动清除。";
  }

  if (context.presetSource === "site") {
    return `本站已保存模式：${getPresetLabel(context.presetId)}。`;
  }

  return context.glossaryCount
    ? `默认 Prompt · 当前有效术语 ${context.glossaryCount} 条。`
    : "使用默认/自定义全局 Prompt。";
}
