import test from "node:test";
import assert from "node:assert/strict";
import { createReadingDatabase } from "../src/background/reading-record/idb.js";
import { validatedWrite } from "../src/background/reading-record/write.js";
import { READING_ERROR as E } from "../src/shared/reading/constants.js";
import { ReadingContractError } from "../src/shared/reading/validation.js";
import { sha256 } from "../src/shared/hash.js";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";
import { access, artifact, request, snapshot } from "./fixtures/reading/storage.mjs";
import { token } from "./fixtures/reading/contract.mjs";
import { validateOperationToken } from "../src/shared/reading/lifecycle.js";

function installIdbProbe() {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const transactions = [], waiters = [], durableWrites = [];
  const indexes = {
    records: { recent: [["sortTime", "record.recordId"], true], page: ["record.pageKey", false], pageRecent: [["record.pageKey", "sortTime", "record.recordId"], true] },
    snapshots: { record: ["recordId", false] }, artifacts: { record: ["recordId", false] },
    pages: { expires: ["expiresAt", false], recent: [["sortTime", "pageKey"], true] }, receipts: { expires: ["expiresAt", false] }
  };
  const keyPaths = { meta: null, records: "record.recordId", snapshots: ["recordId", "value.sourceSnapshotId"],
    artifacts: ["recordId", "value.artifactId"], pages: "pageKey", receipts: "key" };
  function transaction(names, mode) {
    const tx = { names, mode, writes: [], requests: [], aborted: false, committed: false,
      objectStore(name) {
        return { keyPath: keyPaths[name], autoIncrement: false,
          index(indexName) { const [keyPath, unique] = indexes[name][indexName]; return { keyPath, unique, multiEntry: false }; },
          put(value) { const request = { result: undefined }; tx.requests.push(request); tx.writes.push([name, value]); return request; } };
      },
      abort() { if (tx.committed) throw new DOMException("committing", "InvalidStateError"); tx.aborted = true; queueMicrotask(() => tx.onabort?.()); },
      commit() { tx.committed = true; durableWrites.push(...tx.writes); queueMicrotask(() => tx.oncomplete?.()); } };
    transactions.push(tx);
    for (let index = waiters.length - 1; index >= 0; index--) {
      const waiter = waiters[index]; if (transactions.length >= waiter.count) { waiters.splice(index, 1); waiter.resolve(transactions[waiter.count - 1]); }
    }
    return tx;
  }
  const db = { objectStoreNames: { contains: name => Object.hasOwn(keyPaths, name) }, transaction, close() {} };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() {
    const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess?.(); }); return request;
  } } });
  return { transactions, durableWrites, waitForTransaction(count) {
    if (transactions.length >= count) return Promise.resolve(transactions[count - 1]);
    return new Promise(resolve => waiters.push({ count, resolve }));
  }, restore() {
    if (original) Object.defineProperty(globalThis, "indexedDB", original); else delete globalThis.indexedDB;
  } };
}

function* oneWrite(store) { yield store("records").put({ record: { recordId: "synthetic" } }); return "committed"; }
function* twoWrites(store) {
  yield store("records").put({ record: { recordId: "first" } });
  yield store("artifacts").put({ recordId: "first", value: { artifactId: "second" } });
  return "committed";
}

test("Stop after a first queued write aborts the actual transaction and leaves all stores unchanged", async () => {
  const probe = installIdbProbe(), database = createReadingDatabase(), controller = new AbortController();
  try {
    const pending = database.run("readwrite", () => {}, oneWrite, undefined, controller.signal);
    const tx = await probe.waitForTransaction(2); // Transaction 1 is the adapter's read-only schema check.
    assert.equal(tx.requests.length, 1); assert.deepEqual(probe.durableWrites, []);
    controller.abort();
    await assert.rejects(pending, error => error.code === "CANCELLED");
    assert.equal(tx.aborted, true); assert.equal(tx.committed, false); assert.deepEqual(probe.durableWrites, []);
  } finally { database.close(); probe.restore(); }
});

test("Stop after the first successful request still aborts every queued write in the transaction", async () => {
  const probe = installIdbProbe(), database = createReadingDatabase(), controller = new AbortController();
  try {
    const pending = database.run("readwrite", () => {}, twoWrites, undefined, controller.signal);
    const tx = await probe.waitForTransaction(2); assert.equal(tx.requests.length, 1);
    tx.requests[0].onsuccess();
    assert.equal(tx.requests.length, 2); assert.equal(probe.durableWrites.length, 0);
    controller.abort();
    await assert.rejects(pending, error => error.code === "CANCELLED");
    assert.equal(tx.aborted, true); assert.equal(tx.committed, false); assert.deepEqual(probe.durableWrites, []);
  } finally { database.close(); probe.restore(); }
});

test("cancellation during artifact digest is checked before any IDB transaction starts", async () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto"), nativeCrypto = globalThis.crypto;
  const nativeDigest = nativeCrypto.subtle.digest.bind(nativeCrypto.subtle);
  const controller = new AbortController(), operationToken = validateOperationToken(token());
  const value = artifact("translation", { recordId: operationToken.recordId, operationId: operationToken.operationId,
    sourceSnapshotId: "source-1" });
  const artifactDigest = await sha256(JSON.stringify(value));
  let release, digestStarted;
  const started = new Promise(resolve => { digestStarted = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
    randomUUID: nativeCrypto.randomUUID.bind(nativeCrypto),
    subtle: { digest: async (...args) => { digestStarted(); await barrier; return nativeDigest(...args); } }
  } });
  try {
    const requestValue = { method: M.SAVE_QUERY_RESULT, token: operationToken, artifact: value };
    const context = { request: requestValue, access: access("content"), signal: controller.signal,
      registeredOperation: { revoked: false, access: { ownerKey: "synthetic-owner", navigationGeneration: 1 }, token: operationToken,
        sourceSnapshot: snapshot() }, artifactDigest,
      assertCurrent() { if (controller.signal.aborted) throw Object.assign(new Error("cancelled"), { code: "CANCELLED" }); } };
    const pending = validatedWrite(context);
    await started; controller.abort(); release();
    await assert.rejects(pending, error => error.code === "CANCELLED");
  } finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor); else delete globalThis.crypto;
  }
});

test("the final synchronous generation check aborts, while cancellation after commit reports the durable result", async () => {
  const probe = installIdbProbe(), database = createReadingDatabase();
  try {
    let checks = 0;
    const stale = database.run("readwrite", () => { if (++checks === 5) throw new ReadingContractError(E.STALE_OPERATION, "generation"); }, oneWrite);
    const staleTx = await probe.waitForTransaction(2); staleTx.requests[0].onsuccess();
    await assert.rejects(stale, error => error.code === E.STALE_OPERATION);
    assert.equal(staleTx.aborted, true); assert.deepEqual(probe.durableWrites, []);

    const controller = new AbortController();
    const committed = database.run("readwrite", () => {}, oneWrite, undefined, controller.signal);
    const commitTx = await probe.waitForTransaction(3); commitTx.requests[0].onsuccess();
    assert.equal(commitTx.committed, true);
    controller.abort(); // The irreversible commit point has already been entered.
    assert.equal(await committed, "committed");
    assert.equal(commitTx.aborted, false); assert.equal(probe.durableWrites.length, 1);
  } finally { database.close(); probe.restore(); }
});

test("quota remains the reported failure when Stop races an already failed write", async () => {
  const probe = installIdbProbe(), database = createReadingDatabase(), controller = new AbortController();
  try {
    const pending = database.run("readwrite", () => {}, oneWrite, undefined, controller.signal);
    const tx = await probe.waitForTransaction(2), request = tx.requests[0];
    request.error = new DOMException("synthetic quota", "QuotaExceededError"); request.onerror();
    controller.abort();
    await assert.rejects(pending, error => error.code === E.QUOTA);
    assert.equal(tx.aborted, true); assert.deepEqual(probe.durableWrites, []);
  } finally { database.close(); probe.restore(); }
});

test("request error remains the first cause through the following native transaction abort event", async () => {
  const probe = installIdbProbe(), database = createReadingDatabase();
  try {
    const pending = database.run("readwrite", () => {}, oneWrite);
    const tx = await probe.waitForTransaction(2), request = tx.requests[0];
    request.error = new DOMException("synthetic quota", "QuotaExceededError");
    request.onerror(); // IndexedDB dispatches the request error before aborting its transaction.
    tx.error = new DOMException("transaction aborted", "AbortError");
    tx.aborted = true; tx.onabort();
    await assert.rejects(pending, error => error.code === E.QUOTA);
    assert.deepEqual(probe.durableWrites, []);
  } finally { database.close(); probe.restore(); }
});
