import assert from "node:assert/strict";

// Replacing unpacked bytes at the same version does not observe an onInstalled
// update. UI defaults must therefore not authorize any storage mutation.
export function assertUnchangedUpgradeSnapshot(before, after) {
  assert.deepEqual(after, before, "Same-version replacement must preserve the complete stored snapshot");
}

export function expectedStorageAfterInstalledUpdate(before, nativeEvent, previousVersion) {
  assert.equal(nativeEvent?.reason, "update", "A real update event must precede default initialization");
  assert.equal(nativeEvent.previousVersion, previousVersion, "Update event must name the actual old package version");
  return Object.hasOwn(before,"uiLocale") ? before : {...before,uiLocale:"auto"};
}
