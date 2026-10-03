import test from "node:test";
import assert from "node:assert/strict";

test("Selection all-sites migration runs once and preserves a later user opt-out", async () => {
  const stored = { selectionAllSites: false };
  globalThis.chrome = { storage: { local: {
    async get(keys) {
      return Object.fromEntries((Array.isArray(keys) ? keys : Object.keys(stored)).map(key => [key, stored[key]]));
    },
    async set(values) { Object.assign(stored, structuredClone(values)); }
  } } };
  const { ensureConfigDefaults } = await import(`../src/background/config.js?defaults=${Math.random()}`);

  const migrated = await ensureConfigDefaults();
  assert.equal(migrated.selectionAllSites, true);
  assert.equal(stored.selectionAccessVersion, 1);

  stored.selectionAllSites = false;
  const retained = await ensureConfigDefaults();
  assert.equal(retained.selectionAllSites, false);
});
