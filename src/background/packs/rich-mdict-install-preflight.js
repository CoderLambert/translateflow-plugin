import {
  RICH_MDICT_MAX_SOURCE_BYTES,
  normalizePackId,
  normalizeRequestId,
  normalizeVersion,
  richError
} from "./rich-mdict-contract.js";
import {
  assertCatalogReplacementTarget,
  assertCatalogReplacementVersions,
  validateCatalogReplacement
} from "./rich-mdict-catalog-replacement.js";

export function createRichMdictInstallPreflight({
  store,
  stateStore,
  storageManager,
  serialize
} = {}) {
  return async function preflightQuota(sourceBytes, identity = null) {
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
    if (!identity) return;

    const requestId = normalizeRequestId(identity.requestId);
    const packId = normalizePackId(identity.packId);
    const packVersion = normalizeVersion(identity.packVersion);
    const catalogReplacement = validateCatalogReplacement(
      identity.catalogReplacement,
      packId,
      identity.catalogReplacement
        ? { recipeId: identity.catalogReplacement.recipeId }
        : null
    );
    await serialize(packId, async () => {
      const existingVersions = await store.listVersions(packId);
      await stateStore.update((current) => {
        const existing = current.packs[packId];
        assertCatalogReplacementTarget(existing, catalogReplacement, packVersion);
        const collision = Object.entries(current.reservations || {}).some(([otherId, reservation]) =>
          reservation?.packId === packId
        );
        assertCatalogReplacementVersions({
          entry: existing,
          versions: existingVersions,
          packVersion,
          replacement: catalogReplacement,
          hasReservation: collision || Boolean(current.reservations?.[requestId])
        });
        current.reservations ||= {};
        current.reservations[requestId] = {
          packId,
          packVersion,
          ...(catalogReplacement ? { catalogReplacement } : {}),
          createdAt: Date.now()
        };
        return current;
      });
    });
  };
}
