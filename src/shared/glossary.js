import { GLOSSARY_STORAGE_VERSION } from "./constants.js";
import { normalizeOrigin } from "./url.js";

export function normalizeGlossaryEntry(entry) {
  const source = String(entry?.source || "").trim();
  const target = String(entry?.target || "").trim();
  if (!source || !target) return null;

  return {
    id: String(entry?.id || source).trim() || source,
    source,
    target,
    caseSensitive: Boolean(entry?.caseSensitive),
    enabled: entry?.enabled !== false
  };
}

export function normalizeGlossary(entries) {
  const byKey = new Map();

  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    const entry = normalizeGlossaryEntry(rawEntry);
    if (!entry) continue;
    byKey.set(glossaryKey(entry), entry);
  }

  return [...byKey.values()].sort(compareEntries);
}

export function normalizeGlossaryStore(value) {
  const entries = Array.isArray(value) ? value : value?.entries;
  return {
    version: GLOSSARY_STORAGE_VERSION,
    entries: normalizeGlossary(entries)
  };
}

export function normalizeSiteGlossaryStore(value) {
  const rawSites = isPlainObject(value?.sites)
    ? value.sites
    : (isPlainObject(value) && !("version" in value) ? value : {});
  const sites = {};

  for (const [rawOrigin, entries] of Object.entries(rawSites)) {
    let origin;
    try {
      origin = normalizeOrigin(rawOrigin);
    } catch {
      continue;
    }

    const normalized = normalizeGlossary(entries);
    if (normalized.length) sites[origin] = normalized;
  }

  return {
    version: GLOSSARY_STORAGE_VERSION,
    sites
  };
}

export function upsertGlossaryEntry(entries, rawEntry) {
  const entry = normalizeGlossaryEntry(rawEntry);
  if (!entry) throw new Error("来源词和目标词不能为空。");

  const key = glossaryKey(entry);
  const next = (Array.isArray(entries) ? entries : []).filter((item) => {
    const normalized = normalizeGlossaryEntry(item);
    return normalized && normalized.id !== entry.id && glossaryKey(normalized) !== key;
  });
  next.push(entry);
  return normalizeGlossary(next);
}

export function removeGlossaryEntry(entries, entryId) {
  return normalizeGlossary(
    (Array.isArray(entries) ? entries : []).filter((entry) => String(entry?.id || "") !== String(entryId || ""))
  );
}

export function resolveEffectiveGlossary(globalStore, siteStore, pageUrl) {
  const global = normalizeGlossaryStore(globalStore).entries.filter((entry) => entry.enabled);
  const sites = normalizeSiteGlossaryStore(siteStore).sites;

  let site = [];
  try {
    site = (sites[normalizeOrigin(pageUrl)] || []).filter((entry) => entry.enabled);
  } catch {
    site = [];
  }

  const merged = new Map(global.map((entry) => [glossaryKey(entry), entry]));
  for (const entry of site) merged.set(glossaryKey(entry), entry);
  return [...merged.values()].sort(compareEntries);
}

export function composeGlossaryPrompt(prompt, glossary) {
  const entries = normalizeGlossary(glossary).filter((entry) => entry.enabled);
  if (!entries.length) return String(prompt || "");

  const rules = entries.map((entry) => (
    `- ${entry.caseSensitive ? "case-sensitive" : "case-insensitive"}: ${JSON.stringify(entry.source)} -> ${JSON.stringify(entry.target)}`
  ));

  return [
    String(prompt || "").trim(),
    "Terminology glossary. Apply these mappings consistently:",
    ...rules
  ].filter(Boolean).join("\n");
}

export function glossaryIdentity(glossary) {
  return normalizeGlossary(glossary)
    .filter((entry) => entry.enabled)
    .map(({ source, target, caseSensitive }) => ({ source, target, caseSensitive }));
}

function glossaryKey(entry) {
  const source = entry.caseSensitive ? entry.source : entry.source.toLowerCase();
  return `${entry.caseSensitive ? "1" : "0"}:${source}`;
}

function compareEntries(a, b) {
  const left = glossaryKey(a);
  const right = glossaryKey(b);
  if (left < right) return -1;
  if (left > right) return 1;
  if (a.target < b.target) return -1;
  if (a.target > b.target) return 1;
  return 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
