import { READING_BACKUP_FILE_BYTES } from "./constants.js";
import { READING_ERROR, READING_LIMITS as L } from "./constants.js";
import { validateAnchor, validateSourceSnapshot } from "./source.js";
import { compareAssistantArtifacts, validateResultArtifact } from "./artifact.js";
import { createReadingItemKey } from "./identity.js";
import { applicationBytes } from "./lifecycle.js";
import { array, choice, fail, integer, jsonBytes, nullable, object, pageKey, recordId, safeReturnUrl, siteKey, text, version } from "./validation.js";

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
export function validatePreviewDetail(value, path = "previewDetail") {
  object(value, ["record", "snapshots", "artifacts", "related"], path);
  const primary = validateRecordDetail({ record: value.record, snapshots: value.snapshots, artifacts: value.artifacts }, path);
  const related = value.related === undefined ? [] : array(value.related, L.previewRelatedRecords,
    validatePreviewAssistantDetail, `${path}.related`);
  const ids = new Set([primary.record.recordId]);
  for (const item of related) {
    if (ids.has(item.record.recordId) || item.record.pageKey !== primary.record.pageKey || item.record.itemKey !== primary.record.itemKey ||
        !item.artifacts.length || item.artifacts.some(artifact => artifact.kind !== "assistant")) fail(READING_ERROR.BAD_DTO, `${path}.related`);
    ids.add(item.record.recordId);
  }
  return { ...primary, related };
}
export function validatePreviewAssistantDetail(value, path = "previewAssistantDetail") {
  object(value, ["record", "snapshots", "artifacts"], path);
  const record = validateReadingRecord(value.record, `${path}.record`);
  const snapshots = array(value.snapshots, L.previewAssistantArtifacts, validateSourceSnapshot, `${path}.snapshots`);
  const artifacts = array(value.artifacts, L.previewAssistantArtifacts, validateResultArtifact, `${path}.artifacts`);
  if (!snapshots.length || !artifacts.length || artifacts.some(artifact => artifact.kind !== "assistant")) {
    fail(READING_ERROR.BAD_DTO, path);
  }
  if (snapshots.some(snapshot => snapshot.selectedText !== record.itemText)) fail(READING_ERROR.BAD_DTO, `${path}.snapshots`);
  const snapshotIds = unique(snapshots, "sourceSnapshotId", path);
  unique(artifacts, "artifactId", path);
  unique(artifacts.map(artifact => artifact.payload), "turnId", path);
  for (const artifact of artifacts) {
    if (artifact.recordId !== record.recordId || !snapshotIds.has(artifact.sourceSnapshotId)) fail(READING_ERROR.BAD_DTO, `${path}.references`);
  }
  for (let index = 1; index < artifacts.length; index++) {
    if (compareAssistantArtifacts(artifacts[index - 1], artifacts[index]) > 0) fail(READING_ERROR.BAD_DTO, `${path}.order`);
  }
  return { record, snapshots, artifacts };
}
function unique(values, key, path) {
  const result = new Set(values.map((value) => value[key]));
  if (result.size !== values.length) fail(READING_ERROR.BAD_DTO, `${path}.${key}`);
  return result;
}

export function validateReadingExport(value) {
  jsonBytes(value, READING_BACKUP_FILE_BYTES, "export");
  object(value, ["format", "schemaVersion", "exportedAt", "records"], "export");
  const schemaVersion = choice(value.schemaVersion, [1, 2], "export.schemaVersion");
  const records = array(value.records, L.records, (item, path) => {
    if (schemaVersion === 1) return validateRecordDetail(item, path);
    object(item, ["siteKey", "record", "snapshots", "artifacts"], path);
    return { siteKey: siteKey(item.siteKey, `${path}.siteKey`), ...validateRecordDetail({ record: item.record, snapshots: item.snapshots, artifacts: item.artifacts }, path) };
  }, "export.records");
  unique(records.map((item) => item.record), "recordId", "export.records");
  const rows = records.flatMap((detail) => [detail.record, ...detail.snapshots, ...detail.artifacts]);
  if (applicationBytes(rows) > L.totalBytes) fail(READING_ERROR.LIMIT, "export.bytes");
  return { format: choice(value.format, ["translateflow-reading"], "export.format"),
    schemaVersion,
    exportedAt: integer(value.exportedAt, 0, Number.MAX_SAFE_INTEGER, "export.exportedAt"), records };
}
