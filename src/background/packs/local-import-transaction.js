import {
  PACK_ERROR_CODES,
  packError
} from "../../shared/pack-manager.js";
import { inspectInstalledPack } from "./health.js";
import {
  LOCAL_IMPORT_SOURCE_ID,
  validateLocalTflexImport
} from "./local-import.js";
import {
  publicPackState,
  versionsInState
} from "./snapshot.js";

export function createLocalTflexImportTransaction({
  store,
  stateStore,
  cryptoProvider,
  operationsByPack,
  controllersByRequest,
  recoverPack,
  preflightQuota,
  normalizeOperationError,
  assertActive,
  requestIdFactory = () => globalThis.crypto.randomUUID()
} = {}) {
  for (const [label, value] of [
    ["store", store],
    ["stateStore", stateStore],
    ["operationsByPack", operationsByPack],
    ["controllersByRequest", controllersByRequest]
  ]) {
    if (!value) throw new Error("local TFLex import transaction requires " + label);
  }
  for (const [label, value] of [
    ["recoverPack", recoverPack],
    ["preflightQuota", preflightQuota],
    ["normalizeOperationError", normalizeOperationError],
    ["assertActive", assertActive],
    ["requestIdFactory", requestIdFactory]
  ]) {
    if (typeof value !== "function") {
      throw new Error("local TFLex import transaction requires " + label);
    }
  }

  return async function importLocalTflex({ files, requestId } = {}) {
    const id = String(requestId || requestIdFactory());
    if (controllersByRequest.has(id)) {
      throw packError(
        PACK_ERROR_CODES.BUSY,
        "Dictionary pack requestId is already in use.",
        { requestId: id }
      );
    }

    const controller = new AbortController();
    controllersByRequest.set(id, controller);
    let packId = "";
    let stagedVersion = "";
    let protectedVersions = new Set();
    let ownsPackOperation = false;

    try {
      const validated = await validateLocalTflexImport({
        files,
        cryptoProvider
      });
      assertActive(controller.signal);

      packId = validated.snapshot.packId;
      if (operationsByPack.has(packId)) {
        throw packError(
          PACK_ERROR_CODES.BUSY,
          "Another dictionary pack operation is already running.",
          { packId }
        );
      }
      operationsByPack.set(packId, id);
      ownsPackOperation = true;

      const recovered = await recoverPack(packId);
      const current = recovered.state.packs[packId] || null;
      protectedVersions = versionsInState(current);

      assertLocalOwnership(current, packId);
      const alreadyImported = await resolveMatchingActive({
        current,
        validated,
        store,
        cryptoProvider
      });
      if (alreadyImported) return alreadyImported;
      assertNoFallbackCollision(current, validated, packId);

      await preflightQuota(validated.totalBytes);
      assertActive(controller.signal);

      stagedVersion = validated.snapshot.packVersion;
      if (!protectedVersions.has(stagedVersion)) {
        await store.removeVersion(packId, stagedVersion);
      }

      for (const file of validated.files) {
        assertActive(controller.signal);
        await store.writeFile(
          packId,
          validated.snapshot.packVersion,
          file.path,
          file.bytes
        );
        assertActive(controller.signal);
      }

      const inspection = await inspectInstalledPack({
        store,
        snapshot: validated.snapshot,
        cryptoProvider
      });
      if (inspection.status !== "healthy") {
        throw packError(
          PACK_ERROR_CODES.CORRUPT,
          "Staged local dictionary failed post-write health check.",
          {
            packId,
            packVersion: validated.snapshot.packVersion,
            inspection
          }
        );
      }
      assertActive(controller.signal);

      const nextState = await stateStore.update((state) => {
        const previous = state.packs[packId] || null;
        const fallback = previous?.active &&
          previous.active.packVersion !== validated.snapshot.packVersion
          ? previous.active
          : previous?.fallback || null;
        state.packs[packId] = {
          sourceId: LOCAL_IMPORT_SOURCE_ID,
          status: "healthy",
          active: validated.snapshot,
          fallback,
          recoveryReason: null,
          lastError: null
        };
        return state;
      });

      const imported = nextState.packs[packId];

      // Pointer commit is final. Cleanup failure is recoverable and must not
      // roll back a healthy active version.
      stagedVersion = "";
      await store.cleanupPack(
        packId,
        [...versionsInState(imported)]
      ).catch(() => {});

      return {
        status: current?.active ? "updated" : "imported",
        pack: publicPackState(imported)
      };
    } catch (error) {
      if (
        packId &&
        stagedVersion &&
        !protectedVersions.has(stagedVersion)
      ) {
        await store.removeVersion(packId, stagedVersion).catch(() => {});
      }
      throw normalizeOperationError(error);
    } finally {
      if (ownsPackOperation && operationsByPack.get(packId) === id) {
        operationsByPack.delete(packId);
      }
      if (controllersByRequest.get(id) === controller) {
        controllersByRequest.delete(id);
      }
    }
  };
}

function assertLocalOwnership(current, packId) {
  if (
    current &&
    current.sourceId &&
    current.sourceId !== LOCAL_IMPORT_SOURCE_ID
  ) {
    throw packError(
      PACK_ERROR_CODES.INCOMPATIBLE,
      "Local import cannot replace a pack owned by another dictionary source.",
      {
        packId,
        sourceId: current.sourceId
      }
    );
  }
}

async function resolveMatchingActive({
  current,
  validated,
  store,
  cryptoProvider
}) {
  if (
    current?.active?.packVersion !== validated.snapshot.packVersion
  ) {
    return null;
  }

  if (current.active.fingerprint !== validated.snapshot.fingerprint) {
    throw packError(
      PACK_ERROR_CODES.INCOMPATIBLE,
      "Local dictionary packVersion conflicts with the installed active fingerprint.",
      {
        packId: validated.snapshot.packId,
        packVersion: validated.snapshot.packVersion
      }
    );
  }

  const inspection = await inspectInstalledPack({
    store,
    snapshot: current.active,
    cryptoProvider
  });
  if (inspection.status !== "healthy") {
    throw packError(
      PACK_ERROR_CODES.NEEDS_REINSTALL,
      "Matching local dictionary version is not healthy and cannot be overwritten in place.",
      {
        packId: validated.snapshot.packId,
        inspection
      }
    );
  }
  return {
    status: "already-imported",
    pack: publicPackState(current)
  };
}

function assertNoFallbackCollision(current, validated, packId) {
  if (
    current?.fallback?.packVersion !== validated.snapshot.packVersion
  ) {
    return;
  }
  throw packError(
    PACK_ERROR_CODES.INCOMPATIBLE,
    "Local dictionary packVersion is currently protected as the rollback version.",
    {
      packId,
      packVersion: validated.snapshot.packVersion
    }
  );
}
