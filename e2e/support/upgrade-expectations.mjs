import assert from "node:assert/strict";
import { byteLength, opaqueCacheIdentity } from "../../src/shared/cache/identity.js";

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

// Validate every opaque value and all deterministic envelope fields. Only the
// random write ID comes from the observed upgrade, and must be a UUID.
export function expectedTranslationCacheDatabases(databases, observed = []) {
  return databases.map(db => {
    if (db.name !== "ai_bilingual_translator" || ![2, 3].includes(db.version)) return db;
    const rows = db.stores.selection_explanations || [];
    const entries = observed.find(next => next.name === db.name)?.stores.entries || [];
    assert.equal(entries.length, rows.length, "Every old explanation must migrate exactly once");
    const expected = rows.map(old => {
      const identity = opaqueCacheIdentity("selection-explanation", old.cacheKey);
      const actual = entries.find(entry => entry.key === identity.key);
      assert(actual, "Explanation identity must be retained");
      assert.match(actual.writeId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u);
      const record = { recordVersion:1, ...identity, value:old.result, metadata:{},
        createdAt:old.createdAt, updatedAt:old.createdAt, lastAccessedAt:old.lastAccessedAt,
        expiresAt:0, writeId:actual.writeId, bytes:actual.bytes };
      assert.equal(actual.bytes, byteLength(record), "Migrated bytes must be exact");
      assert.deepEqual(actual, record, "Opaque result and timestamps must survive intact");
      return record;
    });
    return { ...db, version:4, stores:{entries:expected,epochs:[]} };
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
