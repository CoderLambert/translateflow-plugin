import { sha256 } from "../hash.js";
import { READING_ERROR, READING_ITEM_KEY_VERSION, READING_LIMITS as L } from "./constants.js";
import { validateAnchor } from "./source.js";
import { fail, id, pageKey, text } from "./validation.js";

export function createReadingItemKey(selectedText, sourceLanguage) {
  const selected = text(selectedText, L.selectionChars, "selectedText").normalize("NFC").replace(/[\t\n\r\f ]+/gu, " ").trim();
  const language = text(sourceLanguage, L.languageChars, "sourceLanguage").trim();
  return `${READING_ITEM_KEY_VERSION}:${JSON.stringify([language, selected])}`;
}
export async function createSourceDigest(snapshot) {
  return sha256(JSON.stringify([snapshot.projectionVersion, snapshot.selectedText, snapshot.contextMode, snapshot.contextText]));
}
export function sameSelectionIdentity(left, right) {
  return Boolean(left && right && left.documentGeneration && Number.isSafeInteger(left.selectionGeneration) &&
    left.selectionGeneration > 0 && left.sourceDigest && left.documentGeneration === right.documentGeneration &&
    left.selectionGeneration === right.selectionGeneration && left.sourceDigest === right.sourceDigest);
}
export function sameProvenLocation(left, right) {
  let a, b;
  try {
    if (!left || !right || pageKey(left.pageKey, "left.pageKey") !== pageKey(right.pageKey, "right.pageKey") ||
        id(left.documentGeneration, "left.documentGeneration") !== id(right.documentGeneration, "right.documentGeneration")) return false;
    a = validateAnchor(left.anchor, "left.anchor");
    b = validateAnchor(right.anchor, "right.anchor");
  } catch { return false; }
  return Boolean(a.status === "resolved" && b.status === "resolved" &&
    a.blockDigest === b.blockDigest && a.quote.exact === b.quote.exact &&
    a.quote.prefix === b.quote.prefix && a.quote.suffix === b.quote.suffix &&
    a.position.start === b.position.start && a.position.end === b.position.end &&
    left.documentGeneration === right.documentGeneration);
}
export function assertArtifactSource(artifact, snapshot, token) {
  if (artifact.sourceSnapshotId !== snapshot.sourceSnapshotId || artifact.recordId !== token.recordId ||
      artifact.operationId !== token.operationId || snapshot.documentGeneration !== token.documentGeneration ||
      snapshot.selectionGeneration !== token.selectionGeneration) fail(READING_ERROR.STALE_OPERATION, "artifact.source");
  return true;
}
