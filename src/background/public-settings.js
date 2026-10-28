const KEYS = ["translationPreferences", "browserTranslationEnabled", "browserSourceLanguage", "dictionaryEnabled", "cacheRestoreSites", "autoSites", "quickControlSites", "quickControlHiddenSites", "youtubeSubtitleMode", "youtubeSubtitleSize", "uiLocale", "appearance", "siteProfiles"];

export async function readPublicSettings() { return chrome.storage.local.get(KEYS); }

export async function writePublicSettings(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const patch = {};
  if (Object.hasOwn(input, "youtubeSubtitleMode")) {
    if (!["bilingual", "translated", "original", "off"].includes(input.youtubeSubtitleMode)) throw configError("字幕模式无效。");
    patch.youtubeSubtitleMode = input.youtubeSubtitleMode;
  }
  if (Object.hasOwn(input, "youtubeSubtitleSize")) {
    if (!["small", "standard", "large"].includes(input.youtubeSubtitleSize)) throw configError("字幕大小无效。");
    patch.youtubeSubtitleSize = input.youtubeSubtitleSize;
  }
  if (!Object.keys(patch).length || Object.keys(input).length !== Object.keys(patch).length) throw configError("公开设置写入无效。");
  await chrome.storage.local.set(patch);
  return { saved: true };
}

function configError(message) { return Object.assign(new Error(message), { code: "CONFIG" }); }
