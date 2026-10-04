import { READING_ERROR as E } from "../../shared/reading/constants.js";
import { ReadingContractError } from "../../shared/reading/validation.js";

export const READING_DATABASE = "translateflow-reading-records";
export const READING_DATABASE_VERSION = 1;
export const READING_STORES = ["meta", "records", "snapshots", "artifacts", "pages", "receipts"];
export function storageError(error) {
  if (error instanceof ReadingContractError) return error;
  return new ReadingContractError(error?.name === "QuotaExceededError" ? E.QUOTA : error?.name === "VersionError" ? E.UNSUPPORTED_VERSION : E.STORAGE, "reading.database");
}
// One lazy connection; no destructive recovery and no timer/network awaits in a transaction.
export function createReadingDatabase() {
  let connection = null, opening = null, pendingRequest = null, generation = 0;
  function close() { generation++; connection?.close(); connection = null; opening = null; }
  function open() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    if (pendingRequest) return Promise.reject(storageError(new Error("opening still pending")));
    const epoch = generation;
    opening = new Promise((resolve, reject) => {
      let request, settled = false;
      const refusal = (error) => { if (!settled) { settled = true; opening = null; reject(storageError(error)); } };
      try { request = indexedDB.open(READING_DATABASE, READING_DATABASE_VERSION); pendingRequest = request; } catch (error) { refusal(error); return; }
      request.onblocked = () => refusal(new Error("blocked"));
      request.onerror = () => { if (pendingRequest === request) pendingRequest = null; refusal(request.error); };
      request.onupgradeneeded = (event) => {
        if (event.oldVersion !== 0 || settled || epoch !== generation) { request.transaction.abort(); return; }
        const db = request.result;
        db.createObjectStore("meta");
        const records = db.createObjectStore("records", { keyPath: "record.recordId" });
        records.createIndex("recent", ["sortTime", "record.recordId"], { unique: true });
        records.createIndex("page", "record.pageKey");
        records.createIndex("pageRecent", ["record.pageKey", "sortTime", "record.recordId"], { unique: true });
        for (const [name, id] of [["snapshots", "sourceSnapshotId"], ["artifacts", "artifactId"]]) {
          const store = db.createObjectStore(name, { keyPath: ["recordId", `value.${id}`] });
          store.createIndex("record", "recordId");
        }
        const pages = db.createObjectStore("pages", { keyPath: "pageKey" });
        pages.createIndex("expires", "expiresAt");
        pages.createIndex("recent", ["sortTime", "pageKey"], { unique: true });
        const receipts = db.createObjectStore("receipts", { keyPath: "key" });
        receipts.createIndex("expires", "expiresAt");
      };
      request.onsuccess = () => {
        if (pendingRequest === request) pendingRequest = null;
        const db = request.result;
        if (settled || epoch !== generation) { db.close(); refusal(new Error("closed")); return; }
        if (READING_STORES.some((name) => !db.objectStoreNames.contains(name))) { db.close(); refusal(new Error("schema")); return; }
        try {
          const tx = db.transaction(READING_STORES, "readonly");
          const indexes = { records: { recent: [["sortTime", "record.recordId"], true], page: ["record.pageKey", false], pageRecent: [["record.pageKey", "sortTime", "record.recordId"], true] },
            snapshots: { record: ["recordId", false] }, artifacts: { record: ["recordId", false] }, pages: { expires: ["expiresAt", false], recent: [["sortTime", "pageKey"], true] }, receipts: { expires: ["expiresAt", false] } };
          const keys = { meta: null, records: "record.recordId", snapshots: ["recordId", "value.sourceSnapshotId"], artifacts: ["recordId", "value.artifactId"], pages: "pageKey", receipts: "key" };
          for (const name of READING_STORES) {
            const store = tx.objectStore(name);
            if (JSON.stringify(store.keyPath) !== JSON.stringify(keys[name]) || store.autoIncrement) throw new Error("schema");
            for (const [key, [path, unique]] of Object.entries(indexes[name] || {})) {
              const index = store.index(key);
              if (JSON.stringify(index.keyPath) !== JSON.stringify(path) || index.unique !== unique || index.multiEntry) throw new Error("schema");
            }
          }
        } catch (error) { db.close(); refusal(error); return; }
        settled = true; connection = db; opening = null;
        db.onversionchange = () => { db.close(); if (connection === db) { connection = null; generation++; } };
        db.onclose = () => { if (connection === db) { connection = null; generation++; } };
        resolve(db);
      };
    });
    const pending = opening;
    void pending.catch(() => { if (opening === pending) opening = null; });
    return pending;
  }
  async function run(mode, assertCurrent, program, stores = READING_STORES, signal = null) {
    const checkCurrent = () => {
      if (signal?.aborted) throw cancellationError();
      assertCurrent?.();
    };
    checkCurrent();
    const db = await open();
    checkCurrent();
    return new Promise((resolve, reject) => {
      let tx, iterator, result, failure, settled = false, commitStarted = false;
      try { tx = db.transaction(stores, mode); } catch (error) { reject(storageError(error)); return; }
      const cleanup = () => signal?.removeEventListener("abort", abortTransaction);
      const settleError = error => {
        if (settled) return;
        settled = true; cleanup();
        reject(error?.code === "CANCELLED" ? error : storageError(error));
      };
      const abortTransaction = () => {
        if (settled || commitStarted) return;
        failure ||= cancellationError();
        try { tx.abort(); } catch (error) {
          // If abort is no longer possible, preserve the native failure/result.
          if (failure?.code !== "CANCELLED") settleError(failure || error);
        }
      };
      signal?.addEventListener("abort", abortTransaction, { once: true });
      tx.oncomplete = () => { settled = true; cleanup(); resolve(result); };
      tx.onabort = () => settleError(failure || tx.error);
      tx.onerror = () => { failure ||= tx.error; };
      function step(value) {
        try {
          checkCurrent();
          const next = iterator.next(value);
          if (next.done) {
            // This synchronous check and commit call form the sole point after
            // which Stop can no longer roll back the IndexedDB transaction.
            checkCurrent(); result = next.value; commitStarted = true; cleanup();
            if (typeof tx.commit === "function") tx.commit();
            return;
          }
          const request = next.value;
          request.onsuccess = () => step(request.result);
          request.onerror = () => { failure = request.error; }; // Native default abort remains enabled.
        } catch (error) {
          failure ||= error;
          try { tx.abort(); } catch (abortError) { settleError(failure || abortError); }
        }
      }
      try { iterator = program((name) => tx.objectStore(name)); step(); }
      catch (error) { failure ||= error; try { tx.abort(); } catch (abortError) { settleError(failure || abortError); } }
    });
  }
  return { run, close };
}
function cancellationError() { return Object.assign(new Error("cancelled"), { name: "AbortError", code: "CANCELLED" }); }
export const only = (value) => IDBKeyRange.only(value);
export const lower = (value, open = false) => IDBKeyRange.lowerBound(value, open);
export const bound = (start, end, startOpen = false, endOpen = false) => IDBKeyRange.bound(start, end, startOpen, endOpen);
// Cursor continuation happens synchronously inside the request success callback.
export function* collect(store, range = null, index = null, limit = Number.MAX_SAFE_INTEGER) {
  const result = [], request = (index ? store.index(index) : store).openCursor(range);
  for (let cursor = yield request; cursor && result.length < limit; cursor = yield request) {
    result.push(cursor.value);
    if (result.length >= limit) break;
    cursor.continue();
  }
  return result;
}
