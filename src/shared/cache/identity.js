// Pure identity construction. Storage layout/version is intentionally absent.
const encoder = new TextEncoder();
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/u;

export function cacheError(code, message = code, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

/** Canonical JSON, without invoking getters/toJSON or silently dropping values. */
export function canonicalJson(value, { maxDepth = 32, maxNodes = 100000, maxChars = 2000000 } = {}) {
  const ancestors = new Set();
  let count = 0;
  function visit(item, depth) {
    if (++count > maxNodes || depth > maxDepth) throw cacheError('CACHE_INPUT_LIMIT');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== 'object') throw cacheError('CACHE_INVALID_JSON');
    if (ancestors.has(item)) throw cacheError('CACHE_CYCLIC_INPUT');
    const proto = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) throw cacheError('CACHE_INVALID_JSON');
    if (Object.getOwnPropertySymbols(item).length) throw cacheError('CACHE_INVALID_JSON');
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    let output;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length || Object.keys(descriptors).length !== item.length + 1) throw cacheError('CACHE_INVALID_JSON');
      output = '[' + Array.from({ length: item.length }, (_, i) => {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw cacheError('CACHE_INVALID_JSON');
        return visit(descriptor.value, depth + 1);
      }).join(',') + ']';
    } else {
      output = '{' + Object.keys(descriptors).sort().map(key => {
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw cacheError('CACHE_INVALID_JSON');
        return JSON.stringify(key) + ':' + visit(descriptor.value, depth + 1);
      }).join(',') + '}';
    }
    ancestors.delete(item);
    if (output.length > maxChars) throw cacheError('CACHE_INPUT_LIMIT');
    return output;
  }
  const output = visit(value, 0);
  if (output.length > maxChars) throw cacheError('CACHE_INPUT_LIMIT');
  return output;
}

export async function digest(value) {
  const data = typeof value === 'string' ? value : canonicalJson(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(data)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validateIdentity(identity) {
  if (!identity || !TOKEN.test(identity.namespace) || typeof identity.scope !== 'string' || identity.scope.length > 512 ||
      typeof identity.revision !== 'string' || !identity.revision || identity.revision.length > 256 ||
      typeof identity.key !== 'string' || !identity.key || identity.key.length > 2048) throw cacheError('CACHE_INVALID_IDENTITY');
  return identity;
}

/** scope must be a non-sensitive stable ID, e.g. the existing normalized-URL hash. */
export async function createCacheIdentity({ namespace, scope = '', revision, input }) {
  if (!TOKEN.test(namespace) || typeof scope !== 'string' || scope.length > 512 ||
      typeof revision !== 'string' || !revision || revision.length > 256) throw cacheError('CACHE_INVALID_IDENTITY');
  const fingerprint = await digest(canonicalJson({ namespace, scope, revision, input }));
  return Object.freeze({ namespace, scope, revision, key: `${namespace}:${fingerprint}` });
}

/** For a domain that already owns an opaque, versioned key; no legacy-result decoding. */
export function opaqueCacheIdentity(namespace, sourceKey, revision = 'opaque-result-v1') {
  if (typeof sourceKey !== 'string' || !sourceKey || sourceKey.length > 1024) throw cacheError('CACHE_INVALID_IDENTITY');
  return Object.freeze(validateIdentity({ namespace, scope: '', revision,
    key: JSON.stringify([namespace, revision, sourceKey]) }));
}

export const byteLength = value => encoder.encode(typeof value === 'string' ? value : canonicalJson(value)).byteLength;
