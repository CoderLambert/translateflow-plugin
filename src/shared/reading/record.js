import { READING_ERROR, READING_LIMITS as L } from "./constants.js";
import { validateAnchor, validateSourceSnapshot } from "./source.js";
import { validateResultArtifact } from "./artifact.js";
import { createReadingItemKey } from "./identity.js";
import { applicationBytes } from "./lifecycle.js";
import { array, choice, fail, integer, jsonBytes, nullable, object, pageKey, recordId, safeReturnUrl, text, version } from "./validation.js";

export function validateReadingRecord(value, path = "record") {
  object(value, ["schemaVersion", "recordId", "revision", "itemKey", "itemText", "sourceLanguage", "pageKey",
    "safeReturnUrl", "pageTitle", "anchor", "firstSeenAt", "lastLookupAt", "lastViewedAt", "lookupCount"], path);
  const itemText = text(value.itemText, L.selectionChars, `${path}.itemText`);
  const sourceLanguage = text(value.sourceLanguage, L.languageChars, `${path}.sourceLanguage`);
  if (value.itemKey !== createReadingItemKey(itemText, sourceLanguage)) fail(READING_ERROR.BAD_DTO, `${path}.itemKey`);
  const firstSeenAt = integer(value.firstSeenAt, 0, Number.MAX_SAFE_INTEGER, `${path}.firstSeenAt`);
  const lastLookupAt = integer(value.lastLookupAt, firstSeenAt, Number.MAX_SAFE_INTEGER, `${path}.lastLookupAt`);
  const anchor = validateAnchor(value.anchor, `${path}.anchor`);
  if (anchor.quote.exact !== itemText) fail(READING_ERROR.BAD_DTO, `${path}.anchor`);
  return { schemaVersion: version(value.schemaVersion, `${path}.schemaVersion`),
    recordId: recordId(value.recordId, `${path}.recordId`),
    revision: integer(value.revision, 1, Number.MAX_SAFE_INTEGER, `${path}.revision`), itemKey: value.itemKey, itemText, sourceLanguage,
    pageKey: pageKey(value.pageKey, `${path}.pageKey`), safeReturnUrl: nullable(value.safeReturnUrl, safeReturnUrl, `${path}.safeReturnUrl`),
    pageTitle: text(value.pageTitle, L.titleChars, `${path}.pageTitle`, { empty: true }), anchor, firstSeenAt, lastLookupAt,
    lastViewedAt: nullable(value.lastViewedAt, (item, p) => integer(item, firstSeenAt, Number.MAX_SAFE_INTEGER, p), `${path}.lastViewedAt`),
    lookupCount: integer(value.lookupCount, 1, Number.MAX_SAFE_INTEGER, `${path}.lookupCount`) };
}
export function validateRecordDetail(value, path = "detail") {
  object(value, ["record", "snapshots", "artifacts"], path);
  const record = validateReadingRecord(value.record, `${path}.record`);
  const snapshots = array(value.snapshots, L.snapshotsPerRecord, validateSourceSnapshot, `${path}.snapshots`);
  const artifacts = array(value.artifacts, L.artifactsPerRecord, validateResultArtifact, `${path}.artifacts`);
  if (!snapshots.length || !artifacts.length) fail(READING_ERROR.BAD_DTO, path);
  if (snapshots.some((item) => item.selectedText !== record.itemText)) fail(READING_ERROR.BAD_DTO, `${path}.snapshots`);
  const snapshotIds = unique(snapshots, "sourceSnapshotId", path);
  unique(artifacts, "artifactId", path);
  for (const artifact of artifacts) {
    if (artifact.recordId !== record.recordId || !snapshotIds.has(artifact.sourceSnapshotId)) fail(READING_ERROR.BAD_DTO, `${path}.references`);
  }
  const turns = new Map(artifacts.filter((item) => item.kind === "assistant").map((item) => [item.payload.turnId, item]));
  if (turns.size !== artifacts.filter((item) => item.kind === "assistant").length) fail(READING_ERROR.BAD_DTO, `${path}.turns`);
  const threadSources = new Map(), threadActions = new Map();
  for (const artifact of turns.values()) {
    const threadId = artifact.payload.threadId;
    if (threadSources.has(threadId) && threadSources.get(threadId) !== artifact.sourceSnapshotId) {
      fail(READING_ERROR.BAD_DTO, `${path}.threadSource`);
    }
    threadSources.set(threadId, artifact.sourceSnapshotId);
    if (artifact.payload.action !== "follow-up") {
      const action = artifact.payload.action;
      if (threadActions.has(threadId) && threadActions.get(threadId) !== action) fail(READING_ERROR.BAD_DTO, `${path}.threadAction`);
      threadActions.set(threadId, action);
    }
    for (const reference of [artifact.payload.parentTurnId, artifact.payload.regenerationOf].filter(Boolean)) {
      const parent = turns.get(reference);
      if (!parent || parent.payload.threadId !== artifact.payload.threadId || parent.sourceSnapshotId !== artifact.sourceSnapshotId ||
          parent.createdAt > artifact.createdAt) fail(READING_ERROR.BAD_DTO, `${path}.turns`);
      if (reference === artifact.payload.regenerationOf && (parent.payload.parentTurnId !== null || artifact.payload.parentTurnId !== null)) {
        fail(READING_ERROR.BAD_DTO, `${path}.regenerationRoot`);
      }
      if ((reference === artifact.payload.parentTurnId && parent.payload.branchId !== artifact.payload.branchId) ||
          (reference === artifact.payload.regenerationOf && parent.payload.branchId === artifact.payload.branchId)) fail(READING_ERROR.BAD_DTO, `${path}.branch`);
    }
  }
  const visited = new Set(), visiting = new Set();
  function visit(turnId) {
    if (visiting.has(turnId)) fail(READING_ERROR.BAD_DTO, `${path}.turnCycle`);
    if (visited.has(turnId)) return;
    visiting.add(turnId);
    const payload = turns.get(turnId).payload;
    for (const reference of [payload.parentTurnId, payload.regenerationOf].filter(Boolean)) visit(reference);
    visiting.delete(turnId);
    visited.add(turnId);
  }
  for (const turnId of turns.keys()) visit(turnId);
  return { record, snapshots, artifacts };
}
function unique(values, key, path) {
  const result = new Set(values.map((value) => value[key]));
  if (result.size !== values.length) fail(READING_ERROR.BAD_DTO, `${path}.${key}`);
  return result;
}

export function validateReadingExport(value) {
  jsonBytes(value, L.totalBytes + 1024 * 1024, "export");
  object(value, ["format", "schemaVersion", "exportedAt", "records"], "export");
  const records = array(value.records, L.records, validateRecordDetail, "export.records");
  unique(records.map((item) => item.record), "recordId", "export.records");
  const rows = records.flatMap((detail) => [detail.record, ...detail.snapshots, ...detail.artifacts]);
  if (applicationBytes(rows) > L.totalBytes) fail(READING_ERROR.LIMIT, "export.bytes");
  return { format: choice(value.format, ["translateflow-reading"], "export.format"),
    schemaVersion: version(value.schemaVersion, "export.schemaVersion"),
    exportedAt: integer(value.exportedAt, 0, Number.MAX_SAFE_INTEGER, "export.exportedAt"), records };
}
