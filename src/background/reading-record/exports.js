import { READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "../../shared/reading/constants.js";
import { validateExportResponse } from "../../shared/reading/export.js";
import { fail, jsonBytes } from "../../shared/reading/validation.js";

// Bounded transient export capabilities; #233 owns each short revision-checked repository read/finish.
export function createExportRegistry({ repository, now = Date.now, randomId = () => crypto.randomUUID() } = {}) {
  const sessions = new Map();
  const invoke = (name, value) => {
    if (typeof repository?.[name] !== "function") fail(E.NOT_READY, "export.repository");
    return repository[name](value);
  };
  function prune() { for (const [key, item] of sessions) if (now() >= item.expiresAt) sessions.delete(key); }
  function get(exportId, access) {
    prune();
    const session = sessions.get(exportId);
    if (!session || session.ownerKey !== access.ownerKey || session.navigationGeneration !== access.navigationGeneration) fail(E.INTERRUPTED, "export.owner");
    return session;
  }
  const assertLive = (session, assertCurrent) => {
    assertCurrent();
    if (sessions.get(session.exportId) !== session || session.state !== "active" || now() >= session.expiresAt) fail(E.INTERRUPTED, "export.current");
  };
  async function start(context) {
    prune();
    const active = [...sessions.values()].filter((item) => ["starting", "active", "finishing", "cancelling"].includes(item.state));
    if (active.length >= L.exportsGlobal || active.filter((item) => item.ownerKey === context.access.ownerKey).length >= L.exportsPerOwner || sessions.size >= L.operationsGlobal) fail(E.CAPACITY, "exports");
    const exportId = randomId(), expiresAt = now() + L.exportTtlMs;
    const session = { exportId, expiresAt, ownerKey: context.access.ownerKey, tabId: context.access.tabId, navigationGeneration: context.access.navigationGeneration,
      state: "starting", nextCursor: randomId(), sequence: 0, position: null, lastCursor: null, lastChunk: null, pending: null };
    sessions.set(exportId, session); // Reserve before awaiting: parallel starts cannot exceed caps.
    try {
      const opened = await invoke("openExport", context);
      context.assertCurrent();
      if (sessions.get(exportId) !== session || session.state !== "starting" || now() >= expiresAt) fail(E.INTERRUPTED, "export.start");
      Object.assign(session, { state: "active", exportRevision: opened.exportRevision, exportedAt: opened.exportedAt, position: opened.position });
      return validateExportResponse(M.EXPORT_START, { exportId, exportRevision: session.exportRevision, expiresAt, nextCursor: session.nextCursor });
    } catch (error) {
      if (sessions.get(exportId) === session && session.state === "starting") sessions.delete(exportId);
      throw error; // Keep an acknowledged concurrent cancellation receipt until its original TTL.
    }
  }
  async function next(context) {
    const { request, access, assertCurrent } = context, session = get(request.exportId, access);
    assertLive(session, assertCurrent);
    if (request.cursor === session.lastCursor) {
      const chunk = session.lastChunk;
      await invoke("checkExport", { ...context, exportId: session.exportId, exportRevision: session.exportRevision });
      assertLive(session, assertCurrent);
      if (request.cursor !== session.lastCursor || session.lastChunk !== chunk) fail(E.INTERRUPTED, "export.retry");
      return chunk;
    }
    if (request.cursor !== session.nextCursor) fail(E.INTERRUPTED, "export.cursor");
    if (session.pending) {
      if (session.pending.cursor !== request.cursor) fail(E.INTERRUPTED, "export.pending");
      return session.pending.promise;
    }
    const promise = (async () => {
      const result = await invoke("readExportChunk", { ...context, exportId: session.exportId, exportRevision: session.exportRevision,
        exportedAt: session.exportedAt, position: session.position, sequence: session.sequence, maxChunkBytes: L.exportChunkBytes,
        assertCurrent: () => assertLive(session, assertCurrent) });
      assertLive(session, assertCurrent);
      if (result.exportRevision !== session.exportRevision) fail(E.INTERRUPTED, "export.revision");
      const chunk = validateExportResponse(M.EXPORT_NEXT, { sequence: session.sequence, jsonChunk: result.jsonChunk,
        nextCursor: result.done ? null : randomId(), done: result.done, exportRevision: session.exportRevision });
      jsonBytes({ protocolVersion: 2, ok: true, data: chunk }, L.listResponseBytes, "export.response");
      Object.assign(session, { position: result.position, nextCursor: chunk.nextCursor, sequence: session.sequence + 1,
        lastCursor: request.cursor, lastChunk: chunk });
      return chunk;
    })();
    session.pending = { cursor: request.cursor, promise };
    try { return await promise; } finally { session.pending = null; }
  }
  async function finish(context) {
    const session = get(context.request.exportId, context.access);
    context.assertCurrent();
    if (session.state === "finished") {
      if (context.request.sequence !== session.receipt.sequence) fail(E.INTERRUPTED, "export.sequence");
      return session.receipt;
    }
    assertLive(session, context.assertCurrent);
    if (session.pending || session.nextCursor !== null || !session.lastChunk?.done || context.request.sequence !== session.lastChunk.sequence) fail(E.INTERRUPTED, "export.eof");
    // Reserve delivery/finish; cancel cannot concurrently claim rollback of a delivered file.
    session.state = "finishing";
    try {
      await invoke("finishExport", { ...context, exportId: session.exportId, exportRevision: session.exportRevision,
        position: session.position, sequence: context.request.sequence,
        assertCurrent: () => {
          context.assertCurrent();
          if (session.state !== "finishing" || sessions.get(session.exportId) !== session || now() >= session.expiresAt) fail(E.INTERRUPTED, "export.finish");
        } });
      context.assertCurrent();
      if (session.state !== "finishing" || now() >= session.expiresAt) fail(E.INTERRUPTED, "export.finish");
      session.receipt = validateExportResponse(M.EXPORT_FINISH, { exportId: session.exportId, sequence: context.request.sequence, exportRevision: session.exportRevision, state: "finished" });
      session.state = "finished"; session.lastChunk = null; return session.receipt;
    } catch (error) { session.state = "interrupted"; session.lastChunk = null; throw error; }
  }
  async function cancel(context) {
    const session = get(context.request.exportId, context.access);
    context.assertCurrent();
    if (["finished", "cancelled"].includes(session.state)) return { exportId: session.exportId, state: session.state };
    if (session.state === "finishing" || session.state === "cancelling") fail(E.INTERRUPTED, "export.pending");
    session.state = "cancelling";
    try { await invoke("cancelExport", { ...context, exportId: session.exportId, exportRevision: session.exportRevision }); }
    catch (error) { session.state = "interrupted"; throw error; }
    session.state = "cancelled"; session.lastChunk = null;
    return { exportId: session.exportId, state: "cancelled" };
  }
  return { start, next, finish, cancel,
    revoke(predicate = () => true) { for (const session of sessions.values()) if (predicate(session) && session.state !== "finished") { session.state = "interrupted"; session.lastChunk = null; } },
    get size() { prune(); return sessions.size; } };
}
