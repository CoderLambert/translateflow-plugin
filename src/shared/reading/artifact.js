import { READING_ERROR, READING_LIMITS as L } from "./constants.js";
import { array, choice, fail, id, integer, jsonBytes, nullable, object, recordId, text, version } from "./validation.js";

export function validateResultArtifact(value, path = "artifact") {
  jsonBytes(value, L.artifactBytes, path);
  object(value, ["schemaVersion", "artifactId", "recordId", "operationId", "sourceSnapshotId", "kind",
    "targetLanguage", "createdAt", "payload", "provenance"], path);
  const kind = choice(value.kind, ["dictionary", "translation", "assistant"], `${path}.kind`);
  const payload = kind === "dictionary" ? dictionary(value.payload, `${path}.payload`)
    : kind === "assistant" ? assistant(value.payload, `${path}.payload`)
      : translation(value.payload, `${path}.payload`);
  const provenance = kind === "dictionary"
    ? array(value.provenance, L.provenanceEntries, dictionarySource, `${path}.provenance`)
    : providerSource(value.provenance, `${path}.provenance`);
  if (kind === "dictionary" && payload.outcome === "hit" && !provenance.length) fail(READING_ERROR.BAD_DTO, `${path}.provenance`);
  return {
    schemaVersion: version(value.schemaVersion, `${path}.schemaVersion`),
    artifactId: id(value.artifactId, `${path}.artifactId`), recordId: recordId(value.recordId, `${path}.recordId`),
    operationId: id(value.operationId, `${path}.operationId`), sourceSnapshotId: id(value.sourceSnapshotId, `${path}.sourceSnapshotId`),
    kind, targetLanguage: text(value.targetLanguage, L.languageChars, `${path}.targetLanguage`),
    createdAt: integer(value.createdAt, 0, Number.MAX_SAFE_INTEGER, `${path}.createdAt`), payload, provenance
  };
}
function dictionary(value, path) {
  object(value, ["outcome", "headword", "phonetic", "partOfSpeech", "definitions"], path);
  const outcome = choice(value.outcome, ["hit", "no-hit"], `${path}.outcome`);
  const definitions = array(value.definitions, L.dictionaryEntries,
    (entry, p) => text(entry, L.definitionChars, p), `${path}.definitions`);
  if ((outcome === "hit" && !definitions.length) || (outcome === "no-hit" && definitions.length)) fail(READING_ERROR.BAD_DTO, `${path}.definitions`);
  return { outcome, headword: text(value.headword, L.selectionChars, `${path}.headword`),
    phonetic: text(value.phonetic, L.phoneticChars, `${path}.phonetic`, { empty: true }),
    partOfSpeech: text(value.partOfSpeech, L.partOfSpeechChars, `${path}.partOfSpeech`, { empty: true }), definitions };
}
function translation(value, path) {
  object(value, ["text"], path);
  return { text: text(value.text, L.answerChars, `${path}.text`) };
}
function assistant(value, path) {
  object(value, ["userQuestion", "assistantAnswer", "action", "threadId", "turnId", "parentTurnId",
    "branchId", "regenerationOf", "completionStatus"], path);
  const turnId = id(value.turnId, `${path}.turnId`);
  const parentTurnId = nullable(value.parentTurnId, id, `${path}.parentTurnId`);
  const regenerationOf = nullable(value.regenerationOf, id, `${path}.regenerationOf`);
  if (parentTurnId === turnId || regenerationOf === turnId || (parentTurnId && regenerationOf) ||
      (value.action === "follow-up" && (!parentTurnId || regenerationOf)) || (value.action !== "follow-up" && parentTurnId)) fail(READING_ERROR.BAD_DTO, path);
  return { userQuestion: text(value.userQuestion, L.questionChars, `${path}.userQuestion`),
    assistantAnswer: text(value.assistantAnswer, L.answerChars, `${path}.assistantAnswer`),
    action: choice(value.action, ["understand", "analyze", "usage", "follow-up"], `${path}.action`),
    threadId: id(value.threadId, `${path}.threadId`), turnId, parentTurnId,
    branchId: id(value.branchId, `${path}.branchId`), regenerationOf,
    completionStatus: choice(value.completionStatus, ["completed"], `${path}.completionStatus`) };
}
function dictionarySource(value, path) {
  object(value, ["sourceId", "packId", "packVersion", "sourceEntryId"], path);
  return { sourceId: id(value.sourceId, `${path}.sourceId`), packId: id(value.packId, `${path}.packId`),
    packVersion: text(value.packVersion, L.packVersionChars, `${path}.packVersion`), sourceEntryId: text(value.sourceEntryId, L.sourceEntryChars, `${path}.sourceEntryId`) };
}
function providerSource(value, path) {
  object(value, ["provider", "model", "promptVersion", "providerConfigFingerprint"], path);
  return { provider: id(value.provider, `${path}.provider`), model: text(value.model, L.modelChars, `${path}.model`),
    promptVersion: id(value.promptVersion, `${path}.promptVersion`),
    providerConfigFingerprint: text(value.providerConfigFingerprint, L.providerFingerprintChars, `${path}.providerConfigFingerprint`) };
}
