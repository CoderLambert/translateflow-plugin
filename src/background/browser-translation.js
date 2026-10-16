import { resolveMachineTranslation, rawTranslationSite } from "../shared/machine-translation.js";
import { getConfig, getEffectiveConfig } from "./config.js";
import { getSiteProfile } from "../shared/provider-config.js";
import { BROWSER_ENGINE, browserConfig, hasConfiguredAi } from "../shared/browser-translation.js";

export async function translationEngineSettings(pageUrl, options = {}) {
  const request = typeof options === "boolean"
    ? { forceBrowser: options, surface: options ? "selection-word" : "page" }
    : (options || {});
  const stored = await getConfig();
  const machine = resolveMachineTranslation(stored, rawTranslationSite(stored, pageUrl), request.surface);
  if (machine) return { ...machine, enabled: true, configured: true };
  const site = getSiteProfile(stored.siteProfiles, pageUrl);
  const configured = hasConfiguredAi(stored, site);
  const browserEligible = request.surface === "selection-word";
  const engine = browserEligible && (request.forceBrowser === true || !configured) ? BROWSER_ENGINE : "ai";
  // Resolve configuration errors here; never hide a broken AI connection.
  if (engine === "ai" && configured) await getEffectiveConfig(pageUrl);
  return { engine, enabled: stored.browserTranslationEnabled !== false,
    configured, sourceLanguage: stored.browserSourceLanguage || "auto", targetLanguage: site?.targetLanguage || stored.targetLanguage };
}
export async function translationConfig(pageUrl, options = {}) {
  const settings = await translationEngineSettings(pageUrl, options);
  if (settings.engine === "machine-translation") return settings;
  if (settings.engine !== BROWSER_ENGINE) return getEffectiveConfig(pageUrl);
  if (!settings.enabled) throw Object.assign(new Error("Browser translation is disabled."), { code: "BROWSER_DISABLED" });
  const stored = await getConfig();
  return browserConfig(stored, getSiteProfile(stored.siteProfiles, pageUrl), options.sourceLanguage);
}
