import { READING_METHOD as M, READING_LIMITS as L, READING_ERROR as E } from "../../shared/reading/constants.js";
import { fail } from "../../shared/reading/validation.js";
import { createReadingDatabase } from "./idb.js";
import { state, pageState, policy, sitePolicy } from "./storage-state.js";
import { prepare, validatedWrite, append, cancel, cancellationInput } from "./write.js";
import { manage } from "./management.js";
import { read, queryIdentity } from "./query.js";
import { open, exportState, chunk, finish } from "./export-reader.js";

// Pure/lazy factory. Reading data has no relationship to cache-db, OPFS or chrome.storage.
export function createReadingRepository({ now = Date.now, randomId = () => crypto.randomUUID(), onCommit = null } = {}) {
  const database = createReadingDatabase(), cursors = new Map(); let publisher = onCommit;
  function published() { if (publisher) { try { void Promise.resolve(publisher()).catch(() => {}); } catch {} } }
  function prune() { for (const [key, value] of cursors) if (!value.busy && now() >= value.expiresAt) cursors.delete(key); }
  const run = (mode, context, program) => database.run(mode, context.assertCurrent, program);
  async function readContext(context) {
    prune(); const { request } = context;
    const listed = [M.LIST_RECORDS, M.LIST_PAGES, M.GET_PAGE_SUMMARY, M.LIST_RECORDING_EXCLUSIONS].includes(request.method);
    const cursor = request.cursor ? cursors.get(request.cursor) : null;
    if (request.cursor && (!cursor || cursor.busy || cursor.identity !== queryIdentity(context))) fail(E.STALE_OPERATION, "query.cursor");
    let name = request.cursor, reservation = cursor;
    if (listed) {
      if (!reservation) {
        if (cursors.size >= L.operationsGlobal) fail(E.CAPACITY, "query.cursors");
        name = randomId(); reservation = { identity: queryIdentity(context), expiresAt: now() + L.operationTtlMs };
        cursors.set(name, reservation);
      }
      reservation.busy = true; // Reserve synchronously; concurrent consumption cannot fork a chain.
    }
    try {
      let result;
      try { result = await run(request.method === M.GET_RECORD ? "readwrite" : "readonly", context, (store) => read(store, context, cursor, now())); }
      catch (error) {
        if (request.method !== M.GET_RECORD || ![E.QUOTA, E.CAPACITY].includes(error.code)) throw error;
        result = await run("readonly", context, (store) => read(store, context, cursor, now(), false));
      }
      if (result.committed) published();
      if (listed) {
        if (cursors.get(name) !== reservation || now() >= reservation.expiresAt) fail(E.STALE_OPERATION, "query.cursor");
        cursors.delete(name); // Successful pages consume the old token; one chain occupies one slot.
        let nextCursor = null;
        if (result.more) {
          nextCursor = randomId(); cursors.set(nextCursor, { ...result.cursor, busy: false, expiresAt: reservation.expiresAt });
        }
        result.data.nextCursor = nextCursor;
      }
      return result.data;
    } catch (error) {
      if (listed && cursors.get(name) === reservation) {
        if (!cursor || now() >= reservation.expiresAt) cursors.delete(name); else reservation.busy = false;
      }
      throw error;
    }
  }
  return {
    setInvalidationPublisher(value) { if (value !== null && typeof value !== "function") throw new TypeError("publisher"); publisher = value; },
    close() { publisher = null; cursors.clear(); database.close(); },
    read: readContext,
    readPolicy(context) { return run("readonly", context, function* (store) {
      // This is the internal preflight policy read, before service derives access.siteExcluded.
      const meta = yield* state(store); policy(meta, { ...context, request: null }, { siteRead: true });
      return { siteExcluded: sitePolicy(meta, context.access.siteKey).excluded };
    }); },
    prepareOperation(context) { const candidateId = randomId(); return run("readwrite", context, (store) => prepare(store, context, now(), candidateId)); },
    async mutate(context) {
      const input = [M.SAVE_QUERY_RESULT, M.APPEND_ASSISTANT].includes(context.request.method) ? await validatedWrite(context) : null;
      const result = await run("readwrite", context, (store) => input ? append(store, context, input, now()) : manage(store, context, now()));
      if (!result.duplicate) published(); return result;
    },
    async cancelOperation(context) { const digest = await cancellationInput(context); return run("readwrite", context, (store) => cancel(store, context, digest, now())); },
    readInvalidationState(context) { return run("readonly", context, function* (store) {
      const meta = yield* state(store); policy(meta, context);
      const revisions = context.access.scope === "content" ? { pageRevision: (yield* pageState(store, context.access.pageKey)).pageRevision } : { catalogRevision: meta.catalogRevision };
      return { protocolVersion: 2, type: "reading.invalidate", dataGeneration: meta.dataGeneration, consentGeneration: meta.consentGeneration, ...revisions };
    }); },
    openExport(context) { return run("readonly", context, (store) => open(store, context, now())); },
    checkExport(context) { return run("readonly", context, function* (store) { yield* exportState(store, context); }); },
    readExportChunk(context) { return run("readonly", context, (store) => chunk(store, context)); },
    finishExport(context) { return run("readonly", context, (store) => finish(store, context)); },
    cancelExport(context) { return run("readonly", context, function* (store) { policy(yield* state(store), context); }); }
  };
}
