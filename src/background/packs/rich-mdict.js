import { createOpfsPackStore } from "./opfs-store.js";
import { createPackStateStore } from "./state.js";
import {
  buildRichMdictIndex,
  lookupRichMdict,
  validateRichMdictIndex
} from "./importers/mdict-rich.js";
import {
  RICH_MDICT_INDEX_PATH,
  RICH_MDICT_MAX_DISPLAY_CHARS,
  RICH_MDICT_MAX_INDEX_BYTES,
  RICH_MDICT_MAX_RECORD_BYTES,
  RICH_MDICT_OPFS_ROOT,
  RICH_MDICT_MAX_SOURCE_BYTES,
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
  normalizeQuery,
  normalizeVersion,
  parseIndex,
  publicRichDictionary,
  richError,
  richMdictAbortError,
  sanitizeDebugMetrics,
  sha256,
  validateCommit
} from "./rich-mdict-contract.js";

export {
  RICH_MDICT_INDEX_PATH,
  RICH_MDICT_OPFS_ROOT,
  RICH_MDICT_SOURCE_PATH,
  RICH_MDICT_STATE_KEY
};

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
  const operationQueues = new Map();
  const operationsByRequest = new Map();

  function commit(input = {}) {
    const metadata = validateCommit(input);
    const requestId = normalizeRequestId(input.requestId);
    if (operationsByRequest.has(requestId)) {
      throw richError("RICH_MDICT_BUSY", "Rich dictionary request ID is already active.");
    }
    const operation = {
      requestId,
      packId: metadata.packId,
      packVersion: metadata.packVersion,
      controller: new AbortController(),
      phase: "verify",
      committed: false
    };
    operationsByRequest.set(requestId, operation);
    return serialize(metadata.packId, async () => {
      try {
        if (operation.controller.signal.aborted) throw richMdictAbortError();
        const state = await stateStore.read();
        if (state.packs[metadata.packId]) {
          throw richError("RICH_MDICT_EXISTS", "This rich dictionary identifier is already installed.");
        }
        const reservation = state.reservations?.[requestId];
        if (
          reservation?.packId !== metadata.packId ||
          reservation?.packVersion !== metadata.packVersion
        ) {
          throw richError("RICH_MDICT_RESERVATION", "Rich dictionary import reservation is missing or expired.");
        }
        const index = await assertStagedFiles(metadata, operation.controller.signal);
        if (operation.controller.signal.aborted) throw richMdictAbortError();
        const snapshot = makeRichMdictSnapshot(metadata, index);
        operation.phase = "commitpoint";
        const next = await stateStore.update((current) => {
          if (current.packs[metadata.packId]) {
            throw richError("RICH_MDICT_EXISTS", "This rich dictionary identifier is already installed.");
          }
          const activeReservation = current.reservations?.[requestId];
          if (
            activeReservation?.packId !== metadata.packId ||
            activeReservation?.packVersion !== metadata.packVersion
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
        return {
          status: "installed",
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

  async function lookupText(text) {
    const query = normalizeQuery(text);
    const state = await stateStore.read();
    const dictionaries = [];
    const errors = [];
    for (const [packId, entry] of Object.entries(state.packs || {})) {
      if (entry?.sourceId !== RICH_MDICT_SOURCE_ID || entry?.status !== "healthy") continue;
      const active = entry.active;
      try {
        if (!isValidSnapshot(packId, active)) {
          throw richError("RICH_MDICT_CORRUPT", "Rich dictionary metadata is malformed.");
        }
        await assertSourceSize(active);
        const index = await loadIndex(active);
        const result = await lookup({
          source: sourceReader(packId, active),
          index,
          text: query
        });
        if (result?.found) {
          dictionaries.push({
            id: packId,
            title: active.title,
            headword: clampText(result.displayForm, 300),
            text: clampText(result.safeTextFallback, RICH_MDICT_MAX_DISPLAY_CHARS),
            richRecord: {
              rawRecord: clampUtf8Text(result.rawRecord, RICH_MDICT_MAX_RECORD_BYTES),
              format: clampText(index.header.format, 40),
              styleSheetRules: index.header.styleSheetRules.map(({ id, begin, end }) => ({ id, begin, end }))
            },
            ...(result.aliasTarget ? { aliasTarget: clampText(result.aliasTarget, 300) } : {}),
            ...(result.debugMetrics ? { debugMetrics: sanitizeDebugMetrics(result.debugMetrics) } : {})
          });
        }
      } catch (error) {
        errors.push({
          id: packId,
          title: clampText(active?.title || packId, 200),
          code: error?.code || "RICH_MDICT_STORAGE",
          message: clampText(error?.message || String(error), 300)
        });
      }
    }
    return { found: dictionaries.length > 0, dictionaries, errors };
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
      if (state.packs[id]?.sourceId === RICH_MDICT_SOURCE_ID) {
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
      return { removed, installed: false };
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

  async function loadIndex(snapshot) {
    const size = await store.getFileSize(snapshot.packId, snapshot.packVersion, RICH_MDICT_INDEX_PATH);
    if (!Number.isSafeInteger(size) || size <= 0 || size > RICH_MDICT_MAX_INDEX_BYTES || size !== snapshot.indexSize) {
      throw richError("RICH_MDICT_CORRUPT", "Rich dictionary index is missing or has an invalid size.");
    }
    const key = cacheKey(snapshot);
    const cached = indexCache.get(key);
    if (cached) return cached;
    const bytes = await store.readFile(snapshot.packId, snapshot.packVersion, RICH_MDICT_INDEX_PATH);
    if (await sha256(bytes, cryptoProvider) !== snapshot.indexSha256) {
      throw richError("RICH_MDICT_CORRUPT", "Rich dictionary index checksum failed.");
    }
    const index = parseIndex(bytes);
    assertIndexMatchesMetadata(index, snapshot);
    indexCache.set(key, index);
    return index;
  }

  async function preflightQuota(sourceBytes, identity = null) {
    if (!Number.isSafeInteger(sourceBytes) || sourceBytes <= 0 || sourceBytes > RICH_MDICT_MAX_SOURCE_BYTES) {
      throw richError("RICH_MDICT_LIMIT", "MDX file exceeds the current 128 MiB safety limit.");
    }
    if (storageManager?.estimate) {
      const estimate = await storageManager.estimate();
      const quota = Number(estimate?.quota);
      const usage = Number(estimate?.usage);
      if (
        Number.isFinite(quota) && Number.isFinite(usage) &&
        Math.max(0, quota - usage) < sourceBytes + 32 * 1024 * 1024
      ) {
        throw richError("RICH_MDICT_QUOTA", "There is not enough browser storage for this rich dictionary.");
      }
    }
    if (identity) {
      const requestId = normalizeRequestId(identity.requestId);
      const packId = normalizePackId(identity.packId);
      const packVersion = normalizeVersion(identity.packVersion);
      await serialize(packId, async () => {
        const existingVersions = await store.listVersions(packId);
        await stateStore.update((current) => {
          if (current.packs[packId]) {
            throw richError("RICH_MDICT_EXISTS", "This rich dictionary identifier is already installed.");
          }
          const collision = Object.entries(current.reservations || {}).some(([otherId, reservation]) =>
            reservation?.packId === packId
          );
          if (collision || current.reservations?.[requestId] || existingVersions.length) {
            throw richError("RICH_MDICT_EXISTS", "This rich dictionary identifier is already in use.");
          }
          current.reservations ||= {};
          current.reservations[requestId] = { packId, packVersion, createdAt: Date.now() };
          return current;
        });
      });
    }
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
    const previous = operationQueues.get(id) || Promise.resolve();
    const run = previous.catch(() => {}).then(action);
    let queued;
    queued = run.finally(() => {
      if (operationQueues.get(id) === queued) operationQueues.delete(id);
    });
    operationQueues.set(id, queued);
    return queued;
  }

  function sourceReader(packId, snapshot, signal) {
    return {
      size: snapshot.sourceSize,
      async read(offset, length) {
        if (signal?.aborted) throw richMdictAbortError();
        const bytes = await store.readFileRange(packId, snapshot.packVersion, RICH_MDICT_SOURCE_PATH, offset, length);
        if (signal?.aborted) throw richMdictAbortError();
        return bytes;
      }
    };
  }

  return Object.freeze({
    commit,
    cancel,
    list,
    lookup: lookupText,
    uninstall,
    abortImport,
    preflightQuota
  });
}
