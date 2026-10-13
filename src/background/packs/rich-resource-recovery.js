import { normalizePackId, normalizeRequestId } from "./rich-mdict-contract.js";
import { RICH_MDD_MAX_SOURCE_BYTES, safeFileName, validateMddCompanions } from "./rich-mdd-contract.js";
import { normalizeSidecarPreflightFiles } from "./rich-mdd-resource-utils.js";
import { isRichMddPackageWithinBudget } from "./rich-mdd-package-budget.js";
import { normalizeVersion, isValidSnapshot, RICH_MDICT_SOURCE_ID, richError } from "./rich-mdict-contract.js";
import { getRichResourceBrowserSession } from "./rich-resource-session.js";
const CODES = new Set(["pending", "interrupted", "failed", "cancelled"]);
export function normalizeResourceRecovery(value, expectedVersion) {
  if (!value || typeof value !== "object" || Object.keys(value).some(key => !["expectedMdxVersion", "mddCount", "sidecarCount", "errorCode"].includes(key))) return null;
  try { if (normalizeVersion(value.expectedMdxVersion) !== expectedVersion) return null; } catch { return null; }
  if (!Number.isInteger(value.mddCount) || value.mddCount < 1 || value.mddCount > 16 ||
      !Number.isInteger(value.sidecarCount) || value.sidecarCount < 0 || value.sidecarCount > 32 || !CODES.has(value.errorCode)) return null;
  return { expectedMdxVersion: expectedVersion, mddCount: value.mddCount, sidecarCount: value.sidecarCount, errorCode: value.errorCode };
}
export function makeResourceRecovery(intent, version) {
  if (intent === undefined || intent === null) return null;
  const value = normalizeResourceRecovery({ ...intent, expectedMdxVersion: version, errorCode: "pending" }, version);
  if (!value || Object.keys(intent).some(key => !["mddCount", "sidecarCount"].includes(key))) throw richError("RICH_MDD_INPUT", "Attachment intent is malformed.");
  return value;
}
// Caller holds the existing per-pack queue. Only stale reservations' unreferenced versions may be removed.
export function createRichResourceRecovery({ store, stateStore, getSessionToken = getRichResourceBrowserSession }) {
  async function clean(packId) {
    const state = await stateStore.read();
    const reservations = Object.entries(state.resourceReservations || {}).filter(([, item]) => item?.packId === packId);
    if (!reservations.length) return;
    const token = await getSessionToken();
    for (const [id, item] of reservations) {
      if (item.browserSessionToken === token) continue;
      let version;
      try { version = normalizeVersion(item.resourceVersion); } catch { version = null; }
      const entry = state.packs?.[packId];
      const referenced = [entry?.active, entry?.fallback].some(snapshot => snapshot?.packVersion === version || snapshot?.resources?.packVersion === version) ||
        Object.values(state.reservations || {}).some(reservation => reservation?.packId === packId && reservation?.packVersion === version) ||
        reservations.some(([otherId, other]) => otherId !== id && other.browserSessionToken === token && other.resourceVersion === version);
      if (version && !referenced) await store.removeVersion(packId, version);
      await stateStore.update(current => {
        const reservation = current.resourceReservations?.[id];
        if (reservation?.packId !== packId || reservation.resourceVersion !== item.resourceVersion || reservation.browserSessionToken === token) return current;
        const active = current.packs?.[packId]?.active;
        const recovery = normalizeResourceRecovery(active?.resourceRecovery, active?.packVersion);
        if (recovery && (!item.expectedMdxVersion || item.expectedMdxVersion === active.packVersion)) active.resourceRecovery = { ...recovery, errorCode: "interrupted" };
        delete current.resourceReservations[id];
        return current;
      });
    }
  }
  function assertReservation(reservation, { packId, version, token, expectedMdxVersion }, active) {
    if (reservation?.packId !== packId || reservation.resourceVersion !== version || reservation.browserSessionToken !== token ||
        reservation.expectedMdxVersion !== active?.packVersion || (expectedMdxVersion && active?.packVersion !== expectedMdxVersion)) {
      throw richError("RICH_MDD_RESERVATION", "Resource attachment identity changed. Reselect the complete resource set.");
    }
  }
  function assertActive(entry, expectedMdxVersion, mdxFileName, mdxSourceBytes) {
    if (entry?.sourceId !== RICH_MDICT_SOURCE_ID || !isValidSnapshot(entry.active?.packId, entry.active) ||
        (expectedMdxVersion && entry.active.packVersion !== expectedMdxVersion) ||
        (mdxFileName !== undefined && entry.active.fileName !== mdxFileName) ||
        (mdxSourceBytes !== undefined && entry.active.sourceSize !== mdxSourceBytes)) {
      throw richError("RICH_MDD_DICTIONARY", "The installed MDX changed. Reselect its complete resource set.");
    }
  }
  return Object.freeze({ clean, assertReservation, assertActive, getSessionToken });
}

export function createRichMddPreflight({ store, stateStore, storageManager, serialize, recovery }) {
  async function preflight({ dictionaryId, requestId, resourceVersion, mdxFileName, files, sidecars: sidecarInput = [], expectedMdxVersion, mdxSourceBytes } = {}) {
    const packId = normalizePackId(dictionaryId);
    const id = normalizeRequestId(requestId);
    const version = normalizeVersion(resourceVersion);
    if (expectedMdxVersion !== undefined) expectedMdxVersion = normalizeVersion(expectedMdxVersion);
    if (mdxSourceBytes !== undefined && (!Number.isSafeInteger(mdxSourceBytes) || mdxSourceBytes <= 0)) throw richError("RICH_MDD_INPUT", "MDX size is invalid.");
    const ordered = validateMddCompanions((Array.isArray(files) ? files : []).map((file) => file?.fileName), mdxFileName);
    const sizeByName = new Map((Array.isArray(files) ? files : []).map((file) => [safeFileName(file?.fileName), Number(file?.size)]));
    let totalBytes = 0;
    for (const item of ordered) {
      const size = sizeByName.get(item.fileName);
      if (!Number.isSafeInteger(size) || size <= 0 || size > RICH_MDD_MAX_SOURCE_BYTES) {
        throw richError("RICH_MDD_LIMIT", "An MDD file exceeds the 4,000,000,000-byte safety limit.");
      }
      totalBytes += size;
    }
    const sidecars = normalizeSidecarPreflightFiles(sidecarInput);
    const sidecarBytes = sidecars.reduce((sum, item) => sum + item.size, 0);
    if (!isRichMddPackageWithinBudget(0, totalBytes + sidecarBytes)) {
      throw richError("RICH_MDD_LIMIT", "MDD sources and sidecars exceed the 4,000,000,000-byte package safety limit.");
    }
    return serialize(packId, async () => {
      await recovery.clean(packId);
      const token = await recovery.getSessionToken();
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
        recovery.assertActive(entry, expectedMdxVersion, mdxFileName, mdxSourceBytes);
        const installedMdxBytes = Number(entry.active.sourceSize);
        if (installedMdxBytes <= 0 || !isRichMddPackageWithinBudget(installedMdxBytes, totalBytes + sidecarBytes)) {
          throw richError("RICH_MDD_LIMIT", "MDX, MDD sources, and sidecars exceed the 4,000,000,000-byte package safety limit.");
        }
        if (current.resourceReservations?.[id]) throw richError("RICH_MDD_BUSY", "MDD resource request ID is already reserved.");
        const duplicate = Object.values(current.resourceReservations || {}).some((reservation) => reservation?.packId === packId);
        if (duplicate) throw richError("RICH_MDD_BUSY", "Another MDD resource import is already active for this dictionary.");
        current.resourceReservations ||= {};
        current.resourceReservations[id] = { packId, resourceVersion: version, browserSessionToken: token, expectedMdxVersion: entry.active.packVersion, createdAt: Date.now() };
        entry.active.resourceRecovery = { expectedMdxVersion: entry.active.packVersion, mddCount: ordered.length, sidecarCount: sidecars.length, errorCode: "pending" };
        return current;
      });
      try {
        if (storageManager?.estimate) {
          const estimate = await storageManager.estimate();
          const quota = Number(estimate?.quota);
          const usage = Number(estimate?.usage);
          if (Number.isFinite(quota) && Number.isFinite(usage) && Math.max(0, quota - usage) < totalBytes + sidecarBytes + 32 * 1024 * 1024) {
            throw richError("RICH_MDD_QUOTA", "There is not enough browser storage for these MDD resources.");
          }
        }
      } catch (error) {
        await stateStore.update(current => {
          const reservation = current.resourceReservations?.[id];
          if (reservation?.packId === packId && reservation.resourceVersion === version && reservation.browserSessionToken === token) {
            const active = current.packs?.[packId]?.active;
            if (active?.packVersion === reservation.expectedMdxVersion && active.resourceRecovery) active.resourceRecovery.errorCode = "failed";
            delete current.resourceReservations[id];
          }
          return current;
        });
        throw error;
      }
      return { ready: true, totalBytes: totalBytes + sidecarBytes, fileCount: ordered.length + sidecars.length };
    });
  }

  return preflight;
}
