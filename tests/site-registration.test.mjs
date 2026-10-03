import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function createChromeMock({ permitted = false } = {}) {
  const storage = {
    cacheRestoreSites: [],
    autoSites: [],
    quickControlSites: [],
    quickControlHiddenSites: [],
    readingMemorySites: []
  };
  const registered = new Map();
  let permissionGranted = permitted;

  return {
    storage,
    registered,
    setPermission(value) {
      permissionGranted = Boolean(value);
    },
    chrome: {
      permissions: {
        async contains() {
          return permissionGranted;
        }
      },
      storage: {
        local: {
          async get(keys) {
            const result = {};
            for (const key of keys) result[key] = storage[key];
            return result;
          },
          async set(values) {
            Object.assign(storage, structuredClone(values));
          }
        }
      },
      scripting: {
        async getRegisteredContentScripts({ ids } = {}) {
          if (ids) return ids.map((id) => registered.get(id)).filter(Boolean);
          return [...registered.values()];
        },
        async unregisterContentScripts({ ids }) {
          for (const id of ids) registered.delete(id);
        },
        async registerContentScripts(items) {
          for (const item of items) registered.set(item.id, structuredClone(item));
        }
      }
    }
  };
}

async function loadCoordinator(mock) {
  globalThis.chrome = mock.chrome;
  return import(`../src/background/auto-sites.js?test=${Math.random()}`);
}

test("cache restore refuses registration without an explicit Origin permission", async () => {
  const mock = createChromeMock({ permitted: false });
  const coordinator = await loadCoordinator(mock);

  await assert.rejects(
    () => coordinator.registerCacheRestoreSite("https://example.com"),
    /自动恢复缓存权限/
  );
  assert.deepEqual(mock.storage.cacheRestoreSites, []);
  assert.equal(mock.registered.size, 0);
});

test("persistent Quick Control refuses registration without an explicit Origin permission", async () => {
  const mock = createChromeMock({ permitted: false });
  const coordinator = await loadCoordinator(mock);

  await assert.rejects(
    () => coordinator.registerQuickControlSite("https://example.com"),
    /Quick Control 权限/
  );
  assert.deepEqual(mock.storage.quickControlSites, []);
  assert.equal(mock.registered.size, 0);
});

test("cache restore, auto translation and Quick Control reuse the statically injected runtime", async () => {
  const mock = createChromeMock({ permitted: true });
  const coordinator = await loadCoordinator(mock);

  await coordinator.registerCacheRestoreSite("https://example.com/docs");
  assert.deepEqual(mock.storage.cacheRestoreSites, ["https://example.com"]);
  assert.equal(mock.registered.size, 0);

  await coordinator.registerQuickControlSite("https://example.com/docs");
  assert.deepEqual(mock.storage.quickControlSites, ["https://example.com"]);
  assert.equal(mock.registered.size, 0);

  await coordinator.registerAutoSite("https://example.com");
  assert.deepEqual(mock.storage.autoSites, ["https://example.com"]);
  assert.equal(mock.registered.size, 0);

  await coordinator.unregisterQuickControlSite("https://example.com");
  assert.deepEqual(mock.storage.quickControlSites, []);
  assert.equal(mock.registered.size, 0);

  await coordinator.unregisterAutoSite("https://example.com");
  assert.deepEqual(mock.storage.autoSites, []);
  assert.equal(mock.registered.size, 0);

  await coordinator.unregisterCacheRestoreSite("https://example.com");
  assert.deepEqual(mock.storage.cacheRestoreSites, []);
  assert.equal(mock.registered.size, 0);
});

test("hiding Quick Control removes persistent display without disrupting an auto-site registration", async () => {
  const mock = createChromeMock({ permitted: true });
  const coordinator = await loadCoordinator(mock);

  await coordinator.registerAutoSite("https://example.com");
  await coordinator.registerQuickControlSite("https://example.com");
  const result = await coordinator.hideQuickControlSite("https://example.com");

  assert.equal(result.hidden, true);
  assert.deepEqual(mock.storage.quickControlSites, []);
  assert.deepEqual(mock.storage.quickControlHiddenSites, ["https://example.com"]);
  assert.equal(mock.registered.size, 0);

  await coordinator.showQuickControlSite("https://example.com");
  assert.deepEqual(mock.storage.quickControlHiddenSites, []);
  assert.equal(mock.registered.size, 0);
});

test("startup removes obsolete dynamic registrations after switching to static injection", async () => {
  const mock = createChromeMock({ permitted: true });
  mock.registered.set("tf_site_selection_all_sites", { id: "tf_site_selection_all_sites" });
  mock.registered.set("tf_auto_legacy", { id: "tf_auto_legacy" });
  mock.registered.set("unrelated_registration", { id: "unrelated_registration" });
  mock.storage.autoSites = ["https://example.com"];
  const coordinator = await loadCoordinator(mock);

  const state = await coordinator.syncSiteRegistrations();

  assert.deepEqual(state.autoSites, ["https://example.com"]);
  assert.deepEqual([...mock.registered.keys()], ["unrelated_registration"]);
});

test("Reading marker intent is permission-gated, port-precise and survives revocation without changing other features", async () => {
  const mock = createChromeMock({ permitted: false });
  const coordinator = await loadCoordinator(mock);
  assert.deepEqual(await coordinator.setReadingMemorySite("http://127.0.0.1:8123", true), {
    state: "permission-required", enabled: false, permissionGranted: false
  });
  assert.deepEqual(mock.storage.readingMemorySites, []);
  mock.setPermission(true);
  assert.deepEqual(await coordinator.setReadingMemorySite("http://127.0.0.1:8123", true), {
    state: "ready", enabled: true, permissionGranted: true
  });
  assert.deepEqual(mock.storage.readingMemorySites, ["http://127.0.0.1:8123"]);
  await coordinator.registerAutoSite("http://127.0.0.1:8123");
  mock.setPermission(false);
  assert.deepEqual(await coordinator.getReadingMemorySite("http://127.0.0.1:8123"), {
    state: "permission-required", enabled: true, permissionGranted: false
  });
  assert.deepEqual((await coordinator.syncSiteRegistrations()).readingMemorySites, ["http://127.0.0.1:8123"]);
  assert.deepEqual(mock.storage.readingMemorySites, ["http://127.0.0.1:8123"]);
  assert.deepEqual(mock.storage.autoSites, []);
  assert.deepEqual(await coordinator.setReadingMemorySite("http://127.0.0.1:8123", false), {
    state: "ready", enabled: false, permissionGranted: false
  });
});
