// The budget measures the validated serialized index file size, not heap use.
// Leases keep active lookup objects alive when cache admission or eviction runs.
export const RICH_MDICT_INDEX_CACHE_BUDGET_BYTES = 16 * 1024 * 1024;

export function createRichMdictIndexCache({
  maximumBytes = RICH_MDICT_INDEX_CACHE_BUDGET_BYTES,
  onEvent = null
} = {}) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new Error("Invalid rich index cache budget.");
  }

  const entries = new Map();
  const counters = { hits: 0, misses: 0, admissions: 0, evictions: 0, bypasses: 0 };
  let cachedBytes = 0;
  let activeLeases = 0;

  function snapshot() {
    let pinnedEntries = 0;
    for (const entry of entries.values()) if (entry.pins > 0) pinnedEntries += 1;
    return Object.freeze({
      maximumBytes,
      cachedBytes,
      entries: entries.size,
      activeLeases,
      pinnedEntries,
      ...counters
    });
  }

  function emit(event) {
    try { onEvent?.(event, snapshot()); } catch { /* Diagnostics must not affect lookups. */ }
  }

  function touch(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return false;
    entries.delete(key);
    cachedBytes -= entry.weight;
    return true;
  }

  function acquireEntry(key, entry) {
    entry.pins += 1;
    activeLeases += 1;
    emit("acquire");
    return makeLease(entry.index, entry);
  }

  function makeLease(index, entry = null) {
    let released = false;
    return Object.freeze({
      index,
      release() {
        if (released) return false;
        released = true;
        if (entry) entry.pins -= 1;
        activeLeases -= 1;
        emit("release");
        return true;
      }
    });
  }

  function get(key) {
    const entry = entries.get(key);
    if (!entry) {
      counters.misses += 1;
      emit("miss");
      return undefined;
    }
    counters.hits += 1;
    touch(key, entry);
    emit("hit");
    return entry.index;
  }

  function set(key, index, weight) {
    if (typeof key !== "string" || !key || !index || typeof index !== "object") {
      throw new Error("Invalid rich index cache entry.");
    }
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new Error("Invalid rich index cache weight.");
    }

    const previous = entries.get(key);
    if (previous?.index === index && previous.weight === weight) {
      touch(key, previous);
      return true;
    }
    if (previous?.pins || weight > maximumBytes) {
      counters.bypasses += 1;
      emit("bypass");
      return false;
    }

    let bytesAfter = cachedBytes - (previous?.weight || 0) + weight;
    const victims = [];
    if (bytesAfter > maximumBytes) {
      for (const [candidate, entry] of entries) {
        if (candidate === key || entry.pins > 0) continue;
        victims.push(candidate);
        bytesAfter -= entry.weight;
        if (bytesAfter <= maximumBytes) break;
      }
    }
    if (bytesAfter > maximumBytes) {
      counters.bypasses += 1;
      emit("bypass");
      return false;
    }

    if (previous) remove(key);
    for (const victim of victims) {
      if (remove(victim)) {
        counters.evictions += 1;
        emit("evict");
      }
    }
    entries.set(key, { index, weight, pins: 0 });
    cachedBytes += weight;
    counters.admissions += 1;
    emit("admit");
    return true;
  }

  return Object.freeze({
    get,
    set,
    acquire(key, expectedIndex = undefined) {
      const entry = entries.get(key);
      if (!entry || (expectedIndex !== undefined && entry.index !== expectedIndex)) {
        if (!entry) {
          counters.misses += 1;
          emit("miss");
        }
        return null;
      }
      counters.hits += 1;
      touch(key, entry);
      return acquireEntry(key, entry);
    },
    hold(index) {
      if (!index || typeof index !== "object") throw new Error("Invalid rich index lease.");
      activeLeases += 1;
      emit("hold");
      return makeLease(index);
    },
    has(key) { return entries.has(key); },
    keys() { return [...entries.keys()].values(); },
    delete(key) {
      const removed = remove(key);
      if (removed) emit("invalidate");
      return removed;
    },
    forgetPack(packId) {
      if (typeof packId !== "string" || !packId) throw new Error("Invalid rich dictionary pack id.");
      const prefix = `${packId}@`;
      let removed = 0;
      for (const key of entries.keys()) if (key.startsWith(prefix) && remove(key)) removed += 1;
      if (removed) emit("invalidate-pack");
      return removed;
    },
    snapshot
  });
}
