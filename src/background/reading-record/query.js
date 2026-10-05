import { byteLength } from "../../shared/hash.js";
import { checkCapacity, applicationBytes } from "../../shared/reading/lifecycle.js";
import { fail } from "../../shared/reading/validation.js";
import { state, pageState, policy, detail, recordingState, sitePolicy, changed, E, L, M } from "./storage-state.js";
import { lower, bound } from "./idb.js";

export const queryIdentity = (context) => JSON.stringify([context.access.ownerKey, context.access.authorityGeneration,
  context.access.navigationGeneration, context.access.documentGeneration, context.request.method,
  context.access.scope === "content" ? context.access.pageKey : context.request.pageKey ?? null, context.request.query || "", context.request.limit]);
export function literalMatch(item, query) {
  return !query || [item.itemText, item.pageTitle, item.siteKey, item.contextPreview, item.resultPreview?.text].filter(Boolean).some((value) => value.toLowerCase().includes(query.toLowerCase()));
}
export function* read(store, context, cursor, now, viewed = true) {
  const meta = yield* state(store), { request, access } = context;
  policy(meta, context, { siteRead: [M.GET_SITE_RECORDING, M.GET_RECORDING_STATE].includes(request.method) });
  if (request.method === M.GET_RECORDING_STATE) return { data: recordingState(meta, access.scope) };
  if (request.method === M.GET_SITE_RECORDING) {
    const site = sitePolicy(meta, access.scope === "content" ? access.siteKey : request.siteKey);
    return { data: { excluded: site.excluded, sitePolicyRevision: site.sitePolicyRevision } };
  }
  if (request.method === M.GET_RECORD) {
    const row = yield store("records").get(request.recordId);
    if (!row) fail(E.NOT_FOUND, "record");
    if (access.scope === "content" && row.record.pageKey !== access.pageKey) fail(E.FORBIDDEN, "record.page");
    const data = yield* detail(store, request.recordId, row);
    const lastViewedAt = Math.max(row.record.firstSeenAt, row.record.lastViewedAt ?? 0, now);
    if (viewed && row.record.lastViewedAt !== lastViewedAt) {
      const record = { ...data.record, lastViewedAt, revision: data.record.revision + 1 };
      const bytes = row.bytes + applicationBytes([record]) - applicationBytes([data.record]);
      checkCapacity({ recordCount: meta.recordCount, totalBytes: meta.totalBytes, addedBytes: Math.max(0, bytes - row.bytes) });
      const page = yield* pageState(store, row.record.pageKey);
      meta.totalBytes += bytes - row.bytes; changed(meta, page, false);
      Object.assign(row.listItem, { revision: record.revision, lastViewedAt: record.lastViewedAt });
      Object.assign(row, { record, bytes }); data.record = record;
      yield store("records").put(row); yield store("pages").put(page); yield store("meta").put(meta, "state");
      return { data, committed: true };
    }
    return { data };
  }
  if (request.method === M.GET_RECORD_SITE_KEY) {
    if (access.scope !== "extension") fail(E.FORBIDDEN, "record-site-key.scope");
    const row = yield store("records").get(request.recordId);
    if (!row) fail(E.NOT_FOUND, "record");
    return { data: { siteKey: row.siteKey } };
  }
  const page = access.scope === "content" ? yield* pageState(store, access.pageKey) : null;
  const identity = queryIdentity(context);
  if (cursor && (cursor.identity !== identity || cursor.catalogRevision !== meta.catalogRevision || cursor.consentGeneration !== meta.consentGeneration ||
      cursor.dataGeneration !== meta.dataGeneration || (page && cursor.pageRevision !== page.pageRevision))) fail(E.STALE_OPERATION, "query.cursor");
  if (request.method === M.LIST_RECORDING_EXCLUSIONS) {
    const list = meta.sites.filter((site) => site.excluded).sort((a, b) => a.siteKey < b.siteKey ? -1 : a.siteKey > b.siteKey ? 1 : 0);
    const offset = cursor?.offset || 0, items = list.slice(offset, offset + request.limit).map(({ siteKey, excluded, sitePolicyRevision }) => ({ siteKey, excluded, sitePolicyRevision }));
    return { data: { items }, more: offset + items.length < list.length, cursor: { identity, offset: offset + items.length, catalogRevision: meta.catalogRevision,
      consentGeneration: meta.consentGeneration, dataGeneration: meta.dataGeneration } };
  }
  const pageKey = access.scope === "content" ? access.pageKey : request.pageKey;
  const pages = request.method === M.LIST_PAGES;
  const index = pages ? "recent" : pageKey ? "pageRecent" : "recent";
  const range = pageKey ? bound(cursor?.key || [pageKey, -Number.MAX_SAFE_INTEGER, ""], [pageKey, 0, "\uffff"], !!cursor) : cursor ? lower(cursor.key, true) : null;
  const source = store(pages ? "pages" : "records").index(index).openCursor(range);
  const items = []; let lastKey = cursor?.key || null, more = false, bytes = 1024;
  for (let current = yield source; current; current = yield source) {
    const row = current.value;
    const item = pages ? { pageKey: row.pageKey, siteKey: row.siteKey, pageTitle: row.pageTitle, safeReturnUrl: row.safeReturnUrl,
      recordCount: row.recordCount, lastLookupAt: row.lastLookupAt } : request.method === M.GET_PAGE_SUMMARY ?
      { recordId: row.record.recordId, revision: row.record.revision, anchor: row.record.anchor, hasCompletedAssistant: row.listItem.hasCompletedAssistant } : row.listItem;
    if (pages ? literalMatch(item, request.query) : request.method === M.GET_PAGE_SUMMARY || literalMatch(item, request.query)) {
      const size = byteLength(JSON.stringify(item)) + 1;
      if (items.length >= request.limit || bytes + size > L.listResponseBytes - 1024) { more = true; break; }
      items.push(item); bytes += size;
    }
    lastKey = current.key; current.continue();
  }
  const data = { items, ...(page ? { pageRecordCount: page.recordCount, pageRevision: page.pageRevision } : { catalogRevision: meta.catalogRevision }) };
  return { data, more, cursor: { identity, key: lastKey, catalogRevision: meta.catalogRevision, consentGeneration: meta.consentGeneration,
    dataGeneration: meta.dataGeneration, pageRevision: page?.pageRevision } };
}
