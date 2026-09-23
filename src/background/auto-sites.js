import {
  CONTENT_SCRIPT_FILES,
  CONTENT_STYLE_FILES,
  LEGACY_SITE_SCRIPT_PREFIXES,
  SITE_SCRIPT_PREFIX
} from "../shared/constants.js";
import { sha256 } from "../shared/hash.js";
import { getOriginMatchPattern, normalizeOrigin } from "../shared/url.js";

const STORAGE_KEYS = ["autoSites", "quickControlSites", "quickControlHiddenSites"];

export async function registerAutoSite(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  await assertOriginPermission(origin, "尚未获得此站点的自动翻译权限。");
  const state = await readState();
  state.autoSites = addOrigin(state.autoSites, origin);
  await writeState(state);
  await syncOriginRegistration(origin);
  return { origin, enabled: true };
}

export async function unregisterAutoSite(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  const state = await readState();
  state.autoSites = removeOrigin(state.autoSites, origin);
  await writeState(state);
  await syncOriginRegistration(origin);
  return { origin, enabled: false };
}

export async function registerQuickControlSite(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  await assertOriginPermission(origin, "尚未获得此站点的 Quick Control 权限。");
  const state = await readState();
  state.quickControlSites = addOrigin(state.quickControlSites, origin);
  state.quickControlHiddenSites = removeOrigin(state.quickControlHiddenSites, origin);
  await writeState(state);
  await syncOriginRegistration(origin);
  return { origin, enabled: true, hidden: false };
}

export async function unregisterQuickControlSite(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  const state = await readState();
  state.quickControlSites = removeOrigin(state.quickControlSites, origin);
  await writeState(state);
  await syncOriginRegistration(origin);
  return { origin, enabled: false };
}

export async function hideQuickControlSite(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  const state = await readState();
  state.quickControlSites = removeOrigin(state.quickControlSites, origin);
  state.quickControlHiddenSites = addOrigin(state.quickControlHiddenSites, origin);
  await writeState(state);
  await syncOriginRegistration(origin);
  return { origin, enabled: false, hidden: true };
}

export async function showQuickControlSite(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  const state = await readState();
  state.quickControlHiddenSites = removeOrigin(state.quickControlHiddenSites, origin);
  await writeState(state);
  return { origin, hidden: false };
}

export async function syncSiteRegistrations() {
  const state = await readState();
  const hidden = new Set(normalizeOrigins(state.quickControlHiddenSites));
  const validAuto = await permittedOrigins(state.autoSites);
  const validQuick = (await permittedOrigins(state.quickControlSites))
    .filter((origin) => !hidden.has(origin));
  const desiredOrigins = [...new Set([...validAuto, ...validQuick])].sort();
  const desiredIds = new Set();

  for (const origin of desiredOrigins) {
    try {
      await registerSiteScript(origin);
      desiredIds.add(await getSiteScriptId(origin));
    } catch {
      // Keep service-worker startup resilient if one site fails.
    }
  }

  const registered = await chrome.scripting.getRegisteredContentScripts();
  const prefixes = [SITE_SCRIPT_PREFIX, ...LEGACY_SITE_SCRIPT_PREFIXES];
  const staleIds = registered
    .map((item) => item.id)
    .filter((id) => prefixes.some((prefix) => id.startsWith(prefix)) && !desiredIds.has(id));
  if (staleIds.length) await chrome.scripting.unregisterContentScripts({ ids: staleIds });

  const next = {
    autoSites: validAuto,
    quickControlSites: validQuick,
    quickControlHiddenSites: [...hidden].sort()
  };
  if (!sameState(state, next)) await writeState(next);
  return next;
}

export const syncAutoSiteRegistrations = syncSiteRegistrations;

async function syncOriginRegistration(origin) {
  const state = await readState();
  const hidden = new Set(normalizeOrigins(state.quickControlHiddenSites));
  const desired = normalizeOrigins(state.autoSites).includes(origin)
    || (normalizeOrigins(state.quickControlSites).includes(origin) && !hidden.has(origin));
  const match = getOriginMatchPattern(origin);
  const permitted = await chrome.permissions.contains({ origins: [match] });

  if (desired && permitted) {
    await registerSiteScript(origin);
    return;
  }

  const candidateIds = [
    await getSiteScriptId(origin),
    ...await Promise.all(LEGACY_SITE_SCRIPT_PREFIXES.map((prefix) => getLegacyScriptId(origin, prefix)))
  ];
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registered.map((item) => item.id));
  const ids = candidateIds.filter((id) => registeredIds.has(id));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
}

async function registerSiteScript(origin) {
  const id = await getSiteScriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  await chrome.scripting.registerContentScripts([{
    id,
    matches: [getOriginMatchPattern(origin)],
    js: [...CONTENT_SCRIPT_FILES],
    css: [...CONTENT_STYLE_FILES],
    runAt: "document_idle",
    persistAcrossSessions: true
  }]);
}

async function assertOriginPermission(origin, message) {
  const permitted = await chrome.permissions.contains({
    origins: [getOriginMatchPattern(origin)]
  });
  if (!permitted) throw new Error(message);
}

async function permittedOrigins(values) {
  const result = [];
  for (const origin of normalizeOrigins(values)) {
    if (await chrome.permissions.contains({ origins: [getOriginMatchPattern(origin)] })) {
      result.push(origin);
    }
  }
  return result.sort();
}

async function readState() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  return {
    autoSites: normalizeOrigins(stored.autoSites),
    quickControlSites: normalizeOrigins(stored.quickControlSites),
    quickControlHiddenSites: normalizeOrigins(stored.quickControlHiddenSites)
  };
}

async function writeState(state) {
  await chrome.storage.local.set({
    autoSites: normalizeOrigins(state.autoSites),
    quickControlSites: normalizeOrigins(state.quickControlSites),
    quickControlHiddenSites: normalizeOrigins(state.quickControlHiddenSites)
  });
}

function normalizeOrigins(values) {
  const result = [];
  for (const raw of Array.isArray(values) ? values : []) {
    try {
      result.push(normalizeOrigin(raw));
    } catch {}
  }
  return [...new Set(result)].sort();
}

function addOrigin(values, origin) {
  return [...new Set([...normalizeOrigins(values), origin])].sort();
}

function removeOrigin(values, origin) {
  return normalizeOrigins(values).filter((item) => item !== origin);
}

function sameState(a, b) {
  return JSON.stringify({
    autoSites: normalizeOrigins(a.autoSites),
    quickControlSites: normalizeOrigins(a.quickControlSites),
    quickControlHiddenSites: normalizeOrigins(a.quickControlHiddenSites)
  }) === JSON.stringify({
    autoSites: normalizeOrigins(b.autoSites),
    quickControlSites: normalizeOrigins(b.quickControlSites),
    quickControlHiddenSites: normalizeOrigins(b.quickControlHiddenSites)
  });
}

async function getSiteScriptId(origin) {
  return `${SITE_SCRIPT_PREFIX}${(await sha256(origin)).slice(0, 20)}`;
}

async function getLegacyScriptId(origin, prefix) {
  return `${prefix}${(await sha256(origin)).slice(0, 20)}`;
}
