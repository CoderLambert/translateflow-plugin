import { createOpfsPackStore } from "./opfs-store.js";
import { createPackStateStore } from "./state.js";
import {
  buildMddIndex,
  createMddLookupBudget,
  lookupMddResource,
  verifyMddRecordBlocks,
  validateMddIndex
} from "./importers/mdd.js";
import { classifyMddResource } from "./importers/mdd-resource-policy.js";
import { MDD_IMPORT_LIMITS } from "./importers/mdd.js";
import {
  RICH_MDD_MAX_ASSET_BYTES,
  RICH_MDD_MAX_INDEX_BYTES,
  RICH_MDD_MAX_SOURCE_BYTES,
  RICH_MDD_MAX_TOTAL_INDEX_BYTES,
  RICH_MDD_MAX_TOTAL_SOURCE_BYTES,
  makeResourceSnapshot,
  normalizeResourceImportMetadata,
  parseMddIndex,
  resourceFilePaths,
  safeFileName,
  summarizeResources,
  validateMddCompanions,
  validateResourceRequest,
  validateResourceSnapshot
} from "./rich-mdd-contract.js";
import { sanitizeRichMddStylesheet } from "./rich-mdd-css.js";
import {
  assertStagedSidecars,
  bytesToBase64,
  normalizeSidecarPreflightFiles,
  resourceReader,
  validateResourceMime
} from "./rich-mdd-resource-utils.js";
import {
  RICH_MDICT_OPFS_ROOT,
  serializeRichMdictPack
} from "./rich-mdict.js";
import {
  RICH_MDICT_SOURCE_ID,
  isValidSnapshot,
  normalizePackId,
  normalizeRequestId,
  normalizeVersion,
  richError,
  richMdictAbortError,
  sha256
} from "./rich-mdict-contract.js";
import { RICH_MDICT_STATE_KEY } from "./rich-mdict-contract.js";
import {
  assertRichMddLookupActive,
  createRichMddLookupCancellation
} from "./rich-mdd-lookup-cancellation.js";

export function createRichMddResourceManager({
  store = createOpfsPackStore({ rootDir: RICH_MDICT_OPFS_ROOT }),
  stateStore = createPackStateStore({ stateKey: RICH_MDICT_STATE_KEY }),
  cryptoProvider = globalThis.crypto,
  storageManager = globalThis.navigator?.storage,
  buildIndex = buildMddIndex,
  lookup = lookupMddResource,
  validateIndex = validateMddIndex,
  createLookupBudget = createMddLookupBudget
} = {}) {
  if (!store?.writeFile || !store?.readFile || !store?.readFileRange || !store?.getFileSize) {
    throw new Error("MDD resource manager requires the existing rich dictionary OPFS store.");
  }
  if (!stateStore?.read || !stateStore?.update) {
    throw new Error("MDD resource manager requires the existing rich dictionary state store.");
  }

  const operationsByRequest = new Map();
  const lookupCancellation = createRichMddLookupCancellation();
  const indexCache = new Map();
  let cachedIndexBytes = 0;

  async function preflight({ dictionaryId, requestId, resourceVersion, mdxFileName, files, sidecars: sidecarInput = [] } = {}) {
    const packId = normalizePackId(dictionaryId);
    const id = normalizeRequestId(requestId);
    const version = normalizeVersion(resourceVersion);
    const ordered = validateMddCompanions((Array.isArray(files) ? files : []).map((file) => file?.fileName), mdxFileName);
    const sizeByName = new Map((Array.isArray(files) ? files : []).map((file) => [safeFileName(file?.fileName), Number(file?.size)]));
    let totalBytes = 0;
    for (const item of ordered) {
      const size = sizeByName.get(item.fileName);
      if (!Number.isSafeInteger(size) || size <= 0 || size > RICH_MDD_MAX_SOURCE_BYTES) {
        throw richError("RICH_MDD_LIMIT", "An MDD file exceeds the 128 MiB safety limit.");
      }
      totalBytes += size;
    }
    const sidecars = normalizeSidecarPreflightFiles(sidecarInput);
    const sidecarBytes = sidecars.reduce((sum, item) => sum + item.size, 0);
    if (totalBytes > RICH_MDD_MAX_TOTAL_SOURCE_BYTES) throw richError("RICH_MDD_LIMIT", "MDD companions exceed the 512 MiB total safety limit.");
    if (storageManager?.estimate) {
      const estimate = await storageManager.estimate();
      const quota = Number(estimate?.quota);
      const usage = Number(estimate?.usage);
      if (Number.isFinite(quota) && Number.isFinite(usage) && Math.max(0, quota - usage) < totalBytes + sidecarBytes + 32 * 1024 * 1024) {
        throw richError("RICH_MDD_QUOTA", "There is not enough browser storage for these MDD resources.");
      }
    }
    return serializeRichMdictPack(packId, async () => {
      if ((await store.listVersions(packId)).includes(version)) {
        throw richError("RICH_MDD_EXISTS", "This MDD resource import version is already in use.");
      }
      await stateStore.update((current) => {
        const entry = current.packs?.[packId];
        if (entry?.sourceId !== RICH_MDICT_SOURCE_ID || !isValidSnapshot(packId, entry.active)) {
          throw richError("RICH_MDD_DICTIONARY", "Install the matching rich MDX dictionary before attaching MDD resources.");
        }
        if (safeFileName(entry.active.fileName) !== safeFileName(mdxFileName)) {
          throw richError("RICH_MDD_DICTIONARY", "Selected MDD companions do not match the installed MDX filename.");
        }
        if (current.resourceReservations?.[id]) throw richError("RICH_MDD_BUSY", "MDD resource request ID is already reserved.");
        const duplicate = Object.values(current.resourceReservations || {}).some((reservation) => reservation?.packId === packId);
        if (duplicate) throw richError("RICH_MDD_BUSY", "Another MDD resource import is already active for this dictionary.");
        current.resourceReservations ||= {};
        current.resourceReservations[id] = { packId, resourceVersion: version, createdAt: Date.now() };
        return current;
      });
      return { ready: true, totalBytes: totalBytes + sidecarBytes, fileCount: ordered.length + sidecars.length };
    });
  }

  async function commit({ dictionaryId, requestId, resourceVersion, metadata } = {}) {
    const packId = normalizePackId(dictionaryId);
    const id = normalizeRequestId(requestId);
    const version = normalizeVersion(resourceVersion);
    if (operationsByRequest.has(id)) throw richError("RICH_MDD_BUSY", "MDD resource request ID is already active.");
    const operation = { requestId: id, packId, resourceVersion: version, controller: new AbortController(), phase: "verify", committed: false };
    operationsByRequest.set(id, operation);
    return serializeRichMdictPack(packId, async () => {
      try {
        const state = await stateStore.read();
        const entry = state.packs?.[packId];
        const reservation = state.resourceReservations?.[id];
        if (entry?.sourceId !== RICH_MDICT_SOURCE_ID || !isValidSnapshot(packId, entry.active)) {
          throw richError("RICH_MDD_DICTIONARY", "Rich MDX dictionary is no longer installed.");
        }
        if (reservation?.packId !== packId || reservation?.resourceVersion !== version) {
          throw richError("RICH_MDD_RESERVATION", "MDD resource import reservation is missing or expired.");
        }
        const normalized = normalizeResourceImportMetadata(metadata, entry.active.fileName);
        const totalIndexSize = normalized.resources.reduce((sum, source) => sum + source.indexSize, 0);
        if (totalIndexSize > RICH_MDD_MAX_TOTAL_INDEX_BYTES) throw richError("RICH_MDD_LIMIT", "MDD indexes exceed the 32 MiB total safety limit.");
        await assertStagedFiles({ packId, resourceVersion: version, resources: normalized.resources, sidecars: normalized.sidecars }, operation.controller.signal);
        if (operation.controller.signal.aborted) throw richMdictAbortError();
        const snapshot = makeResourceSnapshot({
          packId,
          packVersion: version,
          mdxFileName: entry.active.fileName,
          resources: normalized.resources,
          sidecars: normalized.sidecars
        });
        const oldSnapshot = entry.active.resources;
        operation.phase = "commitpoint";
        const next = await stateStore.update((current) => {
          const currentEntry = current.packs?.[packId];
          const currentReservation = current.resourceReservations?.[id];
          if (
            currentEntry?.sourceId !== RICH_MDICT_SOURCE_ID ||
            currentEntry.active?.packVersion !== entry.active.packVersion ||
            currentReservation?.packId !== packId || currentReservation?.resourceVersion !== version
          ) {
            throw richError("RICH_MDD_RESERVATION", "MDD resource activation state changed before commit.");
          }
          currentEntry.active.resources = snapshot;
          delete current.resourceReservations[id];
          return current;
        });
        operation.committed = true;
        if (validateResourceSnapshot(packId, oldSnapshot) && oldSnapshot.packVersion !== version) {
          await store.removeVersion(packId, oldSnapshot.packVersion).catch(() => {});
          removeCachedIndexes(packId, oldSnapshot.packVersion);
        }
        return {
          attached: true,
          dictionary: {
            id: packId,
            title: next.packs[packId].active.title,
            ...summarizeResources(snapshot)
          }
        };
      } catch (error) {
        if (!operation.committed) {
          await releaseReservation(id, packId, version).catch(() => {});
          const current = await stateStore.read().catch(() => null);
          const activeVersion = current?.packs?.[packId]?.active?.resources?.packVersion;
          if (activeVersion !== version) await store.removeVersion(packId, version).catch(() => {});
        }
        throw error;
      } finally {
        if (operationsByRequest.get(id) === operation) operationsByRequest.delete(id);
      }
    });
  }

  function cancel(requestId) {
    const operation = operationsByRequest.get(String(requestId || ""));
    if (!operation) return { cancelled: false, phase: "" };
    if (operation.phase === "commitpoint") return { cancelled: false, phase: "commitpoint" };
    operation.controller.abort();
    return { cancelled: true, phase: operation.phase };
  }

  async function abortImport({ dictionaryId, requestId, resourceVersion } = {}) {
    const packId = normalizePackId(dictionaryId);
    const id = normalizeRequestId(requestId);
    const version = normalizeVersion(resourceVersion);
    return serializeRichMdictPack(packId, async () => {
      const state = await stateStore.read();
      if (state.packs?.[packId]?.active?.resources?.packVersion === version) {
        return { removed: false, installed: true };
      }
      const removed = await store.removeVersion(packId, version);
      await releaseReservation(id, packId, version);
      return { removed, installed: false };
    });
  }

  async function lookupResource(input = {}, lookupIdentity = null) {
    const { packId, path, packageVersion } = validateResourceRequest(input);
    const operation = lookupIdentity ? lookupCancellation.begin(lookupIdentity) : null;
    const signal = operation?.controller.signal;
    try {
      return await serializeRichMdictPack(packId, async () => {
        assertRichMddLookupActive(signal);
        const state = await stateStore.read();
        assertRichMddLookupActive(signal);
        const entry = state.packs?.[packId];
        const snapshot = entry?.active?.resources;
        if (entry?.sourceId !== RICH_MDICT_SOURCE_ID || entry.status !== "healthy" || !isValidSnapshot(packId, entry.active)) {
          return { found: false, path };
        }
        const activePackageVersion = snapshot?.packVersion || entry.active.packVersion;
        if (packageVersion && packageVersion !== activePackageVersion) {
          return { found: false, stale: true, path, packageVersion: activePackageVersion };
        }
        if (!snapshot) return { found: false, path, packageVersion: activePackageVersion };
        if (!validateResourceSnapshot(packId, snapshot) || snapshot.mdxFileName !== entry.active.fileName) {
          throw richError("RICH_MDD_CORRUPT", "Installed MDD resource metadata is malformed.");
        }
        const budget = createLookupBudget();
        const sidecar = snapshot.sidecars?.find((item) => item.path === path) || null;
        const diagnostics = [];
        let match = null;
        for (let index = 0; index < snapshot.sources.length; index += 1) {
          try {
            assertRichMddLookupActive(signal);
            const descriptor = snapshot.sources[index];
            const mddIndex = await loadResourceIndex(packId, snapshot, descriptor, signal);
            assertRichMddLookupActive(signal);
            const source = resourceReader(store, packId, snapshot.packVersion, descriptor, signal);
            const result = await lookup({ source, index: mddIndex, path, budget, signal });
            assertRichMddLookupActive(signal);
            if (!result?.found) continue;
            if (!(result.bytes instanceof Uint8Array) || result.bytes.byteLength > RICH_MDD_MAX_ASSET_BYTES) {
              throw richError("RICH_MDD_CORRUPT", "MDD resource result exceeds its 8 MiB safety limit.");
            }
            validateResourceMime(result);
            if (result.kind === "stylesheet" && result.bytes.byteLength > 64 * 1024) {
              throw richError("RICH_MDD_LIMIT", "Local MDD stylesheet exceeds its 64 KiB safety limit.");
            }
            if (match) {
              if (sidecar) {
                match = null;
                diagnostics.push("resource.mdd_path_ambiguous_sidecar_used");
                break;
              }
              match.bytes = null;
              result.bytes = null;
              throw richError("RICH_MDD_CORRUPT", "MDD resource path is ambiguous across numbered companions.");
            }
            match = result;
          } catch (error) {
            if (!sidecar || signal?.aborted || error?.name === "AbortError") throw error;
            match = null;
            diagnostics.push("resource.mdd_unavailable_sidecar_used");
            break;
          }
        }
        assertRichMddLookupActive(signal);
        let selected = match;
        let sourceKind = "mdd";
        if (sidecar) {
          const bytes = await store.readFileRange(packId, snapshot.packVersion, sidecar.sourcePath, 0, sidecar.sourceSize, signal);
          assertRichMddLookupActive(signal);
          if (bytes.byteLength !== sidecar.sourceSize || await sha256(bytes, cryptoProvider) !== sidecar.sha256) {
            throw richError("RICH_MDD_CORRUPT", "Installed sidecar checksum failed.");
          }
          const actual = classifyMddResource(path, bytes, MDD_IMPORT_LIMITS);
          if (actual.kind !== sidecar.kind || actual.mime !== sidecar.mime) throw richError("RICH_MDD_CORRUPT", "Installed sidecar resource type does not match its manifest.");
          if (match && await sha256(match.bytes, cryptoProvider) !== sidecar.sha256) diagnostics.push("resource.sidecar_overrode_mdd");
          selected = { found: true, path, mime: actual.mime, kind: actual.kind, bytes, ...(actual.dimensions ? { dimensions: actual.dimensions } : {}) };
          sourceKind = "sidecar";
        }
        if (!selected) return { found: false, path, packageVersion: activePackageVersion };
        const sourceSha256 = await sha256(selected.bytes, cryptoProvider);
        let safeStylesheet = null;
        if (selected.kind === "stylesheet") {
          safeStylesheet = sanitizeRichMddStylesheet(selected.bytes, path);
          diagnostics.push(...safeStylesheet.diagnostics);
        }
        return {
          found: true,
          path,
          packageVersion: activePackageVersion,
          sourceKind,
          sourceSha256,
          mime: selected.mime,
          kind: selected.kind,
          ...(selected.dimensions ? { width: selected.dimensions.width, height: selected.dimensions.height } : {}),
          size: selected.bytes.byteLength,
          base64: bytesToBase64(selected.bytes, signal),
          ...(safeStylesheet ? { safeCss: safeStylesheet.css, assetSlots: safeStylesheet.assetSlots } : {}),
          diagnostics: [...new Set(diagnostics)].slice(0, 24)
        };
      });
    } finally {
      lookupCancellation.finish(operation);
    }
  }

  function cancelLookup(requestIdValue, ownerKeyValue) {
    return lookupCancellation.cancel(requestIdValue, ownerKeyValue);
  }

  async function assertStagedFiles({ packId, resourceVersion, resources, sidecars = [] }, signal) {
    for (const descriptor of resources) {
      if (signal?.aborted) throw richMdictAbortError();
      if (await store.getFileSize(packId, resourceVersion, descriptor.sourcePath) !== descriptor.sourceSize) {
        throw richError("RICH_MDD_CORRUPT", "Staged MDD source has an invalid size.");
      }
      const size = await store.getFileSize(packId, resourceVersion, descriptor.indexPath);
      if (size !== descriptor.indexSize || size > RICH_MDD_MAX_INDEX_BYTES) {
        throw richError("RICH_MDD_CORRUPT", "Staged MDD index has an invalid size.");
      }
      const bytes = await store.readFile(packId, resourceVersion, descriptor.indexPath);
      if (await sha256(bytes, cryptoProvider) !== descriptor.indexSha256) {
        throw richError("RICH_MDD_CORRUPT", "Staged MDD index checksum failed.");
      }
      const storedIndex = parseMddIndex(bytes, descriptor.sourceSize, validateIndex);
      if (storedIndex.keyCount !== descriptor.keyCount) throw richError("RICH_MDD_CORRUPT", "Staged MDD key count does not match its import metadata.");
      const source = resourceReader(store, packId, resourceVersion, descriptor, signal);
      const rebuilt = await buildIndex({ source, signal });
      validateIndex(rebuilt, { sourceSize: descriptor.sourceSize });
      if (JSON.stringify(rebuilt) !== JSON.stringify(storedIndex)) {
        throw richError("RICH_MDD_CORRUPT", "Staged MDD index does not match its raw MDD source.");
      }
      await verifyMddRecordBlocks({ source, index: rebuilt, signal });
    }
    await assertStagedSidecars({ store, packId, resourceVersion, sidecars, signal, cryptoProvider });
  }

  async function loadResourceIndex(packId, snapshot, descriptor, signal) {
    const key = `${packId}@${snapshot.packVersion}@${descriptor.indexSha256}`;
    const cached = indexCache.get(key);
    if (cached) {
      indexCache.delete(key);
      indexCache.set(key, cached);
      return cached.index;
    }
    assertRichMddLookupActive(signal);
    const size = await store.getFileSize(packId, snapshot.packVersion, descriptor.indexPath);
    assertRichMddLookupActive(signal);
    if (size !== descriptor.indexSize || size <= 0 || size > RICH_MDD_MAX_INDEX_BYTES) {
      throw richError("RICH_MDD_CORRUPT", "Installed MDD resource index is missing or malformed.");
    }
    const bytes = await store.readFileRange(packId, snapshot.packVersion, descriptor.indexPath, 0, size, signal);
    assertRichMddLookupActive(signal);
    if (await sha256(bytes, cryptoProvider) !== descriptor.indexSha256) {
      throw richError("RICH_MDD_CORRUPT", "Installed MDD resource index checksum failed.");
    }
    assertRichMddLookupActive(signal);
    const index = parseMddIndex(bytes, descriptor.sourceSize, validateIndex);
    cacheIndex(key, index, bytes.byteLength);
    return index;
  }

  function cacheIndex(key, index, size) {
    indexCache.set(key, { index, size });
    cachedIndexBytes += size;
    while (cachedIndexBytes > RICH_MDD_MAX_TOTAL_INDEX_BYTES && indexCache.size) {
      const oldestKey = indexCache.keys().next().value;
      const oldest = indexCache.get(oldestKey);
      indexCache.delete(oldestKey);
      cachedIndexBytes -= oldest.size;
    }
  }

  function removeCachedIndexes(packId, version) {
    for (const [key, cached] of indexCache) {
      if (!key.startsWith(`${packId}@${version}@`)) continue;
      indexCache.delete(key);
      cachedIndexBytes -= cached.size;
    }
  }

  async function releaseReservation(id, packId, version) {
    await stateStore.update((current) => {
      const reservation = current.resourceReservations?.[id];
      if (reservation?.packId === packId && reservation?.resourceVersion === version) delete current.resourceReservations[id];
      return current;
    });
  }

  function forgetDictionary(dictionaryId) {
    let packId;
    try { packId = normalizePackId(dictionaryId); } catch { return; }
    for (const [key, cached] of indexCache) {
      if (!key.startsWith(`${packId}@`)) continue;
      indexCache.delete(key);
      cachedIndexBytes -= cached.size;
    }
  }

  return Object.freeze({ preflight, commit, cancel, abortImport, lookupResource, cancelLookup, forgetDictionary });
}
