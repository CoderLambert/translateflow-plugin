import {
  richError,
  validateCuratedRichMdictReplacement
} from "./rich-mdict-contract.js";

export function validateCatalogReplacement(value, packId, curated) {
  return validateCuratedRichMdictReplacement(value, packId, curated);
}

export function assertCatalogReplacementTarget(entry, replacement, nextPackVersion) {
  if (!entry) {
    if (replacement?.expectedActiveVersion) {
      throw richError("RICH_MDICT_REPLACEMENT_CONFLICT", "The installed curated dictionary changed before replacement.");
    }
    return;
  }
  if (!replacement || entry.sourceId !== "local-rich-mdict") {
    throw richError("RICH_MDICT_EXISTS", "This rich dictionary identifier is already installed.");
  }
  const active = entry.active;
  if (
    active?.curated?.recipeId !== replacement.recipeId ||
    active?.packVersion !== replacement.expectedActiveVersion ||
    active?.packVersion === nextPackVersion
  ) {
    throw richError("RICH_MDICT_REPLACEMENT_CONFLICT", "Only the same declared curated dictionary can replace this installed version.");
  }
}

export function assertCatalogReplacementVersions({
  entry,
  versions,
  packVersion,
  replacement,
  hasReservation
}) {
  const activeVersion = String(entry?.active?.packVersion || "");
  const resourceVersion = String(entry?.active?.resources?.packVersion || "");
  const hasUnrelatedVersion = replacement && entry
    ? versions.some((version) => version !== activeVersion && version !== resourceVersion)
    : Boolean(replacement && !entry && versions.length);
  if (
    hasReservation ||
    versions.includes(packVersion) ||
    hasUnrelatedVersion ||
    (!replacement && versions.length > 0)
  ) {
    throw richError("RICH_MDICT_EXISTS", "This rich dictionary identifier is already in use.");
  }
}

export function retainCatalogResources(previousSnapshot, snapshot, replacement) {
  if (
    replacement &&
    previousSnapshot?.resources &&
    previousSnapshot.curated?.mdxSha256 === snapshot.curated?.mdxSha256 &&
    previousSnapshot.resources.mdxFileName === snapshot.fileName
  ) {
    snapshot.resources = previousSnapshot.resources;
  }
  return snapshot.resources?.packVersion || "";
}

export async function cleanupCatalogVersions({
  store,
  indexCache,
  packId,
  activeVersion,
  retainedResourceVersion
}) {
  const versions = await store.listVersions(packId).catch(() => []);
  for (const version of versions) {
    if (version === activeVersion || version === retainedResourceVersion) continue;
    const prefix = `${packId}@${version}@`;
    for (const key of indexCache.keys()) {
      if (key.startsWith(prefix)) indexCache.delete(key);
    }
    await store.removeVersion(packId, version).catch(() => {});
  }
}

export function sameCatalogReplacement(left, right) {
  return String(left?.recipeId || "") === String(right?.recipeId || "") &&
    String(left?.expectedActiveVersion || "") === String(right?.expectedActiveVersion || "");
}
