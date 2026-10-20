import { projectRecordListItem } from "../../shared/reading/previews.js";
import { fail } from "../../shared/reading/validation.js";
import { checkCapacity } from "../../shared/reading/lifecycle.js";
import { state, policy, pageState, rebuildPage, changed, applicationBytes, E, L } from "./storage-state.js";

// Runs in one transaction owned by idb.js: capacity, rows, counters and indexes commit together.
// Existing IDs win unchanged, including AI history; restored data never enables recording.
export function* restore(store, context) {
  const meta = yield* state(store); policy(meta, context);
  if (meta.exportRevision !== context.expectedRevision) fail(E.STALE_OPERATION, "import.revision");
  let imported = 0, skipped = 0; const pages = new Set();
  for (const detail of context.backup.records) {
    const { record, snapshots, artifacts } = detail;
    if (yield store("records").get(record.recordId)) { skipped++; continue; }
    const bytes = applicationBytes([record, ...snapshots, ...artifacts]);
    Object.assign(meta, checkCapacity({ recordCount: meta.recordCount, totalBytes: meta.totalBytes, addedRecords: 1, addedBytes: bytes }));
    const siteKey = detail.siteKey || new URL(record.safeReturnUrl).origin;
    for (const value of snapshots) yield store("snapshots").add({ recordId: record.recordId, value });
    for (const value of artifacts) yield store("artifacts").add({ recordId: record.recordId, value });
    yield store("records").add({ record, siteKey, documentGeneration: snapshots[0].documentGeneration, bytes, sortTime: -record.lastLookupAt, listItem: projectRecordListItem({ record, snapshots, artifacts }, siteKey) });
    pages.add(record.pageKey); imported++;
  }
  if (imported) {
    const newPages = []; for (const pageKey of pages) if (!(yield store("pages").get(pageKey))) newPages.push(pageKey);
    if ((yield store("pages").count()) + newPages.length > L.records + L.operationsGlobal) fail(E.CAPACITY, "import.pages");
    for (const pageKey of pages) { const page = yield* rebuildPage(store, yield* pageState(store, pageKey)); delete page.expiresAt; changed(meta, page, false); yield store("pages").put(page); }
    meta.dataGeneration++; changed(meta); yield store("meta").put(meta, "state");
  }
  return { imported, skipped };
}
