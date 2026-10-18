import { cacheError, canonicalJson, createCacheIdentity, digest } from './cache/identity.js';

// Business contracts evolve here. They are unrelated to IndexedDB/record versions.
export const TRANSLATION_STRATEGY = 'translation-request-v1';
export const STRUCTURED_PROMPT_VERSION = 'tf-markers-v1';
export const STRUCTURED_PROMPT = [
  'TranslateFlow structured-marker protocol:',
  'Preserve every marker matching ⟦TF:<number>:S⟧ or ⟦TF:<number>:E⟧ exactly,',
  'keep marker pairs balanced and nested, and do not add, remove, reorder, or translate marker text.',
  'Text inside code or kbd marker pairs is technical content and should remain unchanged.'
].join(' ');

const PARAMETER_KEYS = ['temperature', 'topP', 'top_p', 'seed', 'maxTokens', 'max_tokens',
  'frequencyPenalty', 'presencePenalty', 'reasoningEffort', 'thinkingBudget', 'outputTokens', 'reasoning'];

/** Explicit, nonsecret projection. UI preferences/retry timing are not translation meaning. */
export function translationConfigIdentity(config = {}) {
  const provider = String(config.provider || 'deepseek').trim();
  const engine = config.engine || (provider === 'browser-translator' ? provider : 'ai');
  const promptable = engine !== 'machine-translation' && engine !== 'browser-translator';
  const parameters = {};
  if (promptable) for (const key of PARAMETER_KEYS) {
    const value = config[key] ?? config.settings?.[key];
    if (value !== undefined) parameters[key] = value;
  }
  const result = { engine, provider, endpoint: String(config.apiBaseUrl || '').trim(),
    model: String(config.model || '').trim(), protocol: String(config.protocol || provider),
    connectionId: String(config.connectionId || ''), connectionRevision: Number(config.connectionRevision || 0),
    credentialEpoch: Number(config.credentialEpoch || 0), platform: String(config.platform || ''),
    sourceLanguage: String(config.sourceLanguage || ''), targetLanguage: String(config.targetLanguage || '').trim(),
    prompt: promptable ? String(config.prompt || '').trim() : '',
    glossary: promptable && Array.isArray(config.glossaryIdentity) ? config.glossaryIdentity : [],
    parameters, inputVersion: String(config.inputVersion || 'source-text-v1'),
    strategyVersion: String(config.translationStrategyVersion || TRANSLATION_STRATEGY),
    contextIdentity: promptable ? (config.translationContextIdentity ?? null) : null };
  canonicalJson(result);
  return result;
}

export function translationSource(segment) {
  const text = segment?.providerText ?? segment?.text;
  if (typeof text !== 'string' || text.length > 100000) throw cacheError('CACHE_INVALID_INPUT');
  const cacheSource = segment?.cacheSource ?? segment?.text ?? text;
  if (typeof cacheSource !== 'string' || cacheSource.length > 200000) throw cacheError('CACHE_INVALID_INPUT');
  const protectedIds = segment?.protectedIds ?? [];
  if (!Array.isArray(protectedIds) || protectedIds.length > 512 ||
      protectedIds.some(id => !Number.isSafeInteger(id) || id < 0 || id > 100000)) throw cacheError('CACHE_INVALID_INPUT');
  const ids = [...new Set(protectedIds)].sort((a, b) => a - b);
  // Format is an explicit transport contract. Marker-looking user text does
  // not grant permission to interpret it as an internal structured protocol.
  const format = segment?.format ?? 'plain';
  if (!['plain', 'tf-markers'].includes(format) || (format === 'plain' && ids.length)) throw cacheError('CACHE_INVALID_INPUT');
  const source = { text, cacheSource, format, protectedIds: ids };
  if (format === 'tf-markers') markerTree(text, ids);
  return source;
}

/** Exactly the format instruction used by execution is also fingerprinted by cache lookup. */
export function prepareTranslationConfig(config, source) {
  const identity = translationConfigIdentity(config);
  if (['machine-translation', 'browser-translator'].includes(identity.engine) || source.format !== 'tf-markers') return { ...config };
  const prompt = String(config.prompt || '').trim();
  return { ...config, prompt: prompt.endsWith(STRUCTURED_PROMPT) ? prompt : `${prompt}\n${STRUCTURED_PROMPT}`.trim() };
}

export function translationRequestDescriptor(config, segment) {
  const source = translationSource(segment), preparedConfig = prepareTranslationConfig(config, source);
  const effective = translationConfigIdentity(preparedConfig);
  return { source, preparedConfig, semanticRequest: {
    config: effective, input: source,
    formatProtocol: source.format === 'tf-markers' ? STRUCTURED_PROMPT_VERSION : 'plain-v1'
  } };
}

export async function createTranslationIdentity(config, segment, scope, namespace = 'translation') {
  const plan = translationRequestDescriptor(config, segment);
  return createCacheIdentity({ namespace, scope, revision: 'translation-result-v1', input: plan.semanticRequest });
}

export function configFingerprint(config) { return digest(translationConfigIdentity(config)); }
export function sourceFingerprint(text, config, protectedIds = []) {
  return digest(translationRequestDescriptor(config, { text, protectedIds }).semanticRequest);
}

export function validateTranslationValue(value) {
  if (!value || typeof value.sourceText !== 'string' || typeof value.translation !== 'string' || !value.translation.trim() ||
      !value.source || value.source.cacheSource !== value.sourceText) return false;
  try {
    const source = translationSource({ ...value.source, text: value.source.text, cacheSource: value.source.cacheSource });
    if (source.format === 'plain') return true;
    const before = markerTree(source.text, source.protectedIds), after = markerTree(value.translation, source.protectedIds);
    if (before.nodes.size !== after.nodes.size) return false;
    for (const [id, node] of before.nodes) {
      const translated = after.nodes.get(id);
      if (!translated || translated.parent !== node.parent) return false;
      if (source.protectedIds.includes(id) && stripGeneratedMarkers(node.content) !== stripGeneratedMarkers(translated.content)) return false;
    }
    return true;
  } catch { return false; }
}

function stripGeneratedMarkers(text) { return text.replace(/⟦TF:\d+:[SE]⟧/gu, ''); }
function markerTree(text, protectedIds) {
  const nodes = new Map(), stack = []; let last = 0;
  for (const match of text.matchAll(/⟦TF:(\d+):([SE])⟧/gu)) {
    if (/⟦TF:/u.test(text.slice(last, match.index))) throw cacheError('CACHE_INVALID_VALUE');
    const id = Number(match[1]);
    if (match[2] === 'S') {
      if (nodes.has(id) || nodes.size >= 512 || stack.length >= 64) throw cacheError('CACHE_INVALID_VALUE');
      const node = { parent: stack.at(-1)?.id ?? null, start: match.index + match[0].length, content: null };
      nodes.set(id, node); stack.push({ id, node });
    } else {
      const current = stack.pop();
      if (current?.id !== id) throw cacheError('CACHE_INVALID_VALUE');
      current.node.content = text.slice(current.node.start, match.index);
    }
    last = match.index + match[0].length;
  }
  if (stack.length || /⟦TF:/u.test(text.slice(last)) || protectedIds.some(id => !nodes.has(id))) throw cacheError('CACHE_INVALID_VALUE');
  return { nodes };
}
