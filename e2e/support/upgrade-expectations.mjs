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

// Compiled Content is statically registered by the Manifest. A native update
// must remove the seeded legacy dynamic registration instead of retaining a
// second Content product.
export function expectedRegistrationsAfterInstalledUpdate(before, nativeEvent, previousVersion, oldMapping, newMapping) {
  assert.equal(nativeEvent?.reason, "update");
  assert.equal(nativeEvent.previousVersion, previousVersion);
  before.forEach(registration => {
    assert.deepEqual(registration.js, oldMapping.contentScripts, "Seeded old JS closure must be exact");
    assert.deepEqual(registration.css, oldMapping.contentStyles, "Seeded old CSS closure must be exact");
    assert.notDeepEqual(registration.js, newMapping.contentScripts, "Compiled mapping must replace the old raw closure");
  });
  return [];
}

export function assertRecoveredDatabases(before, after, observedAt = Date.now()) {
  function canonical(databases, compareAgainst) {
    return databases.map(db => {
      const stores = Object.fromEntries(Object.entries(db.stores).map(([name, rows]) => {
        const key = name === "translations" ? "cacheKey" : name === "pages" ? "pageKey" : null;
        const prior = compareAgainst?.find(candidate => candidate.name === db.name);
        const normalized = rows.map(row => {
          const copy = structuredClone(row);
          if (db.name === "ai_bilingual_translator" && db.version === 2 && key) {
            const previous = prior?.stores[name]?.find(candidate => candidate[key] === row[key]);
            if (compareAgainst) {
              assert(previous, "Recovery cannot insert a cache row");
              assert(Number.isSafeInteger(row.lastAccessedAt) && Number.isSafeInteger(previous.lastAccessedAt),
                "Read metadata must retain a real timestamp");
              assert(row.lastAccessedAt >= previous.lastAccessedAt && row.lastAccessedAt <= observedAt,
                "Only a bounded forward read timestamp is allowed");
            }
            delete copy.lastAccessedAt;
          }
          return copy;
        });
        normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        return [name, normalized];
      }));
      return { ...db, stores };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  assert.deepEqual(canonical(after, before), canonical(before),
    "Recovery must preserve all DB names, versions, stores, rows and fields except valid cache read metadata");
}
