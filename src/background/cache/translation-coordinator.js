import { canonicalJson, cacheError } from '../../shared/cache/identity.js';
import { createSingleFlight } from '../../shared/cache/single-flight.js';
import { translationRequestDescriptor, validateTranslationValue } from '../../shared/translation-cache-identity.js';

/** Preserve the existing gateway, but decouple request sharing from cache persistence. */
export function createTranslationCoordinator(executeTranslation) {
  const flight = createSingleFlight(), consumers = new Map();
  function cancel(requestId) {
    const id = String(requestId || ''), request = consumers.get(id);
    if (!request) return { cancelled: false };
    consumers.delete(id); request.controller.abort(); return { cancelled: true };
  }
  async function withRequest({ requestId, pageUrl = '', ownerTabId = null }, work) {
    const id = String(requestId || crypto.randomUUID()); cancel(id);
    if (consumers.size >= 1024) throw cacheError('CACHE_BUSY');
    const consumer = { controller: new AbortController(), pageUrl, ownerTabId, engine: 'ai', key: null, onProgress: null };
    consumers.set(id, consumer);
    const assertActive = () => {
      if (consumer.controller.signal.aborted || consumers.get(id) !== consumer) throw cacheError('CANCELLED');
    };
    try { return await work({ signal: consumer.controller.signal, assertActive,
      run: input => runInRequest(input, consumer, assertActive) }); }
    finally { if (consumers.get(id) === consumer) consumers.delete(id); }
  }
  function run({ requestId, pageUrl = '', ownerTabId = null, ...input }) {
    return withRequest({ requestId, pageUrl, ownerTabId }, request => request.run(input));
  }
  async function runInRequest({ segments, config, onProgress }, consumer, assertActive) {
    assertActive();
    const { pageUrl } = consumer;
    if (!Array.isArray(segments) || segments.length > 128) throw cacheError('CACHE_INPUT_LIMIT');
    // Pin inputs before any asynchronous hand-off. A producer must execute the
    // exact payload whose identity was used to join the in-flight request.
    try { segments = structuredClone(segments); config = structuredClone(config || {}); }
    catch { throw cacheError('CACHE_INVALID_INPUT'); }
    const seen = new Set();
    for (const item of segments) {
      if (!item || !['string', 'number'].includes(typeof item.id) || seen.has(String(item.id))) throw cacheError('CACHE_INVALID_INPUT');
      seen.add(String(item.id));
    }
    const key = canonicalJson({ pageUrl, request: buildTranslationRequestKey(segments, config) });
    Object.assign(consumer, { engine: config?.engine || 'ai', key, onProgress });
    return structuredClone(await flight.run(key, async signal => {
      const groups = new Map();
      for (const segment of segments) {
        const plan = translationRequestDescriptor(config, segment);
        const groupKey = canonicalJson({ config: plan.semanticRequest.config, formatProtocol: plan.semanticRequest.formatProtocol });
        let group = groups.get(groupKey);
        if (!group) { group = { config: plan.preparedConfig, items: [] }; groups.set(groupKey, group); }
        group.items.push({ segment, source: plan.source });
      }
      const translated = new Map();
      const deadline = config.engine === "machine-translation" ? performance.now() + 25000 : undefined;
      // Homogeneous effective-prompt batches: removing cached rich items cannot
      // silently change the prompt for a remaining plain segment.
      for (const group of groups.values()) {
        if (signal.aborted) throw cacheError('CANCELLED');
        let output;
        try { output = await executeTranslation({
          segments: group.items.map(({ segment, source }) => ({ ...segment, text: source.text })),
          config: group.config, signal, deadline, onProgress(event) {
            for (const consumer of consumers.values()) if (consumer.key === key && !consumer.controller.signal.aborted) {
              try { consumer.onProgress?.(event); } catch { /* observer */ }
            }
          }
        }); } catch (error) {
          if (config.routing === "auto" && translated.size && ["MT_NETWORK", "MT_TIMEOUT", "MT_HTTP", "MT_RESPONSE", "MT_RATE_LIMIT", "MT_BLOCKED", "MT_PERMISSION", "MT_LANGUAGE"].includes(error?.code) && !signal.aborted) break;
          throw error;
        }
        if (signal.aborted) throw cacheError('CANCELLED');
        if (!Array.isArray(output) || (output.length !== group.items.length && !(config.routing === "auto" && output.length > 0 && output.length < group.items.length))) throw cacheError('MALFORMED_RESPONSE');
        const expected = new Map(group.items.map(item => [String(item.segment.id), item]));
        for (const item of output) {
          const source = expected.get(String(item?.id))?.source;
          if (!source || translated.has(String(item.id)) || !validateTranslationValue({ sourceText: source.cacheSource, source, translation: item.text })) throw cacheError('MALFORMED_RESPONSE');
          translated.set(String(item.id), { id: item.id, text: item.text, ...(item.providerId ? { providerId: item.providerId, providerLabel: item.providerLabel } : {}) });
        }
      }
      return segments.map(item => translated.get(String(item.id))).filter(Boolean);
    }, { signal: consumer.controller.signal, metadata: { pageUrl, engine: consumer.engine } }));
  }
  return Object.freeze({ run, withRequest, cancel,
    cancelText(pageUrl = '') { for (const [id, item] of consumers) if (!pageUrl || item.pageUrl === pageUrl) cancel(id); },
    cancelMachine(tabId = null) { for (const [id, item] of consumers) if (item.engine === 'machine-translation' && (tabId === null || item.ownerTabId === tabId)) cancel(id); },
    close() { for (const id of [...consumers.keys()]) cancel(id); flight.close(); }
  });
}

export function buildTranslationRequestKey(segments, config) {
  return canonicalJson({ routeCandidates: config?.routeCandidates || null, streaming: config?.streaming === true,
    requests: segments.map(segment => ({ id: String(segment.id), ...translationRequestDescriptor(config, segment).semanticRequest })) });
}
