import { validateRecordDetail } from "./record.js";
import { validateRecordListItem } from "./list.js";
import { READING_LIMITS as L } from "./constants.js";

function prefix(value, limit) {
  let end = Math.min(value.length, limit);
  if (end && /[\uD800-\uDBFF]/u.test(value[end - 1])) end--;
  return value.slice(0, end);
}
// Repository projection, never a request to download all details from the UI.
// Stored evidence describes saved location capability, not current DOM resolution.
export function projectRecordListItem(detailValue, siteKey) {
  const detail = validateRecordDetail(detailValue);
  const { schemaVersion, itemKey, anchor, ...record } = detail.record;
  const latest = [...detail.artifacts].sort((a, b) => b.createdAt - a.createdAt || (a.artifactId < b.artifactId ? 1 : a.artifactId > b.artifactId ? -1 : 0))[0];
  let resultPreview = null, contextPreview = "";
  if (latest) {
    const text = latest.kind === "dictionary" ? latest.payload.outcome === "no-hit" ? "No dictionary result" : latest.payload.definitions.join("; ")
      : latest.kind === "translation" ? latest.payload.text : latest.payload.assistantAnswer;
    resultPreview = { kind: latest.kind, artifactId: latest.artifactId, sourceSnapshotId: latest.sourceSnapshotId,
      targetLanguage: latest.targetLanguage, text: prefix(text, L.resultPreviewChars), truncated: text.length > L.resultPreviewChars };
    contextPreview = prefix(detail.snapshots.find((item) => item.sourceSnapshotId === latest.sourceSnapshotId).contextText, L.contextPreviewChars);
  }
  const assistantTurnCount = detail.artifacts.filter((item) => item.kind === "assistant").length;
  return validateRecordListItem({ ...record, siteKey, resultPreview, contextPreview, assistantTurnCount,
    hasCompletedAssistant: assistantTurnCount > 0,
    locationCapability: anchor.position ? "quote-and-position" : anchor.quote.exact ? "quote-only" : "unsupported" });
}
