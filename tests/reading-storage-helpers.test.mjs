import test from "node:test";
import assert from "node:assert/strict";
import { byteLength } from "../src/shared/hash.js";
import { safePrefix } from "../src/background/reading-record/export-reader.js";
import { literalMatch, queryIdentity } from "../src/background/reading-record/query.js";
import { createReadingRepository } from "../src/background/reading-record/repository.js";
import { storageError, createReadingDatabase } from "../src/background/reading-record/idb.js";
import { initialMeta, recordingState, validateMeta, state } from "../src/background/reading-record/storage-state.js";
import { READING_ERROR as E, READING_LIMITS as L } from "../src/shared/reading/constants.js";

test("Export prefix respects exact UTF8/escaped limits and never splits emoji", () => {
  assert.equal(safePrefix("😀x", 4, 4), "😀");
  assert.equal(safePrefix("中😀x", 7, 7), "中😀");
  assert.equal(safePrefix("😀x", 3, 100), "");
  const input = '"\\😀中文\n'.repeat(10000);
  for (const raw of [1, 3, 16, 128, 8192]) for (const escaped of [2, 4, 64, 1024]) {
    const result = safePrefix(input, raw, escaped);
    assert.ok(byteLength(result) <= raw); assert.ok(byteLength(JSON.stringify(result)) - 2 <= escaped);
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(result), false);
  }
});
test("Repository factory is pure/lazy and detach/close needs no browser or DB", () => {
  assert.equal(globalThis.indexedDB, undefined);
  const repository = createReadingRepository();
  for (const method of ["readPolicy", "read", "prepareOperation", "mutate", "cancelOperation", "readInvalidationState", "openExport", "checkExport", "readExportChunk", "finishExport", "cancelExport"]) assert.equal(typeof repository[method], "function");
  repository.setInvalidationPublisher(() => {}); repository.setInvalidationPublisher(null); repository.close();
  assert.throws(() => repository.setInvalidationPublisher({}), TypeError);
});
test("Native storage failures keep typed quota/version/abort mapping and existing contract errors", () => {
  assert.equal(storageError(new DOMException("synthetic", "QuotaExceededError")).code, E.QUOTA);
  assert.equal(storageError(new DOMException("synthetic", "VersionError")).code, E.UNSUPPORTED_VERSION);
  assert.equal(storageError(new DOMException("synthetic", "AbortError")).code, E.STORAGE);
  const existing = storageError(new Error("unknown")); assert.equal(storageError(existing), existing);
});
test("Search is bounded literal text; cursor identity binds native owner, document, query and limit", () => {
  const item = { itemText: "React [a-z]+", contextPreview: "Case SAME", resultPreview: { text: "实际结果" } };
  assert.equal(literalMatch(item, "[a-z]+"), true); assert.equal(literalMatch(item, "^React"), false);
  assert.equal(literalMatch(item, "same"), true); assert.equal(literalMatch(item, "结果"), true);
  const context = { access: { ownerKey: "native-a", scope: "extension", authorityGeneration: 1, navigationGeneration: 1, documentGeneration: "native-doc" }, request: { method: "reading.list-records", pageKey: null, query: "", limit: 30 } };
  for (const changed of [{ ...context, access: { ...context.access, ownerKey: "other" } }, { ...context, access: { ...context.access, documentGeneration: "different" } },
    { ...context, request: { ...context.request, query: "changed" } }, { ...context, request: { ...context.request, limit: 100 } }]) assert.notEqual(queryIdentity(changed), queryIdentity(context));
});
test("Capacity does not disable consent and Content state never returns library counts", () => {
  const meta = { ...initialMeta(), enabled: true, recordCount: L.records };
  assert.deepEqual(recordingState(meta, "content"), { enabled: true, consentGeneration: 1, capacityReached: true });
  assert.equal(recordingState(meta, "extension").recordCount, L.records);
  meta.recordCount--; meta.totalBytes = L.totalBytes - 1;
  assert.equal(recordingState(meta, "content").capacityReached, false); assert.equal(meta.enabled, true);
});

test("Corrupt/unknown persisted meta fails closed and never becomes default consent", () => {
  assert.equal(validateMeta(initialMeta()).enabled, false);
  for (const patch of [{enabled: "true"}, {recordCount: 10001}, {totalBytes:-1}, {catalogRevision:0}, {sites:[{siteKey:"https://a.test/path",excluded:true,sitePolicyRevision:1,expiresAt:1000}]}, {unknownFuture:true}]) {
    assert.throws(() => validateMeta({...initialMeta(),...patch}), {code:E.STORAGE});
  }
  const duplicate = {siteKey:"https://a.test",excluded:true,sitePolicyRevision:1,expiresAt:1000};
  assert.throws(() => validateMeta({...initialMeta(),sites:[duplicate,duplicate]}), {code:E.STORAGE});
});

test("Only a genuinely absent meta row can initialize state; persisted falsy values fail closed", () => {
  const request = {}, keyRequest = {};
  function read(value, key = undefined) {
    const flow = state((name) => { assert.equal(name, "meta"); return {
      get(key) { assert.equal(key, "state"); return request; }, getKey(key) { assert.equal(key, "state"); return keyRequest; }
    }; });
    assert.equal(flow.next().value, request); let next = flow.next(value);
    if (!next.done) { assert.equal(next.value, keyRequest); next = flow.next(key); }
    return next.value;
  }
  assert.deepEqual(read(undefined), initialMeta());
  assert.throws(() => read(undefined, "state"), { code: E.STORAGE });
  const valid = { ...initialMeta(), enabled: true, consentGeneration: 7, dataGeneration: 9, recordCount: 1, totalBytes: 3000 };
  assert.equal(read(valid), valid);
  for (const value of [false, null, 0, "", {}, []]) assert.throws(() => read(value), { code: E.STORAGE });
});


test("Blocked native open refuses bounded retries until the uncancellable request settles", async () => {
  const original = globalThis.indexedDB; const requests = [];
  globalThis.indexedDB = {open() { const request = {}; requests.push(request); return request; }};
  const database = createReadingDatabase();
  try {
    const first = database.run("readonly", () => {}, function* () {}); assert.equal(requests.length, 1); requests[0].onblocked();
    await assert.rejects(first, {code:E.STORAGE});
    const retry = await Promise.allSettled(Array.from({length:128}, () => database.run("readonly", () => {}, function* () {})));
    assert.equal(requests.length, 1); assert.ok(retry.every((item) => item.status === "rejected" && item.reason.code === E.STORAGE));
    let closed = 0; requests[0].result = {close(){closed++;}}; requests[0].onsuccess(); assert.equal(closed, 1);
    const next = database.run("readonly", () => {}, function* () {}); assert.equal(requests.length, 2);
    requests[1].error = new DOMException("synthetic version failure", "VersionError"); requests[1].onerror();
    await assert.rejects(next, {code:E.UNSUPPORTED_VERSION});
  } finally {database.close(); if (original === undefined) delete globalThis.indexedDB; else globalThis.indexedDB=original;}
});
