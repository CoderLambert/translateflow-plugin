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
import { createPackStateStore } from "./state.js";
import {
  inspectInstalledPack,
  validateInstalledManifest,
  verifyDownloadedFile
} from "./health.js";
import {
  fetchTrustedPackCatalog,
  fetchTrustedPackFile
} from "../providers/pack-network.js";

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
      assertActive(controller.signal);

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

      await preflightQuota(pack.totalBytes);
      stagedVersion = pack.packVersion;
      if (!protectedVersions.has(stagedVersion)) {
        await store.removeVersion(packId, stagedVersion);
      }

      for (const descriptor of pack.files) {
        assertActive(controller.signal);
        const bytes = await network.fetchFile(source, descriptor, { signal: controller.signal });
        assertActive(controller.signal);
        await verifyDownloadedFile(descriptor, bytes, cryptoProvider);
        await store.writeFile(packId, pack.packVersion, descriptor.path, bytes);
      }

      const snapshot = snapshotFromPack(pack, source.id, catalog.sequence);
      await validateInstalledManifest({ store, snapshot });

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
      await store.cleanupPack(packId, [...versionsInState(installed)]);
      return {
        status: current?.active ? "updated" : "installed",
        pack: publicPackState(installed),
        catalogSequence: catalog.sequence
      };
    } catch (error) {
      if (stagedVersion && !protectedVersions.has(stagedVersion)) {
        await store.removeVersion(packId, stagedVersion).catch(() => {});
      }
      throw normalizeOperationError(error);
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
    await store.removePack(id);
    const state = await stateStore.update((current) => {
      delete current.packs[id];
      return current;
    });
    return { uninstalled: true, state: publicState(state) };
  }

  async function rollback(packId) {
    const id = String(packId || "");
    if (operationsByPack.has(id)) {
      throw packError(PACK_ERROR_CODES.BUSY, "Dictionary pack is busy.", { packId: id });
    }
    const current = await stateStore.read();
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
    let latest = initial;
    for (const packId of Object.keys(initial.packs)) {
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

  return Object.freeze({
    install,
    cancel,
    uninstall,
    rollback,
    recoverPack,
    recoverAll,
    status
  });
}

let defaultManager;

export function getDictionaryPackManager() {
  if (!defaultManager) defaultManager = createDictionaryPackManager();
  return defaultManager;
}

export function installDictionaryPack(input) {
  return getDictionaryPackManager().install(input);
}

export function cancelDictionaryPackOperation(requestId) {
  return getDictionaryPackManager().cancel(requestId);
}

export function uninstallDictionaryPack(packId) {
  return getDictionaryPackManager().uninstall(packId);
}

export function rollbackDictionaryPack(packId) {
  return getDictionaryPackManager().rollback(packId);
}

export function recoverDictionaryPacks() {
  return getDictionaryPackManager().recoverAll();
}

export function getDictionaryPackStatus(options) {
  return getDictionaryPackManager().status(options);
}

function enforceNoAutomaticDowngrade(active, candidate) {
  if (!active) return;
  if (candidate.releaseSequence < active.releaseSequence) {
    throw packError(PACK_ERROR_CODES.DOWNGRADE, "Automatic dictionary pack downgrade was rejected.", {
      activeReleaseSequence: active.releaseSequence,
      candidateReleaseSequence: candidate.releaseSequence
    });
  }
  if (
    candidate.releaseSequence === active.releaseSequence &&
    candidate.packVersion !== active.packVersion
  ) {
    throw packError(PACK_ERROR_CODES.CATALOG_SCHEMA, "A dictionary release sequence cannot identify two versions.");
  }
}

function snapshotFromPack(pack, sourceId, catalogSequence) {
  return {
    packId: pack.packId,
    packVersion: pack.packVersion,
    releaseSequence: pack.releaseSequence,
    sourceId,
    catalogSequence,
    fingerprint: pack.fingerprint,
    totalBytes: pack.totalBytes,
    files: pack.files.map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 })),
    verifiedAt: Date.now()
  };
}

function versionsInState(entry) {
  return new Set(
    [entry?.active?.packVersion, entry?.fallback?.packVersion]
      .filter(Boolean)
      .map(String)
  );
}

function publicState(state) {
  return {
    version: state.version,
    catalogSequences: { ...state.catalogSequences },
    packs: Object.fromEntries(
      Object.entries(state.packs).map(([packId, entry]) => [packId, publicPackState(entry)])
    )
  };
}

function publicPackState(entry) {
  if (!entry) return null;
  return {
    sourceId: entry.sourceId || "",
    status: entry.status || "unknown",
    active: publicSnapshot(entry.active),
    fallback: publicSnapshot(entry.fallback),
    recoveryReason: entry.recoveryReason || null,
    lastError: entry.lastError || null
  };
}

function publicSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    packId: snapshot.packId,
    packVersion: snapshot.packVersion,
    releaseSequence: snapshot.releaseSequence,
    fingerprint: snapshot.fingerprint,
    totalBytes: snapshot.totalBytes,
    verifiedAt: snapshot.verifiedAt
  };
}

function assertActive(signal) {
  if (!signal?.aborted) return;
  const error = new DOMException("Dictionary pack operation cancelled.", "AbortError");
  throw error;
}

function normalizeOperationError(error) {
  if (error?.code && String(error.code).startsWith("PACK_")) return error;
  if (error?.name === "AbortError") {
    return packError(PACK_ERROR_CODES.CANCELLED, "Dictionary pack operation was cancelled.");
  }
  return packError(PACK_ERROR_CODES.STORAGE, error?.message || "Dictionary pack operation failed.", { cause: error });
}
