import { READING_ERROR as E, READING_LIMITS as L } from "../../shared/reading/constants.js";
import { fail } from "../../shared/reading/validation.js";
import { validateReadingExport } from "../../shared/reading/record.js";
import { createSourceDigest } from "../../shared/reading/identity.js";

// One bounded in-memory upload, owned by a verified native learning-center document.
// Nothing is written before the complete file validates. No new persistent staging store.
export function createImportRegistry({ repository, now = Date.now, randomId = () => crypto.randomUUID() }) {
  const sessions = new Map();
  function prune() { for (const [id, entry] of sessions) if (!entry.busy && now() >= entry.expiresAt) sessions.delete(id); }
  function owned(context) {
    prune(); const entry = sessions.get(context.request.importId);
    if (!entry || entry.ownerKey !== context.access.ownerKey || entry.navigationGeneration !== context.access.navigationGeneration || entry.busy || now() >= entry.expiresAt) fail(E.STALE_OPERATION, "import.owner");
    context.assertCurrent(); return entry;
  }
  return {
    async start(context) {
      if (typeof repository?.prepareImport !== "function" || typeof repository?.restoreImport !== "function") fail(E.NOT_READY, "import.repository");
      prune(); for (const [id, entry] of sessions) if (entry.result) sessions.delete(id);
      if (sessions.size) fail(E.CAPACITY, "import.sessions");
      const importId = randomId(), entry = { ownerKey: context.access.ownerKey, tabId: context.access.tabId, navigationGeneration: context.access.navigationGeneration,
        expiresAt: now() + L.exportTtlMs, busy: true, parts: [], bytes: 0, expectedBytes: context.request.bytes, sequence: 0 };
      sessions.set(importId, entry);
      try { entry.revision = await repository.prepareImport(context); context.assertCurrent(); if (sessions.get(importId) !== entry) fail(E.STALE_OPERATION, "import.revoked"); entry.busy = false; return { importId }; }
      catch (error) { sessions.delete(importId); throw error; }
    },
    chunk(context) {
      const entry = owned(context), { sequence, jsonChunk } = context.request;
      if (entry.result || sequence !== entry.sequence) fail(E.STALE_OPERATION, "import.sequence");
      const bytes = new TextEncoder().encode(jsonChunk).byteLength;
      if (!bytes || entry.bytes + bytes > entry.expectedBytes) { sessions.delete(context.request.importId); fail(E.LIMIT, "import.bytes"); }
      entry.parts.push(jsonChunk); entry.bytes += bytes; entry.sequence++;
      return { sequence };
    },
    async finish(context) {
      const entry = owned(context), importId = context.request.importId;
      if (entry.result) return entry.result;
      entry.busy = true;
      try {
        if (entry.bytes !== entry.expectedBytes) fail(E.BAD_DTO, "import.incomplete");
        let raw; try { raw = JSON.parse(entry.parts.join("")); } catch { fail(E.BAD_DTO, "import.json"); }
        entry.parts = [];
        const backup = validateReadingExport(raw);
        // v1 omitted origin metadata. A missing locator cannot be reverse-engineered from its hash.
        if (backup.schemaVersion === 1 && backup.records.some(detail => !detail.record.safeReturnUrl)) fail(E.UNSUPPORTED_VERSION, "import.legacy-origin");
        for (const detail of backup.records) for (const snapshot of detail.snapshots) {
          if (await createSourceDigest(snapshot) !== snapshot.sourceDigest) fail(E.BAD_DTO, "import.digest");
          context.assertCurrent();
        }
        const assertCurrent = () => { context.assertCurrent(); if (sessions.get(importId) !== entry || now() >= entry.expiresAt) fail(E.STALE_OPERATION, "import.revoked"); };
        assertCurrent();
        entry.result = await repository.restoreImport({ ...context, assertCurrent, expectedRevision: entry.revision, backup });
        // Durable acknowledgement: never turn an already committed restore into a cancellation.
        return entry.result;
      } catch (error) { sessions.delete(importId); throw error; }
      finally { entry.busy = false; entry.parts = []; }
    },
    cancel(context) { const entry = owned(context); if (entry.result) fail(E.STALE_OPERATION, "import.committed"); sessions.delete(context.request.importId); return { cancelled: true }; },
    revoke(predicate = () => true) { for (const [id, entry] of sessions) if (predicate(entry)) sessions.delete(id); }
  };
}
