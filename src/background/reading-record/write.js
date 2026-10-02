import { bound } from "./idb.js";
import { sha256 } from "../../shared/hash.js";
import { createReadingItemKey, createSourceDigest, sameProvenLocation, assertArtifactSource } from "../../shared/reading/identity.js";
import { validateOperationToken, checkCapacity } from "../../shared/reading/lifecycle.js";
import { validateSourceSnapshot } from "../../shared/reading/source.js";
import { validateResultArtifact } from "../../shared/reading/artifact.js";
import { validateRecordDetail } from "../../shared/reading/record.js";
import { projectRecordListItem } from "../../shared/reading/previews.js";
import { fail } from "../../shared/reading/validation.js";
import { state, pageState, policy, tokenCurrent, receiptKey, pruneReceipts, pruneAuxiliary, retainSite, detail, changed, applicationBytes, E, L } from "./storage-state.js";

export function* prepare(store, context, now, newId) {
  const meta = yield* state(store);
  yield* pruneAuxiliary(store, meta, now);
  const site = policy(meta, context), page = yield* pageState(store, context.access.pageKey);
  const { request, access, sourceSnapshot, previous, issuedAt, expiresAt } = context;
  if (!meta.enabled) return { state: "disabled" };
  let record = null;
  if (request.recordId !== null) {
    const row = yield store("records").get(request.recordId);
    if (!row) fail(E.NOT_FOUND, "operation.record");
    record = row.record;
    if (!previous && record.revision !== request.recordRevision) fail(E.REVISION_CONFLICT, "operation.record");
    if (record.itemText !== request.itemText || record.sourceLanguage !== request.sourceLanguage || !sameProvenLocation(
      { pageKey: record.pageKey, documentGeneration: row.documentGeneration, anchor: record.anchor },
      { pageKey: access.pageKey, documentGeneration: sourceSnapshot.documentGeneration, anchor: sourceSnapshot.anchor })) fail(E.STALE_OPERATION, "operation.location");
  }
  if (previous) {
    tokenCurrent(previous, meta, site, page, context, now);
    return { state: "ready", token: previous };
  }
  retainSite(meta, access.siteKey, expiresAt);
  if (!(yield store("pages").get(access.pageKey)) && (yield store("pages").count()) >= L.records + L.operationsGlobal) fail(E.CAPACITY, "page.metadata");
  if (!page.recordCount) page.expiresAt = Math.max(page.expiresAt || 0, expiresAt);
  yield store("pages").put(page); yield store("meta").put(meta, "state");
  return { state: "ready", token: validateOperationToken({ operationId: request.operationId, purpose: request.purpose,
    consentGeneration: meta.consentGeneration, sitePolicyRevision: site.sitePolicyRevision, dataGeneration: meta.dataGeneration,
    pageGeneration: page.pageGeneration, pageKey: access.pageKey, documentGeneration: sourceSnapshot.documentGeneration,
    selectionGeneration: sourceSnapshot.selectionGeneration, recordId: record?.recordId || newId,
    recordRevision: record?.revision || 0, issuedAt, expiresAt }) };
}
export async function validatedWrite(context) {
  const op = context.registeredOperation;
  if (!op || op.revoked || op.access.ownerKey !== context.access.ownerKey || op.access.navigationGeneration !== context.access.navigationGeneration) fail(E.STALE_OPERATION, "operation.registration");
  const token = validateOperationToken(context.request.token), snapshot = validateSourceSnapshot(op.sourceSnapshot), artifact = validateResultArtifact(context.request.artifact);
  if (JSON.stringify(token) !== JSON.stringify(op.token)) fail(E.STALE_OPERATION, "operation.registration");
  assertArtifactSource(artifact, snapshot, token);
  const [digest, sourceDigest, tokenDigest] = await Promise.all([sha256(JSON.stringify(artifact)), createSourceDigest(snapshot), sha256(JSON.stringify(token))]);
  if (digest !== context.artifactDigest || sourceDigest !== snapshot.sourceDigest) fail(E.BAD_DTO, "operation.digest");
  return { token, snapshot, artifact, digest, tokenDigest, op };
}
export function* append(store, context, input, now) {
  const { token, snapshot, artifact, digest, tokenDigest, op } = input;
  const meta = yield* state(store), site = policy(meta, context, { write: true }), page = yield* pageState(store, token.pageKey);
  tokenCurrent(token, meta, site, page, context, now);
  context.assertCurrent(); if (op.revoked) fail(E.STALE_OPERATION, "operation.revoked");
  yield* pruneReceipts(store, now);
  const key = receiptKey(context.access, token.operationId);
  let receipt = yield store("receipts").get(key);
  if (receipt && (receipt.tokenDigest !== tokenDigest || receipt.cancelled)) fail(E.STALE_OPERATION, "operation.receipt");
  const original = receipt?.artifacts.find((item) => item.artifactId === artifact.artifactId);
  if (original) {
    if (original.digest !== digest) fail(E.BAD_DTO, "artifact.immutable");
    if (!(yield store("records").get(token.recordId))) fail(E.STALE_OPERATION, "record.deleted");
    return { ...original.saved, duplicate: true };
  }
  if (!receipt && (yield store("receipts").count()) >= L.operationsGlobal) fail(E.CAPACITY, "receipts");
  let row = yield store("records").get(token.recordId), old = null;
  const expectedRevision = receipt?.lastRevision ?? token.recordRevision;
  if ((row?.record.revision || 0) !== expectedRevision) fail(E.REVISION_CONFLICT, "record.revision");
  if (!row && token.recordRevision !== 0) fail(E.STALE_OPERATION, "record.deleted");
  if (row) {
    if (row.record.pageKey !== token.pageKey || row.record.itemText !== snapshot.selectedText || row.record.sourceLanguage !== op.sourceLanguage) fail(E.STALE_OPERATION, "record.source");
    old = yield* detail(store, token.recordId, row);
  }
  const existingSnapshot = old?.snapshots.find((item) => item.sourceSnapshotId === snapshot.sourceSnapshotId);
  if (existingSnapshot && JSON.stringify(existingSnapshot) !== JSON.stringify(snapshot)) fail(E.BAD_DTO, "snapshot.immutable");
  if (old?.artifacts.some((item) => item.artifactId === artifact.artifactId)) fail(E.BAD_DTO, "artifact.immutable");
  const counted = artifact.kind !== "assistant" && !receipt?.lookupCounted;
  const record = row ? { ...row.record, revision: row.record.revision + 1,
    lookupCount: row.record.lookupCount + (counted ? 1 : 0), lastLookupAt: counted ? Math.max(row.record.lastLookupAt, now) : row.record.lastLookupAt } : {
    schemaVersion: 1, recordId: token.recordId, revision: 1, itemKey: createReadingItemKey(snapshot.selectedText, op.sourceLanguage),
    itemText: snapshot.selectedText, sourceLanguage: op.sourceLanguage, pageKey: token.pageKey, safeReturnUrl: context.access.safeReturnUrl,
    pageTitle: context.access.pageTitle, anchor: snapshot.anchor, firstSeenAt: now, lastLookupAt: now, lastViewedAt: null, lookupCount: 1 };
  const next = validateRecordDetail({ record, snapshots: [...(old?.snapshots || []), ...(existingSnapshot ? [] : [snapshot])], artifacts: [...(old?.artifacts || []), artifact] });
  const bytes = applicationBytes([next.record, ...next.snapshots, ...next.artifacts]), addedBytes = bytes - (row?.bytes || 0);
  const capacity = checkCapacity({ recordCount: meta.recordCount, totalBytes: meta.totalBytes, addedRecords: row ? 0 : 1, addedBytes });
  const saved = { state: "saved", recordId: record.recordId, revision: record.revision, artifactId: artifact.artifactId, duplicate: false };
  receipt ||= { key, tokenDigest, expiresAt: token.expiresAt, cancelled: false, lookupCounted: false, artifacts: [] };
  if (receipt.artifacts.length >= L.artifactsPerRecord) fail(E.CAPACITY, "receipts.artifacts");
  receipt.artifacts.push({ artifactId: artifact.artifactId, digest, saved });
  receipt.lookupCounted ||= counted; receipt.lastRevision = record.revision; receipt.committed = saved;
  yield store("receipts").put(receipt);
  if (!existingSnapshot) yield store("snapshots").add({ recordId: record.recordId, value: snapshot });
  yield store("artifacts").add({ recordId: record.recordId, value: artifact });
  yield store("records").put({ record: next.record, siteKey: context.access.siteKey, documentGeneration: row?.documentGeneration || snapshot.documentGeneration,
    bytes, sortTime: -record.lastLookupAt, listItem: projectRecordListItem(next, context.access.siteKey) });
  if (!row) page.recordCount++;
  delete page.expiresAt;
  const latest = (yield store("records").index("pageRecent").openCursor(bound([token.pageKey, -Number.MAX_SAFE_INTEGER, ""], [token.pageKey, 0, "\uffff"]))).value;
  Object.assign(page, { siteKey: latest.siteKey, pageTitle: latest.record.pageTitle, safeReturnUrl: latest.record.safeReturnUrl, lastLookupAt: latest.record.lastLookupAt });
  page.sortTime = -page.lastLookupAt;
  Object.assign(meta, capacity); changed(meta, page);
  yield store("pages").put(page); yield store("meta").put(meta, "state");
  return saved;
}
export async function cancellationInput(context) { return sha256(JSON.stringify(context.registeredOperation.token)); }
export function* cancel(store, context, tokenDigest, now) {
  policy(yield* state(store), context, { siteRead: true });
  const token = context.registeredOperation.token, key = receiptKey(context.access, token.operationId);
  if (now >= token.expiresAt || context.registeredOperation.access.ownerKey !== context.access.ownerKey) fail(E.STALE_OPERATION, "cancel.operation");
  yield* pruneReceipts(store, now);
  let receipt = yield store("receipts").get(key);
  if (receipt && receipt.tokenDigest !== tokenDigest) fail(E.STALE_OPERATION, "cancel.operation");
  if (!receipt && (yield store("receipts").count()) >= L.operationsGlobal) fail(E.CAPACITY, "receipts");
  receipt ||= { key, tokenDigest, expiresAt: token.expiresAt, lookupCounted: false, artifacts: [] };
  receipt.cancelled = true; yield store("receipts").put(receipt);
  return { operationId: token.operationId, state: receipt.committed ? "committed" : "cancelled",
    recordId: receipt.committed?.recordId || null, revision: receipt.committed?.revision || null };
}
