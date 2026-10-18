import { lookupTranslations, storeTranslations } from "./cache-db.js";
import { isCachePersistenceError } from "../shared/cache/persistence-errors.js";
import { getEffectiveConfig } from "./config.js";
import { runTranslationRequest } from "./translation-requests.js";
import { normalizeSourceText } from "../shared/text.js";

import { buildSubtitleCacheSource } from "../shared/subtitle-cache.js";
export { buildSubtitleCacheSource } from "../shared/subtitle-cache.js";
const MAX_BATCH_ITEMS = 12;
const MAX_TEXT_CHARS = 12000;

export async function runSubtitleTranslationBatch({
  requestId,
  pageUrl,
  pageTitle = "",
  units
}, deps = {}) {
  const effectiveConfig = deps.getEffectiveConfig || getEffectiveConfig;
  const lookupCache = deps.lookupTranslations || lookupTranslations;
  const runProvider = deps.runTranslationRequest || runTranslationRequest;
  const storeCache = deps.storeTranslations || storeTranslations;
  const normalized = normalizeUnits(units);
  if (!normalized.length) {
    return { translations: [], cacheHits: 0, apiTranslated: 0, missing: 0 };
  }

  const config = await effectiveConfig(pageUrl);
  const cacheSegments = normalized.map((unit) => ({
    id: unit.id,
    text: buildSubtitleCacheSource(unit), providerText: unit.text, format: "plain"
  }));
  let cached, cacheWarning = "";
  try {
    cached = await lookupCache({
      pageUrl,
      segments: cacheSegments,
      namespace: "subtitle-translation",
      config
    });
  } catch (error) {
    if (!isCachePersistenceError(error)) throw error;
    // A broken cache does not turn an authorized subtitle request into a
    // failed translation or a second Provider call.
    cached = { hits: [], writeTokens: [] };
    cacheWarning = error.code;
  }
  const cacheTokens = new Map((cached.writeTokens || []).map(item => [String(item.id), item.token]));
  const cachedById = new Map((cached.hits || []).map((item) => [String(item.id), item.text]));
  const missing = normalized.filter((unit) => !cachedById.has(unit.id));

  const translatedById = new Map();
  if (missing.length) {
    const translated = await runProvider({
      requestId,
      pageUrl,
      segments: missing.map((unit) => ({ id: unit.id, text: unit.text, format: "plain" })),
      config
    });
    for (const item of translated || []) {
      if (item?.text) translatedById.set(String(item.id), String(item.text));
    }
  }

  const storeItems = [];
  const translations = [];
  let cacheHits = 0;
  let apiTranslated = 0;

  for (const unit of normalized) {
    const cachedText = cachedById.get(unit.id);
    if (cachedText) {
      cacheHits += 1;
      translations.push({ id: unit.id, text: cachedText, cacheHit: true });
      continue;
    }

    const translatedText = translatedById.get(unit.id);
    if (!translatedText) continue;
    apiTranslated += 1;
    translations.push({ id: unit.id, text: translatedText, cacheHit: false });
    storeItems.push({
      sourceText: buildSubtitleCacheSource(unit),
      providerText: unit.text, format: "plain", cacheToken: cacheTokens.get(String(unit.id)),
      translation: translatedText
    });
  }

  if (storeItems.length && !cacheWarning) {
    try {
      const saved = await storeCache({
        pageUrl,
        pageTitle,
        items: storeItems,
        namespace: "subtitle-translation",
        config
      });
      cacheWarning = saved.cacheWarning || (Number(saved.stored || 0) < storeItems.length ? "CACHE_NOT_SAVED" : "");
    } catch (error) {
      if (!isCachePersistenceError(error)) throw error;
      cacheWarning = error.code;
    }
  }

  return {
    translations,
    cacheHits,
    apiTranslated,
    missing: normalized.length - translations.length,
    ...(cacheWarning ? { cacheWarning } : {})
  };
}

function normalizeUnits(units) {
  const input = Array.isArray(units) ? units.slice(0, MAX_BATCH_ITEMS) : [];
  let chars = 0;
  const output = [];

  for (const raw of input) {
    const id = String(raw?.id || "").trim();
    const text = normalizeSourceText(raw?.text);
    const mediaId = String(raw?.mediaId || "").trim();
    if (!id || !text || !mediaId) continue;
    if (text.length > MAX_TEXT_CHARS) continue;
    if (chars + text.length > MAX_TEXT_CHARS && output.length) break;
    chars += text.length;
    output.push({
      id,
      text,
      mediaId,
      source: String(raw?.source || "").trim(),
      track: raw?.track && typeof raw.track === "object" ? raw.track : null,
      cue: raw?.cue && typeof raw.cue === "object" ? raw.cue : {},
      sequence: positiveInteger(raw?.sequence)
    });
  }

  return output;
}

function cueHasTiming(cue) {
  return finiteTime(cue?.startTime) !== null || finiteTime(cue?.endTime) !== null;
}

function finiteTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
