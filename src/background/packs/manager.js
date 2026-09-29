import {
  PACK_ERROR_CODES,
  PACK_LIMITS,
  packError
} from "../../shared/pack-manager.js";
import {
  OPTIONAL_PACK_SOURCES,
  getOptionalPackSource
} from "../../shared/pack-sources.js";
import {
  validateTrustedSource,
  verifyTrustedCatalog
} from "./catalog.js";
import { createOpfsPackStore } from "./opfs-store.js";
import {
  assertPackOperationActive,
  normalizePackOperationError
} from "./operation.js";
import { createPackStateStore } from "./state.js";
import {
  inspectInstalledPack,
  verifyDownloadedFile
} from "./health.js";
import { createLocalTflexImportTransaction } from "./local-import-transaction.js";
import {
  fetchTrustedPackCatalog,
  fetchTrustedPackFile
} from "../providers/pack-network.js";
import {
  enforceNoAutomaticDowngrade,
  publicPackState,
  publicState,
  snapshotFromPack,
  versionsInState
} from "./snapshot.js";

export function createDictionaryPackManager({
  sources = OPTIONAL_PACK_SOURCES,
  store = createOpfsPackStore(),
  stateStore = createPackStateStore(),
  permissions = globalThis.chrome?.permissions,
  storageManager = globalThis.navigator?.storage,
  cryptoProvider = globalThis.crypto,
  network = {
    fetchCatalog: fetchTrustedPackCatalog,
    fetchFile: fetchTrustedPackFile
  }
} = {}) {
  const operationsByPack = new Map();
  const controllersByRequest = new Map();

  async function install({ sourceId, packId, requestId } = {}) {
    const source = validateTrustedSource(getOptionalPackSource(sourceId, sources));
    if (!source.declaredPackIds.includes(String(packId || ""))) {
      throw packError(PACK_ERROR_CODES.NOT_FOUND, "Dictionary pack is not declared by this trusted source.");
    }
    const id = String(requestId || crypto.randomUUID());
    if (controllersByRequest.has(id)) {
      throw packError(PACK_ERROR_CODES.BUSY, "Dictionary pack requestId is already in use.", {
        requestId: id
      });
    }
    if (operationsByPack.has(packId)) {
      throw packError(PACK_ERROR_CODES.BUSY, "Another dictionary pack operation is already running.", { packId });
    }

    const controller = new AbortController();
    operationsByPack.set(packId, id);
    controllersByRequest.set(id, controller);
    let stagedVersion = "";
    let protectedVersions = new Set();

    try {
      await requirePermission(source);
      const recovered = await recoverPack(packId);
      const before = recovered.state;
      protectedVersions = versionsInState(before.packs[packId]);

      const { catalogBytes, signatureBytes } = await network.fetchCatalog(source, {
        signal: controller.signal
      });
      assertPackOperationActive(controller.signal);

      const highestSequence = Number(before.catalogSequences[source.id] || 0);
      const catalog = await verifyTrustedCatalog({
        catalogBytes,
        signatureBytes,
        source,
        highestSequence,
        cryptoProvider
      });
      await stateStore.update((state) => {
        state.catalogSequences[source.id] = Math.max(
          Number(state.catalogSequences[source.id] || 0),
          catalog.sequence
        );
        return state;
      });

      const pack = catalog.packs.find((item) => item.packId === packId);
      if (!pack) throw packError(PACK_ERROR_CODES.NOT_FOUND, "Signed catalog does not contain the requested dictionary pack.");

      const currentState = await stateStore.read();
      const current = currentState.packs[packId] || null;
      enforceNoAutomaticDowngrade(current?.active, pack);

      if (
        current?.active?.packVersion === pack.packVersion &&
        current.active.releaseSequence === pack.releaseSequence
      ) {
        const inspection = await inspectInstalledPack({ store, snapshot: current.active, cryptoProvider });
        if (inspection.status === "healthy") {
          return { status: "already-installed", pack: publicPackState(current), catalogSequence: catalog.sequence };
        }
      }

      if (current?.fallback?.packVersion === pack.packVersion) {
        if (
          current.fallback.releaseSequence !== pack.releaseSequence ||
          current.fallback.fingerprint !== pack.fingerprint
        ) {
          throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "Protected rollback version conflicts with signed catalog metadata.");
        }
        const inspection = await inspectInstalledPack({ store, snapshot: current.fallback, cryptoProvider });
        if (inspection.status === "healthy") {
          const promoted = await stateStore.update((state) => {
            const entry = state.packs[packId];
            const previousActive = entry.active;
            entry.active = entry.fallback;
            entry.fallback = previousActive;
            entry.status = "healthy";
            entry.recoveryReason = "catalog-promote-verified-fallback";
            entry.lastError = null;
            return state;
          });
          return { status: "updated", pack: publicPackState(promoted.packs[packId]), catalogSequence: catalog.sequence };
        }
        throw packError(PACK_ERROR_CODES.CORRUPT, "Protected rollback version is corrupt and cannot be overwritten.");
      }

      await preflightQuota(pack.totalBytes);
      stagedVersion = pack.packVersion;
      if (!protectedVersions.has(stagedVersion)) {
        await store.removeVersion(packId, stagedVersion);
      }

      for (const descriptor of pack.files) {
        assertPackOperationActive(controller.signal);
        const bytes = await network.fetchFile(source, descriptor, { signal: controller.signal });
        assertPackOperationActive(controller.signal);
        await verifyDownloadedFile(descriptor, bytes, cryptoProvider);
        await store.writeFile(packId, pack.packVersion, descriptor.path, bytes);
        assertPackOperationActive(controller.signal);
      }

      const snapshot = snapshotFromPack(pack, source.id, catalog.sequence);
      const stagedInspection = await inspectInstalledPack({ store, snapshot, cryptoProvider });
      if (stagedInspection.status !== "healthy") {
        throw packError(PACK_ERROR_CODES.CORRUPT, "Staged dictionary pack failed post-write health check.", {
          packId,
          packVersion: pack.packVersion,
          inspection: stagedInspection
        });
      }
      assertPackOperationActive(controller.signal);

      const nextState = await stateStore.update((state) => {
        const previous = state.packs[packId] || null;
        const fallback = previous?.active && previous.active.packVersion !== snapshot.packVersion
          ? previous.active
          : previous?.fallback || null;
        state.packs[packId] = {
          sourceId: source.id,
          status: "healthy",
          active: snapshot,
          fallback,
          recoveryReason: null,
          lastError: null
        };
        return state;
      });

      const installed = nextState.packs[packId];

      // Pointer commit is final; recovery retries best-effort orphan cleanup.
      stagedVersion = "";
      await store.cleanupPack(packId, [...versionsInState(installed)]).catch(() => {});
      return {
        status: current?.active ? "updated" : "installed",
        pack: publicPackState(installed),
        catalogSequence: catalog.sequence
      };
    } catch (error) {
      if (stagedVersion && !protectedVersions.has(stagedVersion)) {
        await store.removeVersion(packId, stagedVersion).catch(() => {});
      }
      throw normalizePackOperationError(error);
    } finally {
      if (operationsByPack.get(packId) === id) operationsByPack.delete(packId);
      if (controllersByRequest.get(id) === controller) controllersByRequest.delete(id);
    }
  }

  function cancel(requestId) {
    const id = String(requestId || "");
    const controller = controllersByRequest.get(id);
    if (!controller) return { cancelled: false };
    controller.abort();
    controllersByRequest.delete(id);
    return { cancelled: true };
  }

  async function uninstall(packId) {
    const id = String(packId || "");
    if (operationsByPack.has(id)) {
      throw packError(PACK_ERROR_CODES.BUSY, "Dictionary pack is busy.", { packId: id });
    }
    // Persist pointer removal before destructive OPFS cleanup.
    const state = await stateStore.update((current) => {
      delete current.packs[id];
      return current;
    });
    await store.removePack(id);
    return { uninstalled: true, state: publicState(state) };
  }

  async function rollback(packId) {
    const id = String(packId || "");
    if (operationsByPack.has(id)) {
      throw packError(PACK_ERROR_CODES.BUSY, "Dictionary pack is busy.", { packId: id });
    }
    const current = (await recoverPack(id)).state;
    const entry = current.packs[id];
    if (!entry?.fallback) {
      throw packError(PACK_ERROR_CODES.NOT_FOUND, "No verified rollback version is available.", { packId: id });
    }
    const inspection = await inspectInstalledPack({ store, snapshot: entry.fallback, cryptoProvider });
    if (inspection.status !== "healthy") {
      throw packError(PACK_ERROR_CODES.NEEDS_REINSTALL, "Rollback dictionary version is unavailable or corrupt.", {
        packId: id,
        inspection
      });
    }
    const updated = await stateStore.update((state) => {
      const pack = state.packs[id];
      const previousActive = pack.active;
      pack.active = pack.fallback;
      pack.fallback = previousActive;
      pack.status = "healthy";
      pack.recoveryReason = "manual-rollback";
      pack.lastError = null;
      return state;
    });
    return { rolledBack: true, pack: publicPackState(updated.packs[id]) };
  }

  async function recoverPack(packId) {
    const id = String(packId || "");
    const state = await stateStore.read();
    const entry = state.packs[id];
    if (!entry?.active) return { state, result: "not-installed" };

    const activeInspection = await inspectInstalledPack({
      store,
      snapshot: entry.active,
      cryptoProvider
    });
    if (activeInspection.status === "healthy") {
      if (entry.fallback) {
        const fallbackInspection = await inspectInstalledPack({
          store,
          snapshot: entry.fallback,
          cryptoProvider
        });
        if (fallbackInspection.status !== "healthy") {
          const updated = await stateStore.update((current) => {
            const pack = current.packs[id];
            pack.fallback = null;
            pack.recoveryReason = "discarded-unhealthy-fallback";
            return current;
          });
          await store.cleanupPack(id, [...versionsInState(updated.packs[id])]).catch(() => {});
          return { state: updated, result: "healthy-fallback-discarded", inspection: fallbackInspection };
        }
      }
      await store.cleanupPack(id, [...versionsInState(entry)]).catch(() => {});
      return { state, result: "healthy" };
    }

    const fallbackInspection = entry.fallback
      ? await inspectInstalledPack({ store, snapshot: entry.fallback, cryptoProvider })
      : null;
    if (entry.fallback && fallbackInspection?.status === "healthy") {
      const updated = await stateStore.update((current) => {
        const pack = current.packs[id];
        pack.active = pack.fallback;
        pack.fallback = null;
        pack.status = "healthy";
        pack.recoveryReason = activeInspection.status;
        pack.lastError = null;
        return current;
      });
      await store.cleanupPack(id, [...versionsInState(updated.packs[id])]).catch(() => {});
      return { state: updated, result: "rolled-back", inspection: activeInspection };
    }

    const updated = await stateStore.update((current) => {
      const pack = current.packs[id];
      pack.active = null;
      pack.fallback = null;
      pack.status = "needs-reinstall";
      pack.recoveryReason = activeInspection.status;
      pack.lastError = activeInspection.status;
      return current;
    });
    await store.cleanupPack(id, []).catch(() => {});
    return { state: updated, result: "needs-reinstall", inspection: activeInspection };
  }

  async function recoverAll() {
    const initial = await stateStore.read();
    const known = new Set(Object.keys(initial.packs));
    for (const packId of await store.listPacks()) {
      if (!known.has(packId) && !operationsByPack.has(packId)) {
        await store.removePack(packId);
      }
    }

    let latest = initial;
    for (const packId of Object.keys(initial.packs)) {
      if (operationsByPack.has(packId)) continue;
      latest = (await recoverPack(packId)).state;
    }
    return publicState(latest);
  }

  async function status({ recover = false } = {}) {
    const state = recover ? await recoverAll() : publicState(await stateStore.read());
    return { state };
  }

  async function requirePermission(source) {
    if (!permissions?.contains) {
      throw packError(PACK_ERROR_CODES.PERMISSION_REQUIRED, "Chrome optional-origin permission API is unavailable.");
    }
    const granted = await permissions.contains({ origins: [source.originPattern] });
    if (!granted) {
      throw packError(PACK_ERROR_CODES.PERMISSION_REQUIRED, "Dictionary pack origin permission has not been granted.", {
        sourceId: source.id,
        originPattern: source.originPattern
      });
    }
  }

  async function preflightQuota(incomingBytes) {
    if (!storageManager?.estimate) {
      throw packError(PACK_ERROR_CODES.QUOTA, "Browser storage quota cannot be estimated.");
    }
    const estimate = await storageManager.estimate();
    const quota = Number(estimate?.quota);
    const usage = Number(estimate?.usage || 0);
    const required = incomingBytes + PACK_LIMITS.safetyMarginBytes;
    if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(usage) || quota - usage < required) {
      throw packError(PACK_ERROR_CODES.QUOTA, "Insufficient browser storage for dictionary pack install/update.", {
        quota,
        usage,
        incomingBytes,
        safetyMarginBytes: PACK_LIMITS.safetyMarginBytes
      });
    }
  }

  const importLocalTflex = createLocalTflexImportTransaction({
    store,
    stateStore,
    cryptoProvider,
    operationsByPack,
    controllersByRequest,
    recoverPack,
    preflightQuota,
    normalizeOperationError: normalizePackOperationError,
    assertActive: assertPackOperationActive
  });

  return Object.freeze({
    install,
    importLocalTflex,
    cancel,
    uninstall,
    rollback,
    recoverPack,
    recoverAll,
    status
  });
}
