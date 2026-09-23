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
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(normalizeGlossaryEntry)
    .filter(Boolean);
  const seen = new Set();
  return normalized.filter((entry) => {
    const key = glossaryKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveEffectiveGlossary(globalEntries, siteGlossaries, pageUrl) {
  const global = normalizeGlossary(globalEntries).filter((entry) => entry.enabled);
  let site = [];
  try {
    const origin = normalizeOrigin(pageUrl);
    site = normalizeGlossary(siteGlossaries?.[origin]).filter((entry) => entry.enabled);
  } catch {}
  const merged = new Map(global.map((entry) => [glossaryKey(entry), entry]));
  for (const entry of site) merged.set(glossaryKey(entry), entry);
  return [...merged.values()].sort(compareEntries);
}

export function composeGlossaryPrompt(prompt, glossary) {
  const entries = normalizeGlossary(glossary).filter((entry) => entry.enabled).sort(compareEntries);
  if (!entries.length) return String(prompt || "");
  const rules = entries.map((entry) =>
    `- ${entry.caseSensitive ? "case-sensitive" : "case-insensitive"}: ${JSON.stringify(entry.source)} -> ${JSON.stringify(entry.target)}`
  );
  return [String(prompt || "").trim(), "Terminology glossary. Apply these mappings consistently:", ...rules]
    .filter(Boolean).join("\n");
}

export function glossaryIdentity(glossary) {
  const entries = normalizeGlossary(glossary).filter((entry) => entry.enabled).sort(compareEntries);
  return entries.map(({ source, target, caseSensitive }) => ({ source, target, caseSensitive }));
}

function glossaryKey(entry) {
  return `${entry.caseSensitive ? "1" : "0"}:${entry.caseSensitive ? entry.source : entry.source.toLocaleLowerCase()}`;
}

function compareEntries(a, b) {
  return glossaryKey(a).localeCompare(glossaryKey(b)) || a.target.localeCompare(b.target);
}
