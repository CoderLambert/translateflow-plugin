import { READING_ERROR as E, READING_LIMITS as L } from "./constants.js";
import { validateAnchor } from "./source.js";
import { array, bool, choice, fail, id, integer, nullable, object, pageKey, recordId, safeReturnUrl, siteKey, text } from "./validation.js";

export function validatePageSummaryItem(value, path = "pageSummaryItem") {
  object(value, ["recordId", "revision", "anchor", "hasCompletedAssistant"], path);
  return { recordId: recordId(value.recordId, `${path}.recordId`), revision: revision(value.revision, `${path}.revision`),
    anchor: validateAnchor(value.anchor, `${path}.anchor`), hasCompletedAssistant: bool(value.hasCompletedAssistant, `${path}.hasCompletedAssistant`) };
}
export function validateResultPreview(value, path) {
  object(value, ["kind", "artifactId", "sourceSnapshotId", "targetLanguage", "text", "truncated"], path);
  return { kind: choice(value.kind, ["dictionary", "translation", "assistant"], `${path}.kind`),
    artifactId: id(value.artifactId, `${path}.artifactId`), sourceSnapshotId: id(value.sourceSnapshotId, `${path}.sourceSnapshotId`),
    targetLanguage: text(value.targetLanguage, L.languageChars, `${path}.targetLanguage`),
    text: text(value.text, L.resultPreviewChars, `${path}.text`), truncated: bool(value.truncated, `${path}.truncated`) };
}
function pageFields(value, path) {
  return { pageKey: pageKey(value.pageKey, `${path}.pageKey`), siteKey: siteKey(value.siteKey, `${path}.siteKey`),
    pageTitle: text(value.pageTitle, L.titleChars, `${path}.pageTitle`, { empty: true }),
    safeReturnUrl: nullable(value.safeReturnUrl, safeReturnUrl, `${path}.safeReturnUrl`) };
}
export function validateRecordListItem(value, path = "recordListItem") {
  object(value, ["recordId", "revision", "itemText", "sourceLanguage", "pageKey", "siteKey", "pageTitle", "safeReturnUrl",
    "firstSeenAt", "lastLookupAt", "lastViewedAt", "lookupCount", "resultPreview", "contextPreview", "assistantTurnCount", "hasCompletedAssistant", "locationCapability"], path);
  const firstSeenAt = integer(value.firstSeenAt, 0, Number.MAX_SAFE_INTEGER, `${path}.firstSeenAt`);
  const assistantTurnCount = integer(value.assistantTurnCount, 0, L.artifactsPerRecord, `${path}.assistantTurnCount`);
  const hasCompletedAssistant = bool(value.hasCompletedAssistant, `${path}.hasCompletedAssistant`);
  if ((value.resultPreview === null && value.contextPreview !== "") || hasCompletedAssistant !== (assistantTurnCount > 0)) fail(E.BAD_DTO, `${path}.hasCompletedAssistant`);
  return { recordId: recordId(value.recordId, `${path}.recordId`), revision: revision(value.revision, `${path}.revision`),
    itemText: text(value.itemText, L.selectionChars, `${path}.itemText`), sourceLanguage: text(value.sourceLanguage, L.languageChars, `${path}.sourceLanguage`),
    ...pageFields(value, path), firstSeenAt, lastLookupAt: integer(value.lastLookupAt, firstSeenAt, Number.MAX_SAFE_INTEGER, `${path}.lastLookupAt`),
    lastViewedAt: nullable(value.lastViewedAt, (item, p) => integer(item, firstSeenAt, Number.MAX_SAFE_INTEGER, p), `${path}.lastViewedAt`),
    lookupCount: integer(value.lookupCount, 1, Number.MAX_SAFE_INTEGER, `${path}.lookupCount`),
    resultPreview: nullable(value.resultPreview, validateResultPreview, `${path}.resultPreview`),
    contextPreview: text(value.contextPreview, L.contextPreviewChars, `${path}.contextPreview`, { empty: true }),
    assistantTurnCount, hasCompletedAssistant, locationCapability: choice(value.locationCapability, ["quote-and-position", "quote-only", "unsupported"], `${path}.locationCapability`) };
}
export function validatePageListItem(value, path = "pageListItem") {
  object(value, ["pageKey", "siteKey", "pageTitle", "safeReturnUrl", "recordCount", "lastLookupAt"], path);
  return { ...pageFields(value, path), recordCount: integer(value.recordCount, 1, L.records, `${path}.recordCount`),
    lastLookupAt: integer(value.lastLookupAt, 0, Number.MAX_SAFE_INTEGER, `${path}.lastLookupAt`) };
}
export function validateExclusionItem(value, path = "exclusionItem") {
  object(value, ["siteKey", "excluded", "sitePolicyRevision"], path);
  return { siteKey: siteKey(value.siteKey, `${path}.siteKey`), excluded: choice(value.excluded, [true], `${path}.excluded`),
    sitePolicyRevision: revision(value.sitePolicyRevision, `${path}.sitePolicyRevision`) };
}
export function revision(value, path) { return integer(value, 1, Number.MAX_SAFE_INTEGER, path); }
export function validateListPage(value, validator, key, limit, extra, path = "data") {
  object(value, ["items", "nextCursor", ...Object.keys(extra)], path);
  integer(limit, 1, L.pageSize, "response.pageLimit");
  const items = array(value.items, limit, validator, `${path}.items`);
  const nextCursor = nullable(value.nextCursor, (item, p) => text(item, L.cursorChars, p), `${path}.nextCursor`);
  if ((!items.length && nextCursor !== null) || new Set(items.map((item) => item[key])).size !== items.length) fail(E.BAD_DTO, `${path}.items`);
  return { items, nextCursor, ...Object.fromEntries(Object.entries(extra).map(([name, validate]) => [name, validate(value[name], `${path}.${name}`)])) };
}
