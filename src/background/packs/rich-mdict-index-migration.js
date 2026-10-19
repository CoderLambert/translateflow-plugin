import { readRichMdictSourceHeader } from "./importers/mdict-rich-index.js";
import { validateRichMdictIndex } from "./importers/mdict-rich-validation.js";
import {
  RICH_MDICT_MAX_INDEX_BYTES, RICH_MDICT_NORMALIZED_INDEX_PATH, RICH_MDICT_SOURCE_ID,
  assertIndexMatchesMetadata, cacheKey, isValidSnapshot, parseIndex, richError,
  richMdictAbortError, richMdictIndexPath, sha256
} from "./rich-mdict-contract.js";

// The raw source and legacy index remain intact. Only a verified derived-file
// pointer is activated, under the same pack queue used by replace/uninstall.
export function createRichMdictIndexLoader({ store, stateStore, cryptoProvider, buildIndex, indexCache,
  serialize, assertSourceSize, sourceReader } = {}) {
  const checkedLegacyIndexes = new WeakSet();

  return (snapshot, signal, { lease = false } = {}) => serialize(snapshot.packId, async () => {
    assertNotAborted(signal);
    const state = await stateStore.read();
    assertNotAborted(signal);
    const entry = state.packs[snapshot.packId];
    const active = entry?.active;
    if (entry?.sourceId !== RICH_MDICT_SOURCE_ID || active?.packVersion !== snapshot.packVersion) {
      throw staleIndex();
    }
    if (!isValidSnapshot(snapshot.packId, active)) throw richError("RICH_MDICT_CORRUPT", "Rich dictionary metadata is malformed.");
    await assertSourceSize(active);
    assertNotAborted(signal);
    const path = richMdictIndexPath(active);
    await assertIndexSize(active, path, signal);
    const key = cacheKey(active);
    const cached = indexCache.get(key);
    if (cached && (cached.schemaVersion === 2 || checkedLegacyIndexes.has(cached))) {
      return loaded(key, cached, active.indexSize, lease);
    }
    const index = await readVerifiedIndex(active, path, signal);
    if (index.schemaVersion !== 1) {
      return loaded(key, index, active.indexSize, lease);
    }

    const source = sourceReader(active.packId, active, signal);
    const { header, keyPreambleOffset } = await readRichMdictSourceHeader({ source, signal });
    assertNotAborted(signal);
    if (keyPreambleOffset !== index.keyPreambleOffset) throw richError("RICH_MDICT_CORRUPT", "Rich dictionary source header does not match its index.");
    if (header.keyCaseSensitive !== index.header.keyCaseSensitive) throw richError("RICH_MDICT_CORRUPT", "Rich dictionary key case option does not match its index.");
    if (header.stripKey === index.header.stripKey) {
      checkedLegacyIndexes.add(index);
      return loaded(key, index, active.indexSize, lease);
    }

    if (header.attributes.StripKey !== undefined || header.attributes.Stripkey === undefined ||
        index.header.stripKey !== false || header.stripKey !== true) {
      throw richError("RICH_MDICT_CORRUPT", "Rich dictionary key normalization does not match its index.");
    }
    const rebuilt = await buildIndex({ source, signal });
    assertNotAborted(signal);
    validateRichMdictIndex(rebuilt, { sourceSize: active.sourceSize });
    assertIndexMatchesMetadata(rebuilt, { ...active, indexSchemaVersion: 2 });
    const bytes = new TextEncoder().encode(JSON.stringify(rebuilt));
    if (bytes.byteLength <= 0 || bytes.byteLength > RICH_MDICT_MAX_INDEX_BYTES) throw richError("RICH_MDICT_LIMIT", "Normalized rich dictionary index exceeds its safety limit.");
    const digest = await sha256(bytes, cryptoProvider);
    assertNotAborted(signal);
    await store.writeFile(active.packId, active.packVersion, RICH_MDICT_NORMALIZED_INDEX_PATH, bytes, { signal });
    assertNotAborted(signal);
    const nextIndex = { ...active, indexPath: RICH_MDICT_NORMALIZED_INDEX_PATH, indexSchemaVersion: 2,
      indexSize: bytes.byteLength, indexSha256: digest };
    await assertIndexSize(nextIndex, nextIndex.indexPath, signal);
    const persisted = await readVerifiedIndex(nextIndex, nextIndex.indexPath, signal);
    // Last cancellable boundary. storage.set is an atomic, irreversible pointer
    // commit; cancelling a Selection afterward does not undo that migration.
    const next = await stateStore.update((current) => {
      assertNotAborted(signal);
      const currentEntry = current.packs[active.packId];
      if (currentEntry?.sourceId !== RICH_MDICT_SOURCE_ID || !samePointer(currentEntry.active, active)) throw staleIndex();
      currentEntry.active = { ...currentEntry.active, indexPath: nextIndex.indexPath, indexSchemaVersion: 2,
        indexSize: nextIndex.indexSize, indexSha256: digest, header: persisted.header };
      return current;
    });
    indexCache.delete(key);
    return loaded(cacheKey(next.packs[active.packId].active), persisted, nextIndex.indexSize, lease);
  });

  function loaded(key, index, weight, wantsLease) {
    indexCache.set(key, index, weight);
    if (!wantsLease) return index;
    return indexCache.acquire?.(key, index) || indexCache.hold?.(index) || { index, release() {} };
  }

  async function assertIndexSize(snapshot, path, signal) {
    const size = await store.getFileSize(snapshot.packId, snapshot.packVersion, path);
    assertNotAborted(signal);
    if (!Number.isSafeInteger(size) || size <= 0 || size > RICH_MDICT_MAX_INDEX_BYTES || size !== snapshot.indexSize) {
      throw richError("RICH_MDICT_CORRUPT", "Rich dictionary index is missing or has an invalid size.");
    }
  }

  async function readVerifiedIndex(snapshot, path, signal) {
    const bytes = await store.readFile(snapshot.packId, snapshot.packVersion, path);
    assertNotAborted(signal);
    const digest = await sha256(bytes, cryptoProvider);
    assertNotAborted(signal);
    if (digest !== snapshot.indexSha256) throw richError("RICH_MDICT_CORRUPT", "Rich dictionary index checksum failed.");
    const index = parseIndex(bytes);
    assertIndexMatchesMetadata(index, snapshot);
    return index;
  }
}

function samePointer(left, right) {
  return left?.packVersion === right.packVersion && left?.indexSha256 === right.indexSha256 &&
    richMdictIndexPath(left) === richMdictIndexPath(right);
}
function staleIndex() { return richError("RICH_MDICT_STALE", "Rich dictionary changed while its index was being read."); }
function assertNotAborted(signal) { if (signal?.aborted) throw richMdictAbortError(); }
