import { createCacheService } from './service.js';
import { createIndexedDbCacheStore } from './storage-indexeddb.js';
import { cacheError, digest, opaqueCacheIdentity } from '../../shared/cache/identity.js';
import { normalizeUrl } from '../../shared/url.js';
import { configFingerprint, sourceFingerprint, createTranslationIdentity, translationSource,
  validateTranslationValue } from '../../shared/translation-cache-identity.js';

export const TRANSLATION_NAMESPACES = Object.freeze(['translation', 'subtitle-translation']);
export const getConfigHash = configFingerprint;
export const translationSourceHash = sourceFingerprint;

export async function getCacheContext(pageUrl, config) {
  const normalizedUrl = normalizeUrl(pageUrl);
  const [pageKey, configHash] = await Promise.all([digest(normalizedUrl), getConfigHash(config)]);
  return { normalizedUrl, pageKey, configHash, pageConfigKey: `${pageKey}:${configHash}` };
}

/** Domain adapters retain the existing extension API; storage/core know no Provider. */
export function createApplicationCache({ store = createIndexedDbCacheStore(), clock = Date.now, onEvent } = {}) {
  const cache = createCacheService({ store, clock, onEvent });
  for (const namespace of TRANSLATION_NAMESPACES) cache.register(namespace, { validate: validateTranslationValue });
  cache.register('selection-explanation', { maxEntries: 256, maxBytes: 8 * 1024 * 1024,
    validate: value => Boolean(value && typeof value === 'object' && !Array.isArray(value)) });

  function allowedNamespace(namespace) {
    if (!TRANSLATION_NAMESPACES.includes(namespace)) throw cacheError('CACHE_UNKNOWN_NAMESPACE');
    return namespace;
  }
  const api = {
    cache,
    async lookupTranslations({ pageUrl, segments, config, namespace = 'translation' }) {
      allowedNamespace(namespace);
      if (!Array.isArray(segments) || !segments.length) return { hits: [], writeTokens: [], pageKey: '', normalizedUrl: '' };
      if (segments.length > 1024) throw cacheError('CACHE_INPUT_LIMIT');
      const context = await getCacheContext(pageUrl, config);
      const identities = await Promise.all(segments.map(segment => createTranslationIdentity(config, segment, context.pageKey, namespace)));
      const results = await cache.readMany(identities);
      return { hits: results.flatMap((result, i) => result.hit ? [{ id: String(segments[i].id), text: result.value.translation }] : []),
        writeTokens: results.map((result, i) => ({ id: String(segments[i].id), token: result.token })),
        pageKey: context.pageKey, normalizedUrl: context.normalizedUrl };
    },
    async storeTranslations({ pageUrl, pageTitle = '', items, config, namespace = 'translation' }) {
      allowedNamespace(namespace);
      if (!Array.isArray(items) || !items.length) return { stored: 0 };
      if (items.length > 1024) throw cacheError('CACHE_INPUT_LIMIT');
      const context = await getCacheContext(pageUrl, config);
      const writes = await Promise.all(items.map(async item => {
        const segment = { text: item.sourceText, ...(item.providerText !== undefined ? { providerText: item.providerText } : {}),
          ...(item.format !== undefined ? { format: item.format } : {}), protectedIds: item.protectedIds || [] };
        const source = translationSource(segment);
        const identity = await createTranslationIdentity(config, segment, context.pageKey, namespace);
        return { identity, token: item.cacheToken, value: { sourceText: source.cacheSource, source, translation: item.translation },
          metadata: { pageUrl: context.normalizedUrl, pageTitle: String(pageTitle || '').slice(0, 500), configHash: context.configHash } };
      }));
      const result = await cache.writeMany(writes);
      return { stored: result.written.length, skipped: result.skipped.length, pageKey: context.pageKey,
        normalizedUrl: context.normalizedUrl, ...(result.maintenanceError ? { cacheWarning: result.maintenanceError } : {}) };
    },
    async lookupSelectionExplanation({ cacheKey }) {
      if (!cacheKey) return { hit: null };
      const result = await cache.read(opaqueCacheIdentity('selection-explanation', cacheKey));
      return { hit: result.hit ? result.value : null, createdAt: result.createdAt || null, cacheToken: result.token };
    },
    async storeSelectionExplanation({ cacheKey, result, cacheToken }) {
      if (!cacheKey || !result || typeof result !== 'object' || Array.isArray(result)) return { stored: 0 };
      const written = await cache.write(opaqueCacheIdentity('selection-explanation', cacheKey), result, { token: cacheToken });
      return { stored: written.stored ? 1 : 0, ...(written.maintenanceError ? { cacheWarning: written.maintenanceError } : {}) };
    },
    async getPageCacheStatus({ pageUrl, config }) {
      const context = await getCacheContext(pageUrl, config);
      const groups = await Promise.all(TRANSLATION_NAMESPACES.map(namespace => cache.list({ namespace, scope: context.pageKey })));
      const rows = groups.flat(), newest = [...rows].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      return { count: rows.filter(row => row.metadata.configHash === context.configHash).length, totalCount: rows.length,
        pageKey: context.pageKey, normalizedUrl: context.normalizedUrl, title: newest?.metadata.pageTitle || '',
        lastAccessedAt: rows.length ? Math.max(...rows.map(row => row.lastAccessedAt)) : null };
    },
    async clearPageCache({ pageUrl }) {
      const pageKey = await digest(normalizeUrl(pageUrl));
      const results = await Promise.all(TRANSLATION_NAMESPACES.map(namespace => cache.invalidate({ namespace, scope: pageKey })));
      return { deleted: results.reduce((sum, result) => sum + result.deleted, 0), pageKey };
    },
    async clearAllCache() { await cache.invalidate(); return { cleared: true }; },
    async getCacheStats() {
      const rows = await cache.list(), translations = rows.filter(row => TRANSLATION_NAMESPACES.includes(row.namespace));
      return { pageCount: new Set(translations.map(row => row.scope)).size, segmentCount: translations.length,
        selectionExplanationCount: rows.filter(row => row.namespace === 'selection-explanation').length,
        bytes: rows.reduce((sum, row) => sum + row.bytes, 0) };
    },
    async pruneCache(maxBytes) {
      if (!Number.isFinite(maxBytes) || maxBytes < 0) throw cacheError('CACHE_INVALID_POLICY');
      const result = await cache.prune({ maxBytes: Math.max(5 * 1024 * 1024, Math.floor(maxBytes)) });
      return { ...await api.getCacheStats(), deleted: result.deleted };
    },
    close() { cache.close(); }
  };
  return Object.freeze(api);
}
