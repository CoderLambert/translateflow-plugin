import assert from "node:assert/strict";

export function assertUnchangedUpgradeSnapshot(before, after) {
  assert.deepEqual(after, before, "Same-version replacement must preserve the expected stored snapshot");
}
export function expectedStorageAfterInstalledUpdate(before, nativeEvent, previousVersion) {
  assert.equal(nativeEvent?.reason, "update", "A real update event must precede default initialization");
  assert.equal(nativeEvent.previousVersion, previousVersion, "Update event must name the actual old package version");
  return Object.hasOwn(before, "uiLocale") ? before : { ...before, uiLocale: "zh_CN" };
}
export function expectedRegistrationsAfterInstalledUpdate(before, nativeEvent, previousVersion, oldMapping, newMapping) {
  assert.equal(nativeEvent?.reason, "update"); assert.equal(nativeEvent.previousVersion, previousVersion);
  before.forEach(registration => {
    assert.deepEqual(registration.js, oldMapping.contentScripts, "Seeded old JS closure must be exact");
    assert.deepEqual(registration.css, oldMapping.contentStyles, "Seeded old CSS closure must be exact");
    assert.notDeepEqual(registration.js, newMapping.contentScripts, "Compiled mapping must replace the old raw closure");
  });
  return [];
}

// This legacy WXT fixture does not seed AI explanations. Refuse to discard any
// unexpectedly populated explanation rows; opaque preservation is covered by
// the dedicated native-IDB upgrade contract tests, not by a fake expected row.
export function expectedTranslationCacheDatabases(databases) {
  return databases.map(db => {
    if (db.name !== "ai_bilingual_translator" || ![2, 3].includes(db.version)) return db;
    assert.equal((db.stores.selection_explanations || []).length, 0, "Use native upgrade tests for seeded explanation records");
    return { ...db, version: 4, stores: { entries: [], epochs: [] } };
  });
}
export function assertRecoveredDatabases(before, after, observedAt = Date.now()) {
  function canonical(databases, compareAgainst) {
    return databases.map(db => {
      const stores = Object.fromEntries(Object.entries(db.stores).map(([name, rows]) => {
        const key = name === "entries" ? "key" : name === "translations" ? "cacheKey" : name === "pages" ? "pageKey" : null;
        const prior = compareAgainst?.find(candidate => candidate.name === db.name);
        const normalized = rows.map(row => {
          const copy = structuredClone(row);
          // Historical old-package snapshots are fixture inputs, not runtime legacy readers.
          if (db.name === "ai_bilingual_translator" && [2, 3, 4].includes(db.version) && key) {
            const previous = prior?.stores[name]?.find(candidate => candidate[key] === row[key]);
            if (compareAgainst) {
              assert(previous, "Recovery cannot insert a cache row");
              assert(Number.isSafeInteger(row.lastAccessedAt) && Number.isSafeInteger(previous.lastAccessedAt), "Read metadata must retain a real timestamp");
              assert(row.lastAccessedAt >= previous.lastAccessedAt && row.lastAccessedAt <= observedAt, "Only a bounded forward read timestamp is allowed");
            }
            delete copy.lastAccessedAt;
            // Measured byte length can change when a timestamp gains a digit;
            // don't generally ignore bytes. Native tests assert exact accounting.
          }
          return copy;
        });
        normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        return [name, normalized];
      }));
      return { ...db, stores };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  assert.deepEqual(canonical(after, before), canonical(before), "Recovery must preserve content and epoch fences except valid cache read timestamps");
}
