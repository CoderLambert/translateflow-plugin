import {
  PACK_ERROR_CODES,
  packError
} from "../../shared/pack-manager.js";
import {
  publicLocalImportDisplayMetadata
} from "./local-import-display.js";

export function enforceNoAutomaticDowngrade(active, candidate) {
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

export function snapshotFromPack(pack, sourceId, catalogSequence) {
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

export function versionsInState(entry) {
  return new Set(
    [entry?.active?.packVersion, entry?.fallback?.packVersion]
      .filter(Boolean)
      .map(String)
  );
}

export function publicState(state) {
  return {
    version: state.version,
    catalogSequences: { ...state.catalogSequences },
    packs: Object.fromEntries(
      Object.entries(state.packs).map(([packId, entry]) => [packId, publicPackState(entry)])
    )
  };
}

export function publicPackState(entry) {
  if (!entry) return null;
  return {
    sourceId: entry.sourceId || "",
    status: entry.status || "unknown",
    active: publicSnapshot(entry.active),
    fallback: publicSnapshot(entry.fallback),
    display: publicLocalImportDisplayMetadata(entry.display),
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
