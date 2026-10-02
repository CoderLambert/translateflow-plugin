import assert from "node:assert/strict";

// Replacing unpacked bytes at the same version does not observe an onInstalled
// update. UI defaults must therefore not authorize any storage mutation.
export function assertUnchangedUpgradeSnapshot(before, after) {
  assert.deepEqual(after, before, "Same-version replacement must preserve the complete stored snapshot");
}
