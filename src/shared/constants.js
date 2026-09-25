import { DEFAULT_APPEARANCE_ID } from "./appearance.js";

export const DEFAULT_PROMPT = [
  "You are a professional translator.", "Translate the provided English web-page segments into natural Simplified Chinese.",
  "Preserve technical terms, product names, API names, variable names, URLs, Markdown-like symbols and code-like tokens when appropriate.",
  "Do not add explanations.", 'Return valid JSON only, exactly in this shape: {"translations":[{"id":"...","text":"..."}] }.',
  "Every input id must appear exactly once in the output."
].join("\n");
export const PROVIDER_IDS = Object.freeze({ DEEPSEEK: "deepseek", OPENAI_COMPATIBLE: "openai-compatible" });
export const DEFAULT_OPENAI_COMPATIBLE = Object.freeze({ apiKey: "", baseUrl: "", model: "" });
export const GLOSSARY_STORAGE_VERSION = 1;
export const DEFAULT_GLOSSARY_STORE = Object.freeze({ version: GLOSSARY_STORAGE_VERSION, entries: Object.freeze([]) });
export const DEFAULT_SITE_GLOSSARY_STORE = Object.freeze({ version: GLOSSARY_STORAGE_VERSION, sites: Object.freeze({}) });
export const DEFAULT_CONFIG = Object.freeze({
  apiKey: "", provider: PROVIDER_IDS.DEEPSEEK, model: "deepseek-flash", targetLanguage: "Simplified Chinese",
  appearance: DEFAULT_APPEARANCE_ID, cacheMaxMB: 200, cacheRestoreSites: [], autoSites: [], quickControlSites: [], quickControlHiddenSites: [],
  youtubeSubtitleMode: "bilingual", youtubeSubtitleSize: "standard", prompt: DEFAULT_PROMPT, openAICompatible: DEFAULT_OPENAI_COMPATIBLE,
  siteProfiles: {}, glossary: DEFAULT_GLOSSARY_STORE, siteGlossaries: DEFAULT_SITE_GLOSSARY_STORE
});
export const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG));
export const CACHE_SCHEMA_VERSION = 2;
export const BACKGROUND_MESSAGES = Object.freeze({
  TRANSLATE_BATCH: "TRANSLATE_BATCH", SUBTITLE_TRANSLATE_BATCH: "SUBTITLE_TRANSLATE_BATCH", CANCEL_TRANSLATION: "CANCEL_TRANSLATION",
  TEST_API: "TEST_API", CACHE_LOOKUP: "CACHE_LOOKUP", CACHE_STORE: "CACHE_STORE", CACHE_PAGE_STATUS: "CACHE_PAGE_STATUS",
  CACHE_CLEAR_PAGE: "CACHE_CLEAR_PAGE", CACHE_CLEAR_ALL: "CACHE_CLEAR_ALL", CACHE_STATS: "CACHE_STATS", CACHE_PRUNE: "CACHE_PRUNE",
  CACHE_RESTORE_SITE_REGISTER: "CACHE_RESTORE_SITE_REGISTER", CACHE_RESTORE_SITE_UNREGISTER: "CACHE_RESTORE_SITE_UNREGISTER",
  AUTO_SITE_REGISTER: "AUTO_SITE_REGISTER", AUTO_SITE_UNREGISTER: "AUTO_SITE_UNREGISTER", QUICK_CONTROL_SITE_REGISTER: "QUICK_CONTROL_SITE_REGISTER",
  QUICK_CONTROL_SITE_UNREGISTER: "QUICK_CONTROL_SITE_UNREGISTER", QUICK_CONTROL_SITE_HIDE: "QUICK_CONTROL_SITE_HIDE", QUICK_CONTROL_SITE_SHOW: "QUICK_CONTROL_SITE_SHOW",
  SITE_APPEARANCE_SAVE: "SITE_APPEARANCE_SAVE", OPEN_OPTIONS: "OPEN_OPTIONS", EFFECTIVE_CONTEXT: "EFFECTIVE_CONTEXT",
  TEMP_PRESET_SET: "TEMP_PRESET_SET", SITE_PRESET_SAVE: "SITE_PRESET_SAVE", YOUTUBE_BRIDGE_INSTALL: "YOUTUBE_BRIDGE_INSTALL"
});
export const CONTENT_MESSAGES = Object.freeze({
  TRANSLATE_PAGE: "ABT_TRANSLATE_PAGE", RESTORE_CACHE: "ABT_RESTORE_CACHE", ENABLE_AUTO: "ABT_ENABLE_AUTO", DISABLE_AUTO: "ABT_DISABLE_AUTO",
  CACHE_STATUS: "ABT_CACHE_STATUS", CLEAR_PAGE_CACHE: "ABT_CLEAR_PAGE_CACHE", TOGGLE_TRANSLATIONS: "ABT_TOGGLE_TRANSLATIONS",
  CLEAR_TRANSLATIONS: "ABT_CLEAR_TRANSLATIONS", STATUS: "ABT_STATUS", TASK_STATUS: "TF_TASK_STATUS", CANCEL_TASK: "TF_CANCEL_TASK",
  QUICK_CONTROL_SHOW: "TF_QUICK_CONTROL_SHOW", QUICK_CONTROL_TOGGLE: "TF_QUICK_CONTROL_TOGGLE"
});
export const CONTENT_SCRIPT_FILES = Object.freeze([
  "src/content/runtime.js", "src/content/ui/tokens.js", "src/content/ui/quick-control-styles.js", "src/content/ui/host.js", "src/content/ui/primitives.js", "src/content/ui/toast.js",
  "src/content/appearance.js", "src/content/tasks.js", "src/content/structured.js", "src/content/dom.js", "src/content/batch.js",
  "src/content/processor.js", "src/content/auto.js", "src/content/subtitles/source.js", "src/content/subtitles/sources/text-track.js",
  "src/content/subtitles/youtube-bridge-protocol.js", "src/content/subtitles/youtube-timedtext.js",
  "src/content/subtitles/sources/youtube.js", "src/content/subtitles/pipeline.js", "src/content/subtitles/renderer.js", "src/content/subtitles/controller.js",
  "src/content/selection/selection.js", "src/content/selection/popover.js", "src/content/selection/controller.js",
  "src/content/quick-control-view.js", "src/content/quick-control.js", "content.js"
]);
export const CONTENT_STYLE_FILES = Object.freeze(["content.css"]);
export const SITE_SCRIPT_PREFIX = "tf_site_";
export const LEGACY_SITE_SCRIPT_PREFIXES = Object.freeze(["tf_auto_", "abt_auto_"]);
