import {
  PACK_ERROR_CODES,
  packError
} from "../../shared/pack-manager.js";
import {
  assertImportQuarantineToken
} from "../../shared/import-quarantine-contract.js";
import { inspectInstalledPack } from "./health.js";
import {
  LOCAL_IMPORT_SOURCE_ID,
  validateLocalTflexImport
} from "./local-import.js";
import {
  readImportQuarantineSnapshot
} from "./quarantine-import-loader.js";
import {
  publicPackState,
  versionsInState
} from "./snapshot.js";
import {
  normalizeLocalImportDisplayMetadata
} from "./local-import-display.js";

export function createLocalTflexImportTransaction({
  store,
  quarantine,
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
    ["quarantine", quarantine],
    ["stateStore", stateStore],
    ["operationsByPack", operationsByPack],
    ["controllersByRequest", controllersByRequest]
  ]) {
    if (!value) {
      throw new Error(
        "local TFLex import transaction requires " + label
      );
    }
  }
  for (const [label, value] of [
    ["recoverPack", recoverPack],
    ["preflightQuota", preflightQuota],
    ["normalizeOperationError", normalizeOperationError],
    ["assertActive", assertActive],
    ["requestIdFactory", requestIdFactory]
  ]) {
    if (typeof value !== "function") {
      throw new Error(
        "local TFLex import transaction requires " + label
      );
    }
  }

  const operationsByToken = new Map();

  async function importLocalTflex({
    files,
    requestId,
    displayMetadata
  } = {}) {
    return runImport({
      requestId,
      displayMetadata,
      prepareValidated: async (signal) => {
        assertActive(signal);
        const validated =
          await validateLocalTflexImport({
            files,
            cryptoProvider
          });
        assertActive(signal);
        return validated;
      }
    });
  }

  async function importLocalTflexFromQuarantine({
    token,
    requestId,
    displayMetadata
  } = {}) {
    assertImportQuarantineToken(token);
    return runImport({
      requestId,
      quarantineToken: token,
      displayMetadata,
      prepareValidated: async (signal) => {
        const snapshot =
          await readImportQuarantineSnapshot({
            quarantine,
            token,
            signal,
            assertActive
          });
        assertActive(signal);
        const validated =
          await validateLocalTflexImport({
            files: snapshot.files,
            cryptoProvider
          });
        assertActive(signal);
        return validated;
      }
    });
  }

  async function runImport({
    requestId,
    prepareValidated,
    quarantineToken = "",
    displayMetadata
  }) {
    const display =
      normalizeLocalImportDisplayMetadata(
        displayMetadata
      );
    const id = String(
      requestId || requestIdFactory()
    );
    if (controllersByRequest.has(id)) {
      throw packError(
        PACK_ERROR_CODES.BUSY,
        "Dictionary pack requestId is already in use.",
        { requestId: id }
      );
    }
    if (
      quarantineToken &&
      operationsByToken.has(quarantineToken)
    ) {
      throw packError(
        PACK_ERROR_CODES.BUSY,
        "Import quarantine token is already in use.",
        { token: quarantineToken }
      );
    }

    const controller = new AbortController();
    controllersByRequest.set(id, controller);
    if (quarantineToken) {
      operationsByToken.set(quarantineToken, id);
    }

    let packId = "";
    let stagedVersion = "";
    let protectedVersions = new Set();
    let ownsPackOperation = false;

    try {
      const validated =
        await prepareValidated(controller.signal);
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
      const current =
        recovered.state.packs[packId] || null;
      protectedVersions =
        versionsInState(current);

      assertLocalOwnership(current, packId);
      const alreadyImported =
        await resolveMatchingActive({
          current,
          validated,
          store,
          cryptoProvider
        });
      if (alreadyImported) {
        return alreadyImported;
      }
      assertNoFallbackCollision(
        current,
        validated,
        packId
      );

      await preflightQuota(validated.totalBytes);
      assertActive(controller.signal);

      stagedVersion =
        validated.snapshot.packVersion;
      if (!protectedVersions.has(stagedVersion)) {
        await store.removeVersion(
          packId,
          stagedVersion
        );
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

      const inspection =
        await inspectInstalledPack({
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
            packVersion:
              validated.snapshot.packVersion,
            inspection
          }
        );
      }
      assertActive(controller.signal);

      // Pointer commit is the cancellation boundary.
      if (controllersByRequest.get(id) === controller) controllersByRequest.delete(id);

      const nextState =
        await stateStore.update((state) => {
          const previous =
            state.packs[packId] || null;
          const fallback =
            previous?.active &&
            previous.active.packVersion !==
              validated.snapshot.packVersion
              ? previous.active
              : previous?.fallback || null;
          state.packs[packId] = {
            sourceId: LOCAL_IMPORT_SOURCE_ID,
            status: "healthy",
            active: validated.snapshot,
            fallback,
            display: display || previous?.display || null,
            recoveryReason: null,
            lastError: null
          };
          return state;
        });

      const imported = nextState.packs[packId];

      // Pointer commit is final. Cleanup failure is
      // recoverable and must not roll back a healthy version.
      stagedVersion = "";
      await store.cleanupPack(
        packId,
        [...versionsInState(imported)]
      ).catch(() => {});

      return {
        status: current?.active
          ? "updated"
          : "imported",
        pack: publicPackState(imported)
      };
    } catch (error) {
      if (
        packId &&
        stagedVersion &&
        !protectedVersions.has(stagedVersion)
      ) {
        await store.removeVersion(
          packId,
          stagedVersion
        ).catch(() => {});
      }
      throw normalizeOperationError(error);
    } finally {
      if (
        ownsPackOperation &&
        operationsByPack.get(packId) === id
      ) {
        operationsByPack.delete(packId);
      }
      if (
        controllersByRequest.get(id) ===
        controller
      ) {
        controllersByRequest.delete(id);
      }
      if (
        quarantineToken &&
        operationsByToken.get(
          quarantineToken
        ) === id
      ) {
        operationsByToken.delete(
          quarantineToken
        );
        await quarantine.remove(
          quarantineToken
        ).catch(() => {});
      }
    }
  }

  return Object.freeze({
    importLocalTflex,
    importLocalTflexFromQuarantine
  });
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
    current?.active?.packVersion !==
    validated.snapshot.packVersion
  ) {
    return null;
  }

  if (
    current.active.fingerprint !==
    validated.snapshot.fingerprint
  ) {
    throw packError(
      PACK_ERROR_CODES.INCOMPATIBLE,
      "Local dictionary packVersion conflicts with the installed active fingerprint.",
      {
        packId: validated.snapshot.packId,
        packVersion:
          validated.snapshot.packVersion
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

function assertNoFallbackCollision(
  current,
  validated,
  packId
) {
  if (
    current?.fallback?.packVersion !==
    validated.snapshot.packVersion
  ) {
    return;
  }
  throw packError(
    PACK_ERROR_CODES.INCOMPATIBLE,
    "Local dictionary packVersion is currently protected as the rollback version.",
    {
      packId,
      packVersion:
        validated.snapshot.packVersion
    }
  );
}
