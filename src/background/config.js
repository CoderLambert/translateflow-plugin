import {
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  DEFAULT_OPENAI_COMPATIBLE
} from "../shared/constants.js";
import {
  composeGlossaryPrompt,
  glossaryIdentity,
  normalizeGlossaryStore,
  normalizeSiteGlossaryStore,
  resolveEffectiveGlossary
} from "../shared/glossary.js";
import {
  getSiteProfile,
  resolveTranslationConfig,
  updateSiteProfilePreset
} from "../shared/provider-config.js";
import {
  getPresetLabel,
  normalizePresetId
} from "../shared/presets.js";
import { normalizeOrigin } from "../shared/url.js";
import {
  clearTemporaryPresetOverride,
  getTemporaryPresetOverride
} from "./preset-session.js";

export async function getConfig() {
  const stored = await chrome.storage.local.get(CONFIG_KEYS);
  return normalizeStoredConfig({ ...DEFAULT_CONFIG, ...stored });
}

export async function getEffectiveConfig(pageUrl = "") {
  const { stored, resolved } = await resolveBaseConfig(pageUrl);
  const glossary = resolveEffectiveGlossary(stored.glossary, stored.siteGlossaries, pageUrl);

  if (!glossary.length) return resolved;

  return {
    ...resolved,
    glossaryIdentity: glossaryIdentity(glossary),
    prompt: composeGlossaryPrompt(resolved.prompt, glossary)
  };
}

export async function getEffectiveContext(pageUrl) {
  const { stored, resolved, temporaryPreset } = await resolveBaseConfig(pageUrl);
  const origin = normalizeOrigin(pageUrl);
  const siteProfile = getSiteProfile(stored.siteProfiles, pageUrl);
  const glossary = resolveEffectiveGlossary(stored.glossary, stored.siteGlossaries, pageUrl);

  return {
    origin,
    hostname: new URL(origin).hostname,
    provider: resolved.provider,
    model: resolved.model,
    targetLanguage: resolved.targetLanguage,
    presetId: resolved.presetId,
    presetLabel: getPresetLabel(resolved.presetId),
    presetSource: resolved.presetSource,
    selectedPresetId: resolved.selectedPresetId,
    savedPresetId: normalizePresetId(siteProfile?.preset),
    temporaryPresetActive: Boolean(temporaryPreset?.active),
    temporaryPresetId: normalizePresetId(temporaryPreset?.presetId),
    hasSiteProfile: Boolean(siteProfile),
    hasSitePromptOverride: Boolean(resolved.hasSitePromptOverride),
    glossaryCount: glossary.length
  };
}

export async function saveSitePreset(pageUrl, value) {
  const { siteProfiles = {} } = await chrome.storage.local.get(["siteProfiles"]);
  const updated = updateSiteProfilePreset(siteProfiles, pageUrl, value);

  await chrome.storage.local.set({ siteProfiles: updated.siteProfiles });
  await clearTemporaryPresetOverride(pageUrl);
  return getEffectiveContext(pageUrl);
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

async function resolveBaseConfig(pageUrl) {
  const stored = await getConfig();
  const temporaryPreset = await safeTemporaryPreset(pageUrl);
  const resolved = resolveTranslationConfig(stored, pageUrl, temporaryPreset);
  return { stored, resolved, temporaryPreset };
}

async function safeTemporaryPreset(pageUrl) {
  if (!pageUrl) return { active: false, presetId: "" };
  try {
    return await getTemporaryPresetOverride(pageUrl);
  } catch {
    return { active: false, presetId: "" };
  }
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
    glossary: normalizeGlossaryStore(config?.glossary),
    siteGlossaries: normalizeSiteGlossaryStore(config?.siteGlossaries)
  };
}
