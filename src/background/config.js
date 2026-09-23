import {
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  DEFAULT_OPENAI_COMPATIBLE
} from "../shared/constants.js";
import { resolveTranslationConfig } from "../shared/provider-config.js";
import { composeGlossaryPrompt, normalizeGlossary, resolveEffectiveGlossary } from "../shared/glossary.js";

export async function getConfig() {
  const stored = await chrome.storage.local.get(CONFIG_KEYS);
  return normalizeStoredConfig({ ...DEFAULT_CONFIG, ...stored });
}

export async function getEffectiveConfig(pageUrl = "") {
  const stored = await getConfig();
  const resolved = resolveTranslationConfig(stored, pageUrl);
  const glossary = resolveEffectiveGlossary(stored.glossary, stored.siteGlossaries, pageUrl);
  if (!glossary.length) return resolved;
  return { ...resolved, glossary, prompt: composeGlossaryPrompt(resolved.prompt, glossary) };
}

export async function ensureConfigDefaults() {
  const current = await chrome.storage.local.get(CONFIG_KEYS);
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (current[key] === undefined) missing[key] = value;
  }
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
  return normalizeStoredConfig({ ...DEFAULT_CONFIG, ...current, ...missing });
}

export async function removeLegacyV1Cache() {
  const all = await chrome.storage.local.get(null);
  const legacyKeys = Object.keys(all).filter((key) => key.startsWith("abt-cache-v1:"));
  if (legacyKeys.length) await chrome.storage.local.remove(legacyKeys);
}

function normalizeStoredConfig(config) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    openAICompatible: {
      ...DEFAULT_OPENAI_COMPATIBLE,
      ...(config?.openAICompatible || {})
    },
    siteProfiles: config?.siteProfiles && typeof config.siteProfiles === "object" && !Array.isArray(config.siteProfiles)
      ? config.siteProfiles
      : {},
    glossary: normalizeGlossary(config?.glossary),
    siteGlossaries: config?.siteGlossaries && typeof config.siteGlossaries === "object" && !Array.isArray(config.siteGlossaries)
      ? Object.fromEntries(Object.entries(config.siteGlossaries).map(([origin, entries]) => [origin, normalizeGlossary(entries)]))
      : {}
  };
}
