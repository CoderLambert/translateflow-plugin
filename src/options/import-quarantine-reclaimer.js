import {
  createOpfsImportQuarantine
} from "../shared/opfs-import-quarantine.js";
import {
  withAvailableImportQuarantineLock
} from "../shared/import-quarantine-lock.js";

export const IMPORT_QUARANTINE_STALE_MS =
  24 * 60 * 60 * 1000;

export async function reclaimStaleImportQuarantine({
  quarantine = createOpfsImportQuarantine(),
  lockManager = globalThis.navigator?.locks,
  now = () => Date.now(),
  staleMs = IMPORT_QUARANTINE_STALE_MS
} = {}) {
  if (
    typeof now !== "function" ||
    !Number.isSafeInteger(staleMs) ||
    staleMs <= 0
  ) {
    throw new Error(
      "Import quarantine reclaim configuration is invalid."
    );
  }

  const tokens = await quarantine.listTokens();
  if (!lockManager?.request) {
    return {
      supported: false,
      removed: [],
      active: [],
      fresh: [],
      skipped: [...tokens]
    };
  }

  const result = {
    supported: true,
    removed: [],
    active: [],
    fresh: [],
    skipped: []
  };

  for (const token of tokens) {
    const activity =
      await quarantine.inspectTokenActivity(token);
    if (!activity) continue;
    if (!isReclaimCandidate(
      activity,
      now(),
      staleMs
    )) {
      result.fresh.push(token);
      continue;
    }

    const locked =
      await withAvailableImportQuarantineLock(
        token,
        async () => {
          const current =
            await quarantine.inspectTokenActivity(token);
          if (!current) {
            return { status: "missing" };
          }
          if (!isReclaimCandidate(
            current,
            now(),
            staleMs
          )) {
            return { status: "fresh" };
          }
          const removed =
            await quarantine.remove(token);
          return {
            status: removed
              ? "removed"
              : "missing"
          };
        },
        { lockManager }
      );

    if (!locked.acquired) {
      result.active.push(token);
      continue;
    }

    if (locked.value?.status === "removed") {
      result.removed.push(token);
    } else if (locked.value?.status === "fresh") {
      result.fresh.push(token);
    }
  }

  for (const key of [
    "removed",
    "active",
    "fresh",
    "skipped"
  ]) {
    result[key].sort(compareText);
  }
  return result;
}

function isReclaimCandidate(
  activity,
  currentTime,
  staleMs
) {
  if (!activity) return false;
  if (
    activity.entryCount === 0 ||
    activity.fileCount === 0
  ) {
    return true;
  }

  const modified = Number(activity.lastModified);
  if (
    !Number.isFinite(modified) ||
    modified <= 0 ||
    modified > currentTime
  ) {
    return false;
  }
  return currentTime - modified >= staleMs;
}

function compareText(left, right) {
  return String(left).localeCompare(
    String(right),
    "en"
  );
}
