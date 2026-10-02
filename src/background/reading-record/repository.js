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
  function prune() { for (const [key, value] of cursors) if (now() >= value.expiresAt) cursors.delete(key); }
  const run = (mode, context, program) => database.run(mode, context.assertCurrent, program);
  async function readContext(context) {
    prune(); const { request } = context;
    const cursor = request.cursor ? cursors.get(request.cursor) : null;
    if (request.cursor && (!cursor || cursor.identity !== queryIdentity(context))) fail(E.STALE_OPERATION, "query.cursor");
    let result;
    try { result = await run(request.method === M.GET_RECORD ? "readwrite" : "readonly", context, (store) => read(store, context, cursor, now())); }
    catch (error) {
      if (request.method !== M.GET_RECORD || ![E.QUOTA, E.CAPACITY].includes(error.code)) throw error;
      result = await run("readonly", context, (store) => read(store, context, cursor, now(), false));
    }
    if (result.committed) published();
    if ("items" in result.data) {
      let nextCursor = null;
      if (result.more) {
        prune(); if (cursors.size >= L.operationsGlobal) fail(E.CAPACITY, "query.cursors");
        nextCursor = randomId(); cursors.set(nextCursor, { ...result.cursor, expiresAt: now() + L.operationTtlMs });
      }
      result.data.nextCursor = nextCursor;
    }
    return result.data;
  }
  return {
    setInvalidationPublisher(value) { if (value !== null && typeof value !== "function") throw new TypeError("publisher"); publisher = value; },
    close() { publisher = null; cursors.clear(); database.close(); },
    read: readContext,
    readPolicy(context) { return run("readonly", context, function* (store) {
      const meta = yield* state(store); policy(meta, context, { siteRead: true });
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
