import { fail } from "../../shared/reading/validation.js";
import { state, pageState, policy, recordingState, sitePolicy, retainSite, pruneAuxiliary, deleteRows, rebuildPage, changed, E, L, M } from "./storage-state.js";
import { only } from "./idb.js";

export function* manage(store, context, now) {
  const meta = yield* state(store), { request } = context;
  policy(meta, context);
  yield* pruneAuxiliary(store, meta, now);
  if (request.method === M.SET_RECORDING) {
    if (request.expectedConsentGeneration !== meta.consentGeneration) fail(E.REVISION_CONFLICT, "consent.generation");
    meta.enabled = request.enabled; meta.consentGeneration++; changed(meta);
    yield store("meta").put(meta, "state"); return recordingState(meta, context.access.scope);
  }
  if (request.method === M.SET_SITE_RECORDING) {
    const current = sitePolicy(meta, request.siteKey);
    if (request.expectedSitePolicyRevision !== current.sitePolicyRevision) fail(E.REVISION_CONFLICT, "site.revision");
    if (request.excluded && !current.excluded && meta.sites.filter((site) => site.excluded).length >= L.exclusionSites) fail(E.CAPACITY, "exclusions");
    const site = retainSite(meta, request.siteKey, now + L.operationTtlMs);
    site.sitePolicyRevision = ++meta.siteRevision; site.excluded = request.excluded;
    site.expiresAt = now + L.operationTtlMs; changed(meta);
    yield store("meta").put(meta, "state"); return { excluded: site.excluded, sitePolicyRevision: site.sitePolicyRevision };
  }
  if (request.method === M.CLEAR_RECORDS) {
    if (request.expectedDataGeneration !== meta.dataGeneration) fail(E.REVISION_CONFLICT, "data.generation");
    const deletedCount = meta.recordCount;
    for (const name of ["records", "snapshots", "artifacts", "pages"]) yield store(name).clear();
    meta.recordCount = 0; meta.totalBytes = 0; meta.dataGeneration++; changed(meta);
    yield store("meta").put(meta, "state"); return { deletedCount, dataGeneration: meta.dataGeneration };
  }
  let page, deletedCount = 0, deletedBytes = 0;
  if (request.method === M.DELETE_RECORD) {
    const row = yield store("records").get(request.recordId);
    if (!row) fail(E.NOT_FOUND, "record");
    if (row.record.revision !== request.expectedRevision) fail(E.REVISION_CONFLICT, "record.revision");
    page = yield* pageState(store, row.record.pageKey);
    deletedBytes = yield* deleteRows(store, row); deletedCount = 1;
  } else if (request.method === M.DELETE_PAGE) {
    page = yield* pageState(store, request.pageKey);
    if (!(yield store("pages").get(request.pageKey)) && (yield store("pages").count()) >= L.records + L.operationsGlobal) fail(E.CAPACITY, "page.metadata");
    const cursorRequest = store("records").index("page").openCursor(only(request.pageKey));
    for (let cursor = yield cursorRequest; cursor; cursor = yield cursorRequest) {
      deletedBytes += yield* deleteRows(store, cursor.value); deletedCount++; cursor.continue();
    }
    page.pageGeneration++;
  } else fail(E.BAD_DTO, "repository.method");
  meta.recordCount -= deletedCount; meta.totalBytes -= deletedBytes;
  yield* rebuildPage(store, page);
  if (!page.recordCount) page.expiresAt = Math.max(page.expiresAt || 0, now + L.operationTtlMs);
  changed(meta, page); yield store("pages").put(page); yield store("meta").put(meta, "state");
  return request.method === M.DELETE_RECORD ? { deleted: true } : { deletedCount, pageGeneration: page.pageGeneration };
}
