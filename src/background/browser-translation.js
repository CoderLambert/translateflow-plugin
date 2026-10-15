import { getConfig, getEffectiveConfig } from "./config.js";
import { getSiteProfile } from "../shared/provider-config.js";
import { BROWSER_ENGINE, browserConfig, hasConfiguredAi } from "../shared/browser-translation.js";

export async function translationEngineSettings(pageUrl, forceBrowser = false) {
  const stored = await getConfig();
  const site = getSiteProfile(stored.siteProfiles, pageUrl);
  const engine = forceBrowser || !hasConfiguredAi(stored, site) ? BROWSER_ENGINE : "ai";
  // Resolve configuration errors here; never hide a broken AI connection.
  if (engine === "ai") await getEffectiveConfig(pageUrl);
  return { engine, enabled: stored.browserTranslationEnabled !== false,
    sourceLanguage: stored.browserSourceLanguage || "auto", targetLanguage: site?.targetLanguage || stored.targetLanguage };
}
export async function translationConfig(pageUrl, options = {}) {
  const settings = await translationEngineSettings(pageUrl, options.forceBrowser === true);
  if (settings.engine !== BROWSER_ENGINE) return getEffectiveConfig(pageUrl);
  if (!settings.enabled) throw Object.assign(new Error("Browser translation is disabled."), { code: "BROWSER_DISABLED" });
  const stored = await getConfig();
  return browserConfig(stored, getSiteProfile(stored.siteProfiles, pageUrl), options.sourceLanguage);
}
