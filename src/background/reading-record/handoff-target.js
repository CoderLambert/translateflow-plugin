import { state, pageState, policy, sitePolicy, E } from "./storage-state.js";
import { fail } from "../../shared/reading/validation.js";

// One readonly transaction checks the stored record and every policy generation.
// It never reads artifact bodies or updates lastViewedAt/lookupCount.
export function* readHandoffTarget(store, context) {
  const meta = yield* state(store);
  policy(meta, context);
  if (!meta.enabled) fail(E.DISABLED, "handoff.consent");
  const expected = context.handoffTarget;
  const recordId = expected?.recordId ?? context.request.recordId;
  const row = yield store("records").get(recordId);
  if (!row) fail(E.NOT_FOUND, "handoff.record");
  const record = row.record, site = sitePolicy(meta, row.siteKey);
  if (site.excluded) fail(E.DISABLED, "handoff.site");
  if (record.revision !== (expected?.recordRevision ?? context.request.expectedRevision)) fail(E.REVISION_CONFLICT, "handoff.revision");
  if (context.access.scope === "content" && (record.pageKey !== context.access.pageKey || row.siteKey !== context.access.siteKey)) fail(E.FORBIDDEN, "handoff.page");
  const page = yield* pageState(store, record.pageKey);
  const target = { recordId, recordRevision: record.revision, pageKey: record.pageKey, siteKey: row.siteKey,
    safeReturnUrl: record.safeReturnUrl, consentGeneration: meta.consentGeneration, dataGeneration: meta.dataGeneration,
    sitePolicyRevision: site.sitePolicyRevision, pageGeneration: page.pageGeneration,
    summary: { recordId, revision: record.revision, anchor: record.anchor, hasCompletedAssistant: row.listItem.hasCompletedAssistant } };
  if (expected) for (const key of ["recordId", "recordRevision", "pageKey", "siteKey", "safeReturnUrl", "consentGeneration", "dataGeneration", "sitePolicyRevision", "pageGeneration"]) {
    if (target[key] !== expected[key]) fail(E.STALE_OPERATION, "handoff.generations");
  }
  return target;
}
