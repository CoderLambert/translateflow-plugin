import { resolveMachineTranslation, rawTranslationSite } from "../shared/machine-translation.js";
import { hasConfiguredAi } from "../shared/browser-translation.js";
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
  resolveTranslationConfigForSite,
  updateSiteProfileAppearance,
  updateSiteProfilePreset
} from "../shared/provider-config.js";
import {
  TRANSLATION_PRESETS,
  getPresetLabel,
  normalizePresetId
} from "../shared/presets.js";
import {
  DEFAULT_APPEARANCE_ID,
  TRANSLATION_APPEARANCES,
  normalizeAppearanceId,
  resolveAppearance
} from "../shared/appearance.js";
import { normalizeOrigin } from "../shared/url.js";
import { normalizeSelectionDepth } from "../shared/selection.js";
import { siteKey as validateSiteKey } from "../shared/reading/validation.js";
import {
  clearTemporaryPresetOverride,
  getTemporaryPresetOverride
} from "./preset-session.js";
import { ensureProviderConnections } from "./provider-connections.js";

export async function getConfig() {
  await ensureProviderConnections();
  const stored = await chrome.storage.local.get(CONFIG_KEYS);
  return normalizeStoredConfig({ ...DEFAULT_CONFIG, ...stored, dictionaryEnabled: stored.dictionaryEnabled ?? await inferInstalledDictionaryPreference() });
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

export async function getEffectiveConfigForSite(rawSiteKey) {
  const trustedSiteKey = validateSiteKey(rawSiteKey, "siteKey");
  const stored = await getConfig();
  const temporaryPreset = await safeTemporaryPreset(trustedSiteKey);
  const resolved = resolveTranslationConfigForSite(stored, trustedSiteKey, temporaryPreset);
  const glossary = resolveEffectiveGlossary(stored.glossary, stored.siteGlossaries, trustedSiteKey);
  if (!glossary.length) return resolved;
  return { ...resolved, glossaryIdentity: glossaryIdentity(glossary),
    prompt: composeGlossaryPrompt(resolved.prompt, glossary) };
}

export async function getEffectiveGlossary(pageUrl = "") {
  const stored = await getConfig();
  return resolveEffectiveGlossary(stored.glossary, stored.siteGlossaries, pageUrl);
}

export async function getEffectiveContext(pageUrl) {
  const stored = await getConfig();
  const machine = resolveMachineTranslation(stored, rawTranslationSite(stored, pageUrl));
  const site = machine ? rawTranslationSite(stored, pageUrl) : getSiteProfile(stored.siteProfiles, pageUrl);
  const { resolved, temporaryPreset } = machine ? { resolved: machine, temporaryPreset: null } : hasConfiguredAi(stored, site)
    ? await resolveBaseConfig(pageUrl)
    : { resolved: { provider: "browser-translator", model: "translator-v1", targetLanguage: site?.targetLanguage || stored.targetLanguage }, temporaryPreset: null };
  const origin = normalizeOrigin(pageUrl);
  const siteProfile = site;
  const glossary = resolveEffectiveGlossary(stored.glossary, stored.siteGlossaries, pageUrl);
  const appearance = resolveAppearance(stored.appearance, siteProfile?.appearance);

  return {
    origin,
    hostname: new URL(origin).hostname,
    provider: resolved.provider,
    engine: resolved.engine || "ai",
    providerLabel: resolved.providerLabel,
    connectionId: resolved.connectionId,
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
    glossaryCount: machine ? 0 : glossary.length,
    appearanceId: appearance.id,
    appearanceLabel: appearance.label,
    appearanceSource: appearance.source,
    appearanceVariables: appearance.variables,
    availablePresets: TRANSLATION_PRESETS.map(({ id, label, description }) => ({ id, label, description })),
    availableAppearances: TRANSLATION_APPEARANCES.map(({ id, label, description }) => ({ id, label, description }))
  };
}

export async function saveSiteAppearance(pageUrl, value) {
  const { siteProfiles = {} } = await chrome.storage.local.get(["siteProfiles"]);
  const updated = updateSiteProfileAppearance(siteProfiles, pageUrl, value);
  await chrome.storage.local.set({ siteProfiles: updated.siteProfiles });
  return getEffectiveContext(pageUrl);
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
  if (current.dictionaryEnabled === undefined) missing.dictionaryEnabled = await inferInstalledDictionaryPreference();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (current[key] === undefined && !Object.hasOwn(missing, key)) missing[key] = value;
  }
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
  await ensureProviderConnections();
  return normalizeStoredConfig({ ...DEFAULT_CONFIG, ...current, ...missing, ...await chrome.storage.local.get(CONFIG_KEYS) });
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
    appearance: normalizeAppearanceId(config?.appearance) || DEFAULT_APPEARANCE_ID,
    selectionExplanationDepth: normalizeSelectionDepth(config?.selectionExplanationDepth),
    siteProfiles: config?.siteProfiles && typeof config.siteProfiles === "object" && !Array.isArray(config.siteProfiles)
      ? config.siteProfiles
      : {},
    glossary: normalizeGlossaryStore(config?.glossary),
    siteGlossaries: normalizeSiteGlossaryStore(config?.siteGlossaries)
  };
}

async function inferInstalledDictionaryPreference() {
  const stored = await chrome.storage.local.get(["tfDictionaryPackStateV1", "tfRichMdictStateV1", "tfRichMdictPreferencesV1"]);
  const structured = Object.values(stored.tfDictionaryPackStateV1?.packs || {}).some(entry => entry?.status === "healthy" && entry.active);
  const rich = Object.entries(stored.tfRichMdictStateV1?.packs || {}).some(([id, entry]) =>
    entry?.status === "healthy" && entry.active && stored.tfRichMdictPreferencesV1?.dictionaries?.[id]?.enabled !== false);
  return structured || rich;
}
