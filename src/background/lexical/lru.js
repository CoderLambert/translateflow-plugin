export class ByteBoundedLru {
  constructor({ maxEntries = 4, maxBytes = 2 * 1024 * 1024 } = {}) {
    assertPositiveInteger(maxEntries, "maxEntries");
    assertPositiveInteger(maxBytes, "maxBytes");
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.totalBytes = 0;
    this.items = new Map();
  }

  get(key) {
    if (!this.items.has(key)) return undefined;
    const item = this.items.get(key);
    this.items.delete(key);
    this.items.set(key, item);
    return item.value;
  }

  set(key, value, bytes) {
    assertNonNegativeInteger(bytes, "bytes");
    const existing = this.items.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.items.delete(key);
    }

    if (bytes > this.maxBytes) return false;

    this.items.set(key, { value, bytes });
    this.totalBytes += bytes;
    this.evict();
    return this.items.has(key);
  }

  clear() {
    this.items.clear();
    this.totalBytes = 0;
  }

  stats() {
    return {
      entries: this.items.size,
      bytes: this.totalBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes
    };
  }

  evict() {
    while (this.items.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestKey = this.items.keys().next().value;
      const oldest = this.items.get(oldestKey);
      this.items.delete(oldestKey);
      this.totalBytes -= oldest.bytes;
    }
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(label + " must be a positive integer");
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label + " must be a non-negative integer");
}
