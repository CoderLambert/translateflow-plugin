// Browser model identity is deliberately independent of AI prompts/credentials.
export const BROWSER_ENGINE = "browser-translator";
export const BROWSER_ENGINE_VERSION = "translator-v1";
export const BROWSER_TRANSLATION_ACTIONS = Object.freeze({ CAPABILITY: "capability", PREPARE: "prepare", EXECUTE: "execute", CANCEL: "cancel" });
export const LANGUAGE_NAMES = Object.freeze({ ar: "Arabic", bg: "Bulgarian", bn: "Bengali", cs: "Czech", da: "Danish", de: "German", el: "Greek", en: "English", es: "Spanish", fi: "Finnish", fr: "French", he: "Hebrew", hi: "Hindi", hr: "Croatian", hu: "Hungarian", id: "Indonesian", it: "Italian", ja: "Japanese", kn: "Kannada", ko: "Korean", lt: "Lithuanian", mr: "Marathi", nl: "Dutch", no: "Norwegian", pl: "Polish", pt: "Portuguese", ro: "Romanian", ru: "Russian", sk: "Slovak", sl: "Slovenian", sv: "Swedish", ta: "Tamil", te: "Telugu", th: "Thai", tr: "Turkish", uk: "Ukrainian", vi: "Vietnamese", zh: "Simplified Chinese", "zh-Hant": "Traditional Chinese" });
const ALIASES = Object.freeze({ "simplified chinese": "zh", "chinese": "zh", "简体中文": "zh", "中文": "zh", "简体汉语": "zh", "traditional chinese": "zh-Hant", "繁體中文": "zh-Hant", "繁体中文": "zh-Hant", "英语": "en", "英文": "en", "日语": "ja", "韩语": "ko", "法语": "fr", "德语": "de", "西班牙语": "es" });
export function browserLanguage(value) {
  const raw = String(value || "").trim(), lower = raw.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  const named = Object.entries(LANGUAGE_NAMES).find(([, name]) => name.toLowerCase() === lower);
  if (named) return named[0];
  const tag = raw.replace(/_/g, "-");
  if (/^zh-hans(?:-|$)/i.test(tag)) return "zh";
  if (/^zh-(?:hant|tw|hk|mo)(?:-|$)/i.test(tag)) return "zh-Hant";
  const code = lower.split(/[-_]/)[0];
  return Object.hasOwn(LANGUAGE_NAMES, code) && /^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(raw) ? code : "";
}
// Legacy migration creates a blank default DeepSeek connection even on a fresh
// install. That exact untouched placeholder is not a configured AI service.
export function hasConfiguredAi(stored, siteProfile = null) {
  if (siteProfile?.serviceRef || siteProfile?.provider) return true;
  if (stored.aiServiceConfigured === true) return true;
  const service = stored.defaultService;
  if (service?.kind === "chatgpt-plan" || stored.provider === "chatgpt-plan") return true;
  if (service?.connectionId) {
    const connection = stored.providerConnections?.[service.connectionId];
    if (!connection) return true; // Invalid references must fail visibly.
    return !(connection.id === "deepseek" && connection.revision === 1 &&
      connection.platform === "deepseek" && connection.baseUrl === "https://api.deepseek.com" &&
      !String(stored.providerCredentials?.[connection.credentialId] || "").trim() &&
      !String(stored.apiKey || "").trim());
  }
  return Boolean(String(stored.apiKey || "").trim() || stored.openAICompatible?.baseUrl || stored.provider === "openai-compatible");
}
export function browserConfig(stored, siteProfile, sourceLanguage) {
  const targetLanguage = browserLanguage(siteProfile?.targetLanguage || stored.targetLanguage);
  const source = browserLanguage(sourceLanguage || stored.browserSourceLanguage);
  if (!targetLanguage || !source) throw Object.assign(new Error("Select a supported language."), { code: "BROWSER_LANGUAGE" });
  return { provider: BROWSER_ENGINE, model: BROWSER_ENGINE_VERSION, prompt: "", targetLanguage, sourceLanguage: source, engine: BROWSER_ENGINE };
}

// Page locale never identifies a Latin language or a language using shared Han.
export function languageHintMatchesText(text, language) {
  const code = browserLanguage(language), value = String(text || "");
  const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
  const hangul = /\p{Script=Hangul}/u.test(value);
  return code === "ja" ? kana && !hangul : code === "ko" ? hangul && !kana : false;
}
