import test from "node:test";
import assert from "node:assert/strict";
import { createQuickControlPositionStore } from "../src/background/quick-control-position.js";

const sender = (origin = "https://example.test", overrides = {}) => ({
  id: "extension", frameId: 0, url: `${origin}/article?private=ignored`, tab: { id: 7, url: `${origin}/article` }, ...overrides
});
function fixture(initial = {}) {
  let data = structuredClone(initial), fail = false;
  const storage = {
    async get(key) { return structuredClone({ [key]: data[key] }); },
    async set(value) { if (fail) { fail = false; throw new Error("Storage unavailable"); } Object.assign(data, structuredClone(value)); }
  };
  return { store: createQuickControlPositionStore({ storage, extensionId: "extension" }),
    data: () => data, fail: () => { fail = true; } };
}

test("positions are scoped to the verified sender site, survive reads and reset only that site", async () => {
  const f = fixture();
  assert.deepEqual(await f.store.read(sender()), { position: null });
  await Promise.all([f.store.write(sender(), { x: 0, y: .7 }), f.store.write(sender("https://other.test"), { x: 1, y: 0 })]);
  assert.deepEqual(await f.store.read(sender()), { position: { x: 0, y: .7 } });
  assert.deepEqual(await f.store.read(sender("https://example.test:8443")), { position: { x: 0, y: .7 } });
  assert.equal(JSON.stringify(f.data()).includes("private"), false);
  await f.store.write(sender(), null);
  assert.deepEqual(await f.store.read(sender()), { position: null });
  assert.deepEqual(await f.store.read(sender("https://other.test")), { position: { x: 1, y: 0 } });
});

test("extension pages, frames, forged identities and cross-origin senders cannot read or write positions", async () => {
  const { store } = fixture();
  for (const value of [undefined, {}, sender("https://example.test", { frameId: 1 }), sender("https://example.test", { id: "other" }),
    sender("chrome-extension://extension"), sender("https://other.test", { tab: sender().tab })]) {
    await assert.rejects(store.read(value), { code: "QUICK_CONTROL_CONTENT_ONLY" });
    assert.throws(() => store.write(value, null), { code: "QUICK_CONTROL_CONTENT_ONLY" });
  }
});

test("only bounded finite coordinate pairs or explicit reset are accepted", () => {
  const { store } = fixture();
  for (const value of [undefined, [], {}, { x: 0 }, { x: -1, y: 0 }, { x: 1.1, y: 0 }, { x: NaN, y: 0 },
    { x: Infinity, y: 0 }, { x: "0", y: 0 }, { x: 0, y: 0, pageUrl: "https://other.test" }]) {
    assert.throws(() => store.write(sender(), value), { code: "QUICK_CONTROL_POSITION_INVALID" });
  }
});

test("corrupt data is ignored and site count is bounded without losing the newest writes", async () => {
  const f = fixture({ quickControlPositions: { version: 1, sites: {
    "https://broken.test/path": { x: 0, y: 0 }, "https://bad.test": { x: 9, y: 0 }
  } } });
  for (let i = 0; i < 258; i++) await f.store.write(sender(`https://site${i}.test`), { x: .5, y: .5 });
  assert.equal(Object.keys(f.data().quickControlPositions.sites).length, 256);
  assert.deepEqual(await f.store.read(sender("https://site0.test")), { position: null });
  assert.deepEqual(await f.store.read(sender("https://site257.test")), { position: { x: .5, y: .5 } });
});

test("failed storage writes reject without poisoning later writes", async () => {
  const f = fixture(); f.fail();
  await assert.rejects(f.store.write(sender(), { x: 0, y: 0 }), /Storage unavailable/);
  await f.store.write(sender(), { x: 1, y: 1 });
  assert.deepEqual(await f.store.read(sender()), { position: { x: 1, y: 1 } });
});
