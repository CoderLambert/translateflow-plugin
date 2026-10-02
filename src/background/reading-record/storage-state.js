import { READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "../../shared/reading/constants.js";
import { authorizeReadingMethod, applicationBytes } from "../../shared/reading/lifecycle.js";
import { fail } from "../../shared/reading/validation.js";
import { validateRecordDetail } from "../../shared/reading/record.js";
import { collect, only } from "./idb.js";

export const initialMeta = () => ({ enabled: false, consentGeneration: 1, dataGeneration: 1, catalogRevision: 1, exportRevision: 1,
  siteRevision: 1, sites: [], recordCount: 0, totalBytes: 0 });
export function sitePolicy(meta, origin) {
  return meta.sites.find((site) => site.siteKey === origin) || { siteKey: origin, excluded: false, sitePolicyRevision: meta.siteRevision };
}
export function authority(context) {
  context.assertCurrent();
  const access = context.access;
  if (!access || access.senderVerified !== true || access.incognito !== false || access.sensitive !== false ||
      access.accountPage !== false || access.editable !== false || !access.ownerKey || !["content", "extension"].includes(access.scope)) fail(E.FORBIDDEN, "repository.authority");
  if (context.request) authorizeReadingMethod(context.request.method, access, access.scope === "content" ? access.pageKey : null);
}
export function policy(meta, context, { write = false, siteRead = false } = {}) {
  authority(context);
  const site = sitePolicy(meta, context.access.siteKey);
  if (context.access.scope === "content" && site.excluded && !siteRead) fail(E.DISABLED, "recording.site");
  if (write && !meta.enabled) fail(E.DISABLED, "recording.consent");
  return site;
}
export function* state(store) { return (yield store("meta").get("state")) || initialMeta(); }
export function* pageState(store, pageKey) {
  return (yield store("pages").get(pageKey)) || { pageKey, pageGeneration: 1, pageRevision: 1, recordCount: 0, lastLookupAt: 0 };
}
export function recordingState(meta, scope) {
  const result = { enabled: meta.enabled, consentGeneration: meta.consentGeneration,
    capacityReached: meta.recordCount === L.records || meta.totalBytes === L.totalBytes };
  return scope === "content" ? result : { ...result, dataGeneration: meta.dataGeneration, recordCount: meta.recordCount, totalBytes: meta.totalBytes };
}
export function changed(meta, page = null, catalog = true) {
  meta.exportRevision++;
  if (catalog) meta.catalogRevision++;
  if (page) page.pageRevision++;
}
export function* detail(store, recordId, row = null) {
  row ||= yield store("records").get(recordId);
  if (!row) fail(E.NOT_FOUND, "record");
  const snapshots = yield* collect(store("snapshots"), only(recordId), "record", L.snapshotsPerRecord + 1);
  const artifacts = yield* collect(store("artifacts"), only(recordId), "record", L.artifactsPerRecord + 1);
  return validateRecordDetail({ record: row.record, snapshots: snapshots.map((item) => item.value), artifacts: artifacts.map((item) => item.value) });
}
export function receiptKey(access, operationId) { return JSON.stringify([access.ownerKey, operationId]); }
export function* pruneAuxiliary(store, meta, now) {
  const before = meta.sites.length;
  meta.sites = meta.sites.filter((site) => site.excluded || site.expiresAt > now);
  if (meta.sites.length !== before) meta.siteRevision++;
  const request = store("pages").index("expires").openCursor();
  for (let cursor = yield request; cursor && cursor.value.expiresAt <= now; cursor = yield request) {
    if (!cursor.value.recordCount) yield cursor.delete();
    cursor.continue();
  }
}
export function retainSite(meta, origin, expiresAt) {
  let site = meta.sites.find((item) => item.siteKey === origin);
  if (!site) {
    if (meta.sites.length >= L.exclusionSites + L.operationsGlobal) fail(E.CAPACITY, "site.metadata");
    site = { ...sitePolicy(meta, origin), expiresAt }; meta.sites.push(site);
  } else if (!site.excluded) site.expiresAt = Math.max(site.expiresAt || 0, expiresAt);
  return site;
}
export function* pruneReceipts(store, now) {
  const request = store("receipts").index("expires").openCursor();
  for (let cursor = yield request; cursor && cursor.value.expiresAt <= now; cursor = yield request) {
    yield cursor.delete(); cursor.continue();
  }
}
export function tokenCurrent(token, meta, site, page, context, now) {
  policy(meta, context, { write: true });
  if (now < token.issuedAt || now >= token.expiresAt || token.consentGeneration !== meta.consentGeneration ||
      token.sitePolicyRevision !== site.sitePolicyRevision || token.dataGeneration !== meta.dataGeneration || token.pageGeneration !== page.pageGeneration ||
      token.pageKey !== context.access.pageKey || token.documentGeneration !== context.access.documentGeneration ||
      token.selectionGeneration !== context.access.selectionGeneration) fail(E.STALE_OPERATION, "operation.generations");
}
export function* deleteRows(store, row) {
  for (const name of ["snapshots", "artifacts"]) {
    const request = store(name).index("record").openCursor(only(row.record.recordId));
    for (let cursor = yield request; cursor; cursor = yield request) { yield cursor.delete(); cursor.continue(); }
  }
  yield store("records").delete(row.record.recordId);
  return row.bytes;
}
export function* rebuildPage(store, page) {
  let count = 0, latest = null;
  const request = store("records").index("page").openCursor(only(page.pageKey));
  for (let cursor = yield request; cursor; cursor = yield request) {
    count++; if (!latest || cursor.value.record.lastLookupAt > latest.record.lastLookupAt) latest = cursor.value;
    cursor.continue();
  }
  Object.assign(page, { recordCount: count, lastLookupAt: latest?.record.lastLookupAt || 0 });
  if (latest) Object.assign(page, { siteKey: latest.siteKey, pageTitle: latest.record.pageTitle, safeReturnUrl: latest.record.safeReturnUrl });
  if (latest) page.sortTime = -latest.record.lastLookupAt; else delete page.sortTime;
  return page;
}
export { applicationBytes, M, E, L };
