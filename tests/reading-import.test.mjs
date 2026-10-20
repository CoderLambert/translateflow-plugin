import test from "node:test";
import assert from "node:assert/strict";
import { createImportRegistry } from "../src/background/reading-record/imports.js";
import { validateReadingExport } from "../src/shared/reading/record.js";
import { createSourceDigest } from "../src/shared/reading/identity.js";
import { authorizeReadingMethod } from "../src/shared/reading/lifecycle.js";
import { READING_METHOD as M, READING_ERROR as E } from "../src/shared/reading/constants.js";
import { record, snapshot, artifact } from "./fixtures/reading/contract.mjs";
async function backup(version = 2) {
 const source = snapshot(); source.sourceDigest = await createSourceDigest(source);
 return { format: "translateflow-reading", schemaVersion: version, exportedAt: 1000, records: [{ ...(version === 2 ? { siteKey: "https://example.test" } : {}), record: record({ safeReturnUrl: version === 2 ? null : record().safeReturnUrl }), snapshots: [source], artifacts: [artifact(), artifact("assistant")] }] };
}
const context = request => ({ request, access: { ownerKey: "verified-native", navigationGeneration: 1, tabId: 7 }, assertCurrent() {} });
function harness() {
 let writes = 0, now = 1000, committed;
 const registry = createImportRegistry({ randomId: () => "import-test", now: () => now, repository: {
  prepareImport: async () => 5,
  restoreImport: async ctx => { ctx.assertCurrent(); committed = ctx.backup; writes++; return { imported: committed.records.length, skipped: 0 }; }
 } });
 return { registry, writes: () => writes, committed: () => committed, expire: () => { now += 600001; } };
}
async function upload(h, value) {
 const json = typeof value === "string" ? value : JSON.stringify(value);
 const { importId } = await h.registry.start(context({ bytes: new TextEncoder().encode(json).byteLength }));
 for (let offset = 0, sequence = 0; offset < json.length; offset += 512, sequence++) h.registry.chunk(context({ importId, sequence, jsonChunk: json.slice(offset, offset + 512) }));
 return importId;
}
test("Reading v2 restores source sites, independent AI artifacts and exact source; finish receipt is idempotent", async () => {
 const value = await backup(), h = harness(), importId = await upload(h, value);
 assert.deepEqual(await h.registry.finish(context({ importId })), { imported: 1, skipped: 0 });
 assert.deepEqual(h.committed(), value); assert.equal(h.writes(), 1);
 assert.deepEqual(await h.registry.finish(context({ importId })), { imported: 1, skipped: 0 }); assert.equal(h.writes(), 1);
 assert.throws(() => h.registry.cancel(context({ importId })), { code: E.STALE_OPERATION });
 assert.deepEqual(validateReadingExport(await backup(1)), await backup(1));
 const next = await upload(h, value); assert.deepEqual(await h.registry.finish(context({ importId: next })), { imported: 1, skipped: 0 }); assert.equal(h.writes(), 2);
});
test("malformed tails, unknown schema, invalid digest and incomplete uploads write nothing", async () => {
 const valid = await backup();
 for (const value of [JSON.stringify(valid).slice(0, -2), { ...valid, schemaVersion: 999 }, { ...valid, records: [{ ...valid.records[0], snapshots: [snapshot()] }] }, { ...await backup(1), records: [{ record: record({ safeReturnUrl: null }), snapshots: valid.records[0].snapshots, artifacts: valid.records[0].artifacts }] }]) {
  const h = harness(), importId = await upload(h, value); await assert.rejects(h.registry.finish(context({ importId }))); assert.equal(h.writes(), 0);
 }
 const h = harness(), { importId } = await h.registry.start(context({ bytes: 100 }));
 await assert.rejects(h.registry.finish(context({ importId })), { code: E.BAD_DTO }); assert.equal(h.writes(), 0);
});
test("owner, sequence, session bound, cancellation, navigation and expiry protect staged imports", async () => {
 const value = await backup(), h = harness(), importId = await upload(h, value);
 await assert.rejects(h.registry.start(context({ bytes: 10 })), { code: E.CAPACITY });
 assert.throws(() => h.registry.chunk({ ...context({ importId, sequence: 0, jsonChunk: "x" }), access: { ownerKey: "other" } }), { code: E.STALE_OPERATION });
 assert.throws(() => h.registry.chunk(context({ importId, sequence: 0, jsonChunk: "x" })), { code: E.STALE_OPERATION });
 h.registry.revoke(entry => entry.tabId === 7); await assert.rejects(h.registry.finish(context({ importId })), { code: E.STALE_OPERATION });
 const second = await upload(h, value); h.expire(); await assert.rejects(h.registry.finish(context({ importId: second })), { code: E.STALE_OPERATION });
 const third = await upload(h, value); assert.deepEqual(h.registry.cancel(context({ importId: third })), { cancelled: true }); assert.equal(h.writes(), 0);
 for (const method of [M.IMPORT_START, M.IMPORT_CHUNK, M.IMPORT_FINISH, M.IMPORT_CANCEL]) assert.throws(() => authorizeReadingMethod(method, { scope: "content", senderVerified: true, incognito: false }), { code: E.FORBIDDEN });
});

test("legacy v1 restores through the registry when its origin is recoverable; missing origin fails for the documented reason", async () => {
 const value = await backup(1), h = harness(), importId = await upload(h, value);
 assert.deepEqual(await h.registry.finish(context({ importId })), { imported: 1, skipped: 0 });
 assert.deepEqual(h.committed(), value);
 const unavailable = structuredClone(value); unavailable.records[0].record.safeReturnUrl = null;
 const target = harness(), blocked = await upload(target, unavailable);
 await assert.rejects(target.registry.finish(context({ importId: blocked })), { code: E.UNSUPPORTED_VERSION });
 assert.equal(target.writes(), 0);
});
