export function createRichMddIndexCache(maximumBytes) {
  const entries = new Map();
  let cachedBytes = 0;

  function removeMatching(predicate) {
    for (const [key, entry] of entries) {
      if (!predicate(key)) continue;
      entries.delete(key);
      cachedBytes -= entry.size;
    }
  }

  return Object.freeze({
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    set(key, index, size) {
      const previous = entries.get(key);
      if (previous) { entries.delete(key); cachedBytes -= previous.size; }
      entries.set(key, { index, size });
      cachedBytes += size;
      while (cachedBytes > maximumBytes && entries.size) {
        const oldestKey = entries.keys().next().value;
        const oldest = entries.get(oldestKey);
        entries.delete(oldestKey);
        cachedBytes -= oldest.size;
      }
    },
    removeVersion(packId, version) {
      const prefix = `${packId}@${version}@`;
      removeMatching((key) => key.startsWith(prefix));
    },
    forgetPack(packId) {
      const prefix = `${packId}@`;
      removeMatching((key) => key.startsWith(prefix));
    }
  });
}
