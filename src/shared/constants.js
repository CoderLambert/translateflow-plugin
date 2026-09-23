export const DEFAULT_PROMPT = [
  "You are a professional translator.",
  "Translate the provided English web-page segments into natural Simplified Chinese.",
  "Preserve technical terms, product names, API names, variable names, URLs, Markdown-like symbols and code-like tokens when appropriate.",
  "Do not add explanations.",
  'Return valid JSON only, exactly in this shape: {"translations":[{"id":"...","text":"..."}] }.',
  "Every input id must appear exactly once in the output."
].join("\n");

export const PROVIDER_IDS = Object.freeze({
  DEEPSEEK: "deepseek",
  OPENAI_COMPATIBLE: "openai-compatible"
});

export const DEFAULT_OPENAI_COMPATIBLE = Object.freeze({
  apiKey: "",
  baseUrl: "",
  model: ""
});

export const DEFAULT_CONFIG = Object.freeze({
  apiKey: "",
  provider: PROVIDER_IDS.DEEPSEEK,
  model: "deepseek-flash",
  targetLanguage: "Simplified Chinese",
  cacheMaxMB: 200,
  autoSites: [],
  prompt: DEFAULT_PROMPT,
  openAICompatible: DEFAULT_OPENAI_COMPATIBLE,
  siteProfiles: {}
});

export const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG));
export const CACHE_SCHEMA_VERSION = 2;

export const BACKGROUND_MESSAGES = Object.freeze({
  TRANSLATE_BATCH: "TRANSLATE_BATCH",
  TEST_API: "TEST_API",
  CACHE_LOOKUP: "CACHE_LOOKUP",
  CACHE_STORE: "CACHE_STORE",
  CACHE_PAGE_STATUS: "CACHE_PAGE_STATUS",
  CACHE_CLEAR_PAGE: "CACHE_CLEAR_PAGE",
  CACHE_CLEAR_ALL: "CACHE_CLEAR_ALL",
  CACHE_STATS: "CACHE_STATS",
  CACHE_PRUNE: "CACHE_PRUNE",
  AUTO_SITE_REGISTER: "AUTO_SITE_REGISTER",
  AUTO_SITE_UNREGISTER: "AUTO_SITE_UNREGISTER"
});

export const CONTENT_MESSAGES = Object.freeze({
  TRANSLATE_PAGE: "ABT_TRANSLATE_PAGE",
  RESTORE_CACHE: "ABT_RESTORE_CACHE",
  ENABLE_AUTO: "ABT_ENABLE_AUTO",
  DISABLE_AUTO: "ABT_DISABLE_AUTO",
  CACHE_STATUS: "ABT_CACHE_STATUS",
  CLEAR_PAGE_CACHE: "ABT_CLEAR_PAGE_CACHE",
  TOGGLE_TRANSLATIONS: "ABT_TOGGLE_TRANSLATIONS",
  CLEAR_TRANSLATIONS: "ABT_CLEAR_TRANSLATIONS",
  STATUS: "ABT_STATUS"
});

export const CONTENT_SCRIPT_FILES = Object.freeze([
  "src/content/runtime.js",
  "src/content/dom.js",
  "src/content/batch.js",
  "src/content/processor.js",
  "src/content/auto.js",
  "content.js"
]);

export const CONTENT_STYLE_FILES = Object.freeze(["content.css"]);
export const AUTO_SCRIPT_PREFIX = "tf_auto_";
export const LEGACY_AUTO_SCRIPT_PREFIXES = Object.freeze(["abt_auto_"]);
