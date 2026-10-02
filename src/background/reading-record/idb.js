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
  let connection = null, opening = null, generation = 0;
  function close() { generation++; connection?.close(); connection = null; opening = null; }
  function open() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    const epoch = generation;
    opening = new Promise((resolve, reject) => {
      let request, settled = false;
      const refusal = (error) => { if (!settled) { settled = true; opening = null; reject(storageError(error)); } };
      try { request = indexedDB.open(READING_DATABASE, READING_DATABASE_VERSION); } catch (error) { refusal(error); return; }
      request.onblocked = () => refusal(new Error("blocked"));
      request.onerror = () => refusal(request.error);
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
        const db = request.result;
        if (settled || epoch !== generation) { db.close(); refusal(new Error("closed")); return; }
        if (READING_STORES.some((name) => !db.objectStoreNames.contains(name))) { db.close(); refusal(new Error("schema")); return; }
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
  async function run(mode, assertCurrent, program, stores = READING_STORES) {
    const db = await open(); assertCurrent();
    return new Promise((resolve, reject) => {
      let tx, iterator, result, failure;
      try { tx = db.transaction(stores, mode); } catch (error) { reject(storageError(error)); return; }
      tx.oncomplete = () => resolve(result); // Success request events are not commit acknowledgements.
      tx.onabort = () => reject(storageError(failure || tx.error));
      tx.onerror = () => { failure ||= tx.error; };
      function step(value) {
        try {
          const next = iterator.next(value);
          if (next.done) { assertCurrent(); result = next.value; return; }
          const request = next.value;
          request.onsuccess = () => step(request.result);
          request.onerror = () => { failure = request.error; }; // Native default abort remains enabled.
        } catch (error) { failure = error; try { tx.abort(); } catch { reject(storageError(error)); } }
      }
      try { iterator = program((name) => tx.objectStore(name)); step(); }
      catch (error) { failure = error; tx.abort(); }
    });
  }
  return { run, close };
}
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
