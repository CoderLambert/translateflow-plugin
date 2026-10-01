import { createOpfsPackStore } from "./opfs-store.js";
import { createPackStateStore } from "./state.js";
import {
  buildRichMdictIndex,
  lookupRichMdict,
  validateRichMdictIndex
} from "./importers/mdict-rich.js";
import { createRichMdictLookupController } from "./rich-mdict-lookup-controller.js";
import {
  RICH_MDICT_INDEX_PATH,
  RICH_MDICT_MAX_INDEX_BYTES,
  RICH_MDICT_OPFS_ROOT,
  RICH_MDICT_SOURCE_ID,
  RICH_MDICT_SOURCE_PATH,
  RICH_MDICT_STATE_KEY,
  assertIndexMatchesMetadata,
  cacheKey,
  clampText,
  compareText,
  isValidSnapshot,
  makeRichMdictSnapshot,
  normalizeRequestId,
  normalizePackId,
  normalizeVersion,
  parseIndex,
  publicRichDictionary,
  richError,
  richMdictAbortError,
  sha256,
  validateCommit
} from "./rich-mdict-contract.js";
import {
  assertCatalogReplacementTarget,
  cleanupCatalogVersions,
  retainCatalogResources,
  sameCatalogReplacement,
  validateCatalogReplacement
} from "./rich-mdict-catalog-replacement.js";
import {
  createRichMdictInstallPreflight
} from "./rich-mdict-install-preflight.js";

export {
  RICH_MDICT_INDEX_PATH,
  RICH_MDICT_OPFS_ROOT,
  RICH_MDICT_SOURCE_PATH,
  RICH_MDICT_STATE_KEY
};

const sharedPackOperationQueues = new Map();
export function serializeRichMdictPack(packId, action) {
  const previous = sharedPackOperationQueues.get(packId) || Promise.resolve();
  const run = previous.catch(() => {}).then(action);
  let queued;
  queued = run.finally(() => {
    if (sharedPackOperationQueues.get(packId) === queued) sharedPackOperationQueues.delete(packId);
  });
  sharedPackOperationQueues.set(packId, queued);
  return queued;
}

export function createRichMdictManager({
  store = createOpfsPackStore({ rootDir: RICH_MDICT_OPFS_ROOT }),
  stateStore = createPackStateStore({ stateKey: RICH_MDICT_STATE_KEY }),
  cryptoProvider = globalThis.crypto,
  lookup = lookupRichMdict,
  buildIndex = buildRichMdictIndex,
  storageManager = globalThis.navigator?.storage
} = {}) {
  if (!store?.writeFile || !store?.readFile || !store?.readFileRange || !store?.getFileSize) {
    throw new Error("Rich MDict manager requires the OPFS dictionary pack store.");
  }
  if (!stateStore?.read || !stateStore?.update) {
    throw new Error("Rich MDict manager requires a namespaced dictionary state store.");
  }

  const indexCache = new Map();
  const operationsByRequest = new Map();
  const preflightQuota = createRichMdictInstallPreflight({
    store,
    stateStore,
    storageManager,
    serialize
  });
  const lookupController = createRichMdictLookupController({
    stateStore,
    lookup,
    assertSourceSize,
    loadIndex,
    sourceReader,
    clampUtf8Text
  });

  function commit(input = {}) {
    const metadata = validateCommit(input);
    const catalogReplacement = validateCatalogReplacement(
      input.catalogReplacement,
      metadata.packId,
      metadata.curated
    );
    const requestId = normalizeRequestId(input.requestId);
    if (operationsByRequest.has(requestId)) {
      throw richError("RICH_MDICT_BUSY", "Rich dictionary request ID is already active.");
    }
    const operation = {
      requestId,
      packId: metadata.packId,
      packVersion: metadata.packVersion,
      catalogReplacement,
      controller: new AbortController(),
      phase: "verify",
      committed: false
    };
    operationsByRequest.set(requestId, operation);
    return serialize(metadata.packId, async () => {
      try {
        if (operation.controller.signal.aborted) throw richMdictAbortError();
        const state = await stateStore.read();
        assertCatalogReplacementTarget(
          state.packs[metadata.packId],
          catalogReplacement,
          metadata.packVersion
        );
        const reservation = state.reservations?.[requestId];
        if (
          reservation?.packId !== metadata.packId ||
          reservation?.packVersion !== metadata.packVersion ||
          !sameCatalogReplacement(reservation?.catalogReplacement, catalogReplacement)
        ) {
          throw richError("RICH_MDICT_RESERVATION", "Rich dictionary import reservation is missing or expired.");
        }
        const index = await assertStagedFiles(metadata, operation.controller.signal);
        if (operation.controller.signal.aborted) throw richMdictAbortError();
        const snapshot = makeRichMdictSnapshot(metadata, index);
        const previousSnapshot = state.packs[metadata.packId]?.active || null;
        const retainedResourceVersion = retainCatalogResources(
          previousSnapshot,
          snapshot,
          catalogReplacement
        );
        operation.phase = "commitpoint";
        const next = await stateStore.update((current) => {
          assertCatalogReplacementTarget(
            current.packs[metadata.packId],
            catalogReplacement,
            metadata.packVersion
          );
          const activeReservation = current.reservations?.[requestId];
          if (
            activeReservation?.packId !== metadata.packId ||
            activeReservation?.packVersion !== metadata.packVersion ||
            !sameCatalogReplacement(activeReservation?.catalogReplacement, catalogReplacement)
          ) {
            throw richError("RICH_MDICT_RESERVATION", "Rich dictionary import reservation is missing or expired.");
          }
          current.packs[metadata.packId] = {
            sourceId: RICH_MDICT_SOURCE_ID,
            status: "healthy",
            active: snapshot,
            fallback: null
          };
          delete current.reservations[requestId];
          return current;
        });
        operation.committed = true;
        indexCache.set(cacheKey(snapshot), index);
        if (catalogReplacement) await cleanupCatalogVersions({
          store,
          indexCache,
          packId: metadata.packId,
          activeVersion: metadata.packVersion,
          retainedResourceVersion
        });
        return {
          status: catalogReplacement ? "replaced" : "installed",
          dictionary: publicRichDictionary(next.packs[metadata.packId])
        };
      } catch (error) {
        if (!operation.committed) {
          await releaseReservation(requestId, metadata.packId, metadata.packVersion).catch(() => {});
          const state = await stateStore.read().catch(() => null);
          const active = state?.packs?.[metadata.packId]?.active;
          const pointsToStaged = active?.packVersion === metadata.packVersion;
          if (!pointsToStaged) {
            await store.removeVersion(metadata.packId, metadata.packVersion).catch(() => {});
          }
        }
        throw error;
      } finally {
        if (operationsByRequest.get(requestId) === operation) operationsByRequest.delete(requestId);
      }
    });
  }

  function cancel(requestId) {
    const operation = operationsByRequest.get(String(requestId || ""));
    if (!operation) return { cancelled: false, phase: "" };
    if (operation.phase === "commitpoint") {
      return { cancelled: false, phase: "commitpoint" };
    }
    operation.controller.abort();
    return { cancelled: true, phase: operation.phase };
  }

  async function list() {
    const state = await stateStore.read();
    const dictionaries = [];
    for (const [packId, entry] of Object.entries(state.packs || {})) {
      if (entry?.sourceId !== RICH_MDICT_SOURCE_ID) continue;
      const active = entry.active;
      const base = publicRichDictionary(entry);
      try {
        if (!isValidSnapshot(packId, active)) {
          throw richError("RICH_MDICT_CORRUPT", "Rich dictionary metadata is malformed.");
        }
        await assertSourceSize(active);
        const index = await loadIndex(active);
        dictionaries.push({ ...base, status: "ready", entryCount: index.entryCount });
      } catch (error) {
        dictionaries.push({
          ...base,
          status: error?.missing ? "missing" : "corrupt",
          errorCode: error?.code || "RICH_MDICT_STORAGE",
          error: error?.message || String(error)
        });
      }
    }
    dictionaries.sort((a, b) => compareText(a.title, b.title) || compareText(a.id, b.id));
    return { dictionaries };
  }

  function assertLookupNotAborted(signal) {
    if (signal?.aborted) throw richMdictAbortError();
  }

  function clampUtf8Text(value, maxBytes) {
    const text = String(value ?? "");
    const encoder = new TextEncoder();
    if (text.length <= maxBytes && encoder.encode(text).byteLength <= maxBytes) return text;
    const { read } = encoder.encodeInto(text, new Uint8Array(maxBytes));
    return text.slice(0, read);
  }

  async function uninstall(packId) {
    const id = normalizePackId(packId);
    return serialize(id, async () => {
      const state = await stateStore.read();
      const entry = state.packs[id];
      if (!entry || entry.sourceId !== RICH_MDICT_SOURCE_ID) return { uninstalled: false };
      // Remove bytes first so a failed OPFS deletion leaves a visible, retryable row.
      await store.removePack(id);
      await stateStore.update((current) => {
        delete current.packs[id];
        for (const [requestId, reservation] of Object.entries(current.resourceReservations || {})) {
          if (reservation?.packId === id) delete current.resourceReservations[requestId];
        }
        return current;
      });
      if (isValidSnapshot(id, entry.active)) indexCache.delete(cacheKey(entry.active));
      return { uninstalled: true };
    });
  }

  async function abortImport({ packId, packVersion } = {}) {
    const id = normalizePackId(packId);
    const version = normalizeVersion(packVersion);
    return serialize(id, async () => {
      const state = await stateStore.read();
      const entry = state.packs[id];
      if (
        entry?.sourceId === RICH_MDICT_SOURCE_ID &&
        entry.active?.packVersion === version
      ) {
        return { removed: false, installed: true };
      }
      const removed = await store.removeVersion(id, version);
      await stateStore.update((current) => {
        for (const [requestId, reservation] of Object.entries(current.reservations || {})) {
          if (reservation?.packId === id && reservation?.packVersion === version) {
            delete current.reservations[requestId];
          }
        }
        return current;
      });
      return { removed, installed: Boolean(entry?.sourceId === RICH_MDICT_SOURCE_ID) };
    });
  }

  async function assertStagedFiles(metadata, signal) {
    const source = sourceReader(metadata.packId, metadata, signal);
    await assertSourceSize(metadata);
    const indexSize = await store.getFileSize(metadata.packId, metadata.packVersion, RICH_MDICT_INDEX_PATH);
    if (indexSize !== metadata.indexSize || indexSize <= 0 || indexSize > RICH_MDICT_MAX_INDEX_BYTES) {
      throw richError("RICH_MDICT_CORRUPT", "Staged rich dictionary index has an invalid size.");
    }
    const bytes = await store.readFile(metadata.packId, metadata.packVersion, RICH_MDICT_INDEX_PATH);
    if (await sha256(bytes, cryptoProvider) !== metadata.indexSha256) {
      throw richError("RICH_MDICT_CORRUPT", "Staged rich dictionary index checksum failed.");
    }
    const storedIndex = parseIndex(bytes);
    assertIndexMatchesMetadata(storedIndex, metadata);

    // Rebuild all compact descriptors from OPFS ranges before the active pointer is written.
    // Key blocks are decoded one at a time; the whole MDX and its records are never loaded.
    const rebuiltIndex = await buildIndex({ source, signal });
    validateRichMdictIndex(rebuiltIndex, { sourceSize: metadata.sourceSize });
    if (JSON.stringify(rebuiltIndex) !== JSON.stringify(storedIndex)) {
      throw richError("RICH_MDICT_CORRUPT", "Staged rich dictionary index does not match the raw MDX source.");
    }
    return storedIndex;
  }

  async function assertSourceSize(snapshot) {
    const sourceSize = await store.getFileSize(snapshot.packId, snapshot.packVersion, RICH_MDICT_SOURCE_PATH);
    if (sourceSize !== snapshot.sourceSize) {
      throw richError("RICH_MDICT_CORRUPT", "Rich dictionary source size does not match its installed index.");
    }
  }

  async function loadIndex(snapshot, signal) {
    assertLookupNotAborted(signal);
    const size = await store.getFileSize(snapshot.packId, snapshot.packVersion, RICH_MDICT_INDEX_PATH);
    assertLookupNotAborted(signal);
    if (!Number.isSafeInteger(size) || size <= 0 || size > RICH_MDICT_MAX_INDEX_BYTES || size !== snapshot.indexSize) {
      throw richError("RICH_MDICT_CORRUPT", "Rich dictionary index is missing or has an invalid size.");
    }
    const key = cacheKey(snapshot);
    const cached = indexCache.get(key);
    if (cached) return cached;
    const bytes = await store.readFile(snapshot.packId, snapshot.packVersion, RICH_MDICT_INDEX_PATH);
    assertLookupNotAborted(signal);
    const digest = await sha256(bytes, cryptoProvider);
    assertLookupNotAborted(signal);
    if (digest !== snapshot.indexSha256) {
      throw richError("RICH_MDICT_CORRUPT", "Rich dictionary index checksum failed.");
    }
    const index = parseIndex(bytes);
    assertLookupNotAborted(signal);
    assertIndexMatchesMetadata(index, snapshot);
    indexCache.set(key, index);
    return index;
  }

  async function releaseReservation(requestId, packId, packVersion) {
    await stateStore.update((current) => {
      const reservation = current.reservations?.[requestId];
      if (reservation?.packId === packId && reservation?.packVersion === packVersion) {
        delete current.reservations[requestId];
      }
      return current;
    });
  }

  function serialize(id, action) {
    return serializeRichMdictPack(id, action);
  }

  function sourceReader(packId, snapshot, signal) {
    return {
      size: snapshot.sourceSize,
      async read(offset, length, requestSignal = signal) {
        if (signal?.aborted || requestSignal?.aborted) throw richMdictAbortError();
        const bytes = await store.readFileRange(
          packId,
          snapshot.packVersion,
          RICH_MDICT_SOURCE_PATH,
          offset,
          length,
          requestSignal
        );
        if (signal?.aborted || requestSignal?.aborted) throw richMdictAbortError();
        return bytes;
      }
    };
  }

  return Object.freeze({
    commit,
    cancel,
    list,
    listMetadata: async () => { const state = await stateStore.read();
      return { dictionaries: Object.entries(state.packs || {}).flatMap(([id, entry]) => {
        try { normalizePackId(id); } catch { return []; } if (entry?.sourceId !== RICH_MDICT_SOURCE_ID) return [];
        let valid = false;
        try { valid = isValidSnapshot(id, entry.active); } catch { /* malformed metadata is shown as a corrupt card */ }
        const status = valid && entry.status === "healthy" ? "ready" : entry.status === "missing" ? "missing" : "corrupt";
        return [{ ...publicRichDictionary(entry), id, status, errorCode: status === "ready" ? "" : status === "missing" ? "RICH_MDICT_MISSING" : "RICH_MDICT_CORRUPT" }];
      }) };
    },
    lookup: lookupController.lookupText,
    lookupDictionary: lookupController.lookupText,
    cancelLookup: lookupController.cancelLookup,
    uninstall,
    abortImport,
    preflightQuota
  });
}
