import {
  AUTO_SCRIPT_PREFIX,
  CONTENT_SCRIPT_FILES,
  CONTENT_STYLE_FILES,
  LEGACY_AUTO_SCRIPT_PREFIXES
} from "../shared/constants.js";
import { sha256 } from "../shared/hash.js";
import { getOriginMatchPattern, normalizeOrigin } from "../shared/url.js";

export async function registerAutoSite(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  const match = getOriginMatchPattern(origin);
  const permitted = await chrome.permissions.contains({ origins: [match] });
  if (!permitted) throw new Error("尚未获得此站点的自动翻译权限。");

  const id = await getAutoScriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });

  await chrome.scripting.registerContentScripts([{
    id,
    matches: [match],
    js: [...CONTENT_SCRIPT_FILES],
    css: [...CONTENT_STYLE_FILES],
    runAt: "document_idle",
    persistAcrossSessions: true
  }]);

  const { autoSites = [] } = await chrome.storage.local.get(["autoSites"]);
  const next = [...new Set([...(Array.isArray(autoSites) ? autoSites : []), origin])].sort();
  await chrome.storage.local.set({ autoSites: next });
  return { origin, enabled: true };
}

export async function unregisterAutoSite(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  const candidateIds = [await getAutoScriptId(origin), await getLegacyAutoScriptId(origin)];
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registered.map((item) => item.id));
  const ids = candidateIds.filter((id) => registeredIds.has(id));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });

  const { autoSites = [] } = await chrome.storage.local.get(["autoSites"]);
  const next = (Array.isArray(autoSites) ? autoSites : []).filter((item) => item !== origin);
  await chrome.storage.local.set({ autoSites: next });
  return { origin, enabled: false };
}

export async function syncAutoSiteRegistrations() {
  const { autoSites = [] } = await chrome.storage.local.get(["autoSites"]);
  const validSites = [];
  const desiredIds = new Set();

  for (const rawOrigin of Array.isArray(autoSites) ? autoSites : []) {
    let origin;
    try {
      origin = normalizeOrigin(rawOrigin);
    } catch {
      continue;
    }

    const match = getOriginMatchPattern(origin);
    if (!(await chrome.permissions.contains({ origins: [match] }))) continue;

    try {
      await registerAutoSite(origin);
      validSites.push(origin);
      desiredIds.add(await getAutoScriptId(origin));
    } catch {
      // Keep service-worker startup resilient if one site fails.
    }
  }

  const registered = await chrome.scripting.getRegisteredContentScripts();
  const prefixes = [AUTO_SCRIPT_PREFIX, ...LEGACY_AUTO_SCRIPT_PREFIXES];
  const staleIds = registered
    .map((item) => item.id)
    .filter((id) => prefixes.some((prefix) => id.startsWith(prefix)) && !desiredIds.has(id));
  if (staleIds.length) await chrome.scripting.unregisterContentScripts({ ids: staleIds });

  const normalized = [...new Set(validSites)].sort();
  const current = [...new Set((Array.isArray(autoSites) ? autoSites : []).map(String))].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(current)) {
    await chrome.storage.local.set({ autoSites: normalized });
  }
}

async function getAutoScriptId(origin) {
  return `${AUTO_SCRIPT_PREFIX}${(await sha256(origin)).slice(0, 20)}`;
}

async function getLegacyAutoScriptId(origin) {
  return `${LEGACY_AUTO_SCRIPT_PREFIXES[0]}${(await sha256(origin)).slice(0, 20)}`;
}
