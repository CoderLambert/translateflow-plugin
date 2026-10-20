import { resolveMachineTranslation, rawTranslationSite } from "../shared/machine-translation.js";
import { getConfig, getEffectiveConfig } from "./config.js";
import { BROWSER_ENGINE, browserConfig, hasConfiguredAi } from "../shared/browser-translation.js";
import { selectedTranslationMethod } from "../shared/translation-preferences.js";

export async function translationEngineSettings(pageUrl, options = {}) {
  const request = typeof options === "object" ? options || {} : {};
  const stored = await getConfig(), site = request.surface === "selection-word" ? null : rawTranslationSite(stored, pageUrl);
  const independent = ["subtitle", "assistant", "selection-ai"].includes(request.surface);
  const configured = hasConfiguredAi(stored, site);
  const method = independent ? (request.surface === "subtitle" && !configured ? "browser-local" : "ai")
    : selectedTranslationMethod(stored, site, request.surface, request.temporaryMethod);
  if (method === "free-online") {
    const effective = { ...stored, translationPreferences: { ...stored.translationPreferences,
      ...(request.surface === "selection-word" ? { wordMethod: method } : { textMethod: method }) } };
    const effectiveSite = request.surface === "selection-word" ? null : { ...site, textMethod: method };
    return { ...resolveMachineTranslation(effective, effectiveSite, request.surface), method, enabled: true, configured: true };
  }
  if (method === "ai" && configured) await getEffectiveConfig(request.surface === "selection-word" ? "" : pageUrl);
  return { method, engine: method === "browser-local" ? BROWSER_ENGINE : method === "dictionary" ? "dictionary" : "ai",
    enabled: independent ? stored.browserTranslationEnabled !== false : true, configured,
    sourceLanguage: stored.browserSourceLanguage || "auto", targetLanguage: site?.targetLanguage || stored.targetLanguage };
}
export async function translationConfig(pageUrl, options = {}) {
  const settings = await translationEngineSettings(pageUrl, options);
  if (settings.engine === "machine-translation") return settings;
  if (settings.engine === "dictionary") throw Object.assign(new Error("所选方式只查询词典。"), { code: "DICTIONARY_ONLY" });
  if (settings.engine !== BROWSER_ENGINE) {
    if (!settings.configured) throw Object.assign(new Error("请先配置 AI 服务。"), { code: "AI_REQUIRED" });
    return getEffectiveConfig(options.surface === "selection-word" ? "" : pageUrl);
  }
  const stored = await getConfig();
  return browserConfig(stored, options.surface === "selection-word" ? null : rawTranslationSite(stored, pageUrl), options.sourceLanguage);
}
