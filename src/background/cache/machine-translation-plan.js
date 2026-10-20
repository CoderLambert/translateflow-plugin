import { lookupTranslations, storeTranslations } from "../cache-db.js";
import { translationSource } from "../../shared/translation-cache-identity.js";
import { canonicalJson } from "../../shared/cache/identity.js";
import { machineError } from "../../shared/machine-translation.js";
import { isCachePersistenceError } from "../../shared/cache/persistence-errors.js";
import { readingTranslationResult } from "../selection/reading-result.js";

const sourceKey = segment => canonicalJson(translationSource(segment));
export async function lookupMachinePlan(plan, segments, cache = { lookupTranslations }) {
  if (!Array.isArray(segments) || segments.length > 128) throw machineError("MT_INPUT");
  const hits = [], writeTokens = [];
  let cacheWarning = "";
  for (const segment of segments) {
    const key = sourceKey(segment);
    let source = plan.sources.get(key);
    if (!source) {
      if (plan.sources.size >= 1024) throw machineError("MT_BUSY");
      source = { segment: structuredClone(segment), candidates: [] };
      plan.sources.set(key, source);
      source.ready = (async () => {
      // Freeze all candidate tokens at the first lookup, including on hits.
      // Never re-acquire a token while switching a route after cache invalidation.
      for (const config of plan.config.routeCandidates) {
        try {
          const result = await cache.lookupTranslations({ pageUrl: plan.pageUrl, segments: [segment], config });
          source.candidates.push({ config, token: result.writeTokens[0]?.token, hit: result.hits[0]?.text });
        } catch (error) {
          if (!isCachePersistenceError(error)) throw error;
          cacheWarning = error.code;
          source.candidates.push({ config });
        }
      }
      })();
    }
    await source.ready;
    const cached = plan.writable ? source.candidates.find(candidate => candidate.hit) : null;
    if (cached) hits.push({ id: String(segment.id), text: cached.hit, providerId: cached.config.provider, providerLabel: cached.config.providerLabel,
      readingResult: await readingTranslationResult(cached.config) });
    writeTokens.push({ id: String(segment.id), token: null }); // Backend owns actual tokens.
  }
  return { hits, writeTokens, ...(cacheWarning ? { cacheWarning } : {}) };
}
export function assertMachinePlanInputs(plan, segments) {
  if (!Array.isArray(segments) || segments.some(segment => !plan.sources.has(sourceKey(segment)))) throw machineError("MT_INPUT");
}
export async function bindMachinePlanResults(plan, segments, outputs, requestId) {
  assertMachinePlanInputs(plan, segments);
  const input = new Map(segments.map(segment => [String(segment.id), segment]));
  return Promise.all(outputs.map(async output => {
    const segment = input.get(String(output.id)), key = sourceKey(segment), source = plan.sources.get(key);
    const candidate = source?.candidates.find(candidate => candidate.config.provider === output.providerId);
    if (!candidate) throw machineError("MT_CONFIG");
    const routeRef = crypto.randomUUID();
    if (plan.routes.size >= 2048) throw machineError("MT_BUSY");
    plan.routes.set(routeRef, { key, candidate, text: output.text, requestId });
    return { ...output, routeRef, readingResult: await readingTranslationResult(candidate.config) };
  }));
}
export async function storeMachinePlan(plan, message, cache = { storeTranslations }) {
  if (!Array.isArray(message.items) || message.items.length > 128) throw machineError("MT_INPUT");
  // Validate the entire write before allowing any part of it to persist.
  const writes = message.items.map(item => {
    const route = plan.routes.get(item.routeRef);
    if (!route || route.text !== item.translation || route.key !== sourceKey({ text: item.sourceText, ...(item.providerText !== undefined ? { providerText: item.providerText } : {}), format: item.format || "plain", protectedIds: item.protectedIds || [] })) throw machineError("MT_INPUT");
    return { item, route };
  });
  if (!plan.writable) return { stored: 0, skipped: writes.length, cacheWarning: "CACHE_INVALIDATED" };
  let stored = 0, skipped = 0;
  for (const { item, route } of writes) {
    if (!route.candidate.token) { skipped++; continue; }
    const result = await cache.storeTranslations({ pageUrl: plan.pageUrl, pageTitle: message.pageTitle,
      config: route.candidate.config, items: [{ ...item, cacheToken: route.candidate.token }] });
    stored += result.stored; skipped += result.skipped || 0;
  }
  return { stored, skipped, ...(skipped ? { cacheWarning: "CACHE_INVALIDATED" } : {}) };
}
