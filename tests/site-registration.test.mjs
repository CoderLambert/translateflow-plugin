import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function createChromeMock({ permitted = false } = {}) {
  const storage = {
    autoSites: [],
    quickControlSites: [],
    quickControlHiddenSites: []
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

test("auto translation and Quick Control share one registration and release it only after both are disabled", async () => {
  const mock = createChromeMock({ permitted: true });
  const coordinator = await loadCoordinator(mock);

  await coordinator.registerQuickControlSite("https://example.com/docs");
  assert.deepEqual(mock.storage.quickControlSites, ["https://example.com"]);
  assert.equal(mock.registered.size, 1);

  await coordinator.registerAutoSite("https://example.com");
  assert.deepEqual(mock.storage.autoSites, ["https://example.com"]);
  assert.equal(mock.registered.size, 1);

  await coordinator.unregisterQuickControlSite("https://example.com");
  assert.deepEqual(mock.storage.quickControlSites, []);
  assert.equal(mock.registered.size, 1);

  await coordinator.unregisterAutoSite("https://example.com");
  assert.deepEqual(mock.storage.autoSites, []);
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
  assert.equal(mock.registered.size, 1);

  await coordinator.showQuickControlSite("https://example.com");
  assert.deepEqual(mock.storage.quickControlHiddenSites, []);
  assert.equal(mock.registered.size, 1);
});
