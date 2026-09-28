import { sha256 } from "./hash.js";
import { normalizeLexicalExactKey } from "./lexical.js";
import { normalizeSelectionDepth } from "./selection.js";

export const SELECTION_EXPLAIN_PROTOCOL_VERSION = "selection-explain-v1";
export const SELECTION_EXPLAIN_PROMPT_VERSION = "selection-explain-prompt-v1";
export const SELECTION_EXPLAIN_SCHEMA_VERSION = 1;
export const SELECTION_EXPLAIN_LIMITS = Object.freeze({
  selectionChars: 2000,
  contextChars: 900,
  candidates: 8,
  factChars: 240,
  factsPerField: 6,
  sourceRefs: 4,
  explanationChars: 1600,
  translationChars: 600
});

const CANDIDATE_KEYS = new Set([
  "id", "kind", "headword", "aliases", "matchedBy", "queryForm", "exactCaseMatch",
  "provenance", "senseId", "entityId", "partOfSpeech", "senseNumber", "tagCount",
  "translations", "domains", "typeLabels", "ranking"
]);
const PROVENANCE_KEYS = new Set(["packId", "packVersion", "fingerprint", "sourceRefs"]);
const SOURCE_REF_KEYS = new Set(["sourceId", "recordId"]);
const RESPONSE_KEYS = new Set(["selectedCandidateIds", "explanation", "translation"]);

export function buildSelectionExplainPayload(input = {}) {
  const sensitive = Boolean(input.sensitive);
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  if (candidates.length > SELECTION_EXPLAIN_LIMITS.candidates) fail("too many candidates");

  return {
    schemaVersion: SELECTION_EXPLAIN_SCHEMA_VERSION,
    selectionText: required(input.selectionText, "selectionText", SELECTION_EXPLAIN_LIMITS.selectionChars),
    contextText: sensitive ? "" : optional(input.contextText, "contextText", SELECTION_EXPLAIN_LIMITS.contextChars),
    sensitive,
    depth: normalizeSelectionDepth(input.depth),
    targetLanguage: required(input.targetLanguage || "Simplified Chinese", "targetLanguage", 80),
    candidates: candidates.map(sanitizeCandidate)
  };
}

export function parseSelectionExplainResult(value, { candidateIds = [] } = {}) {
  const parsed = parseJsonValue(value);
  if (!plain(parsed)) fail("response must be an object");
  onlyKeys(parsed, RESPONSE_KEYS, "response");
  if (!Array.isArray(parsed.selectedCandidateIds)) fail("selectedCandidateIds must be an array");

  const allowed = new Set(candidateIds.map(String));
  const selected = [];
  for (const rawId of parsed.selectedCandidateIds) {
    const id = required(rawId, "selectedCandidateId", 180);
    if (!allowed.has(id)) fail("unknown candidate id");
    if (!selected.includes(id)) selected.push(id);
  }
  if (selected.length > 3) fail("too many selected candidate ids");

  return Object.freeze({
    selectedCandidateIds: Object.freeze(selected),
    explanation: required(parsed.explanation, "explanation", SELECTION_EXPLAIN_LIMITS.explanationChars),
    translation: optional(parsed.translation, "translation", SELECTION_EXPLAIN_LIMITS.translationChars)
  });
}

export async function buildSelectionExplainCacheIdentity({
  provider,
  model,
  endpoint = "",
  targetLanguage,
  payload
} = {}) {
  const normalized = buildSelectionExplainPayload(payload);
  const lexicalPacks = [...new Map(normalized.candidates.map((candidate) => {
    const p = candidate.provenance;
    const key = [p.packId, p.packVersion, p.fingerprint].join("|");
    return [key, { packId: p.packId, packVersion: p.packVersion, fingerprint: p.fingerprint }];
  })).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  const identity = {
    protocolVersion: SELECTION_EXPLAIN_PROTOCOL_VERSION,
    promptVersion: SELECTION_EXPLAIN_PROMPT_VERSION,
    schemaVersion: SELECTION_EXPLAIN_SCHEMA_VERSION,
    provider: String(provider || "").trim(),
    model: String(model || "").trim(),
    endpoint: String(endpoint || "").trim(),
    targetLanguage: String(targetLanguage || normalized.targetLanguage || "").trim(),
    depth: normalized.depth,
    selectionDigest: await sha256(normalizeLexicalExactKey(normalized.selectionText)),
    contextDigest: await sha256(normalized.contextText),
    candidateDigest: await sha256(JSON.stringify(normalized.candidates)),
    lexicalPacks
  };
  return {
    cacheKey: "selection-explain:" + await sha256(JSON.stringify(identity)),
    identity,
    payload: normalized
  };
}

function sanitizeCandidate(candidate, index) {
  if (!plain(candidate)) fail(`candidate[${index}] must be an object`);
  onlyKeys(candidate, CANDIDATE_KEYS, `candidate[${index}]`);
  const provenance = sanitizeProvenance(candidate.provenance, index);
  const result = {
    id: required(candidate.id, "candidate.id", 180),
    kind: required(candidate.kind || "lexical", "candidate.kind", 60),
    headword: required(candidate.headword, "candidate.headword", 240),
    matchedBy: optional(candidate.matchedBy, "candidate.matchedBy", 40),
    partOfSpeech: optional(candidate.partOfSpeech, "candidate.partOfSpeech", 60),
    senseId: optional(candidate.senseId, "candidate.senseId", 120),
    entityId: optional(candidate.entityId, "candidate.entityId", 120),
    translations: stringArray(candidate.translations, "candidate.translations"),
    domains: stringArray(candidate.domains, "candidate.domains"),
    typeLabels: stringArray(candidate.typeLabels, "candidate.typeLabels"),
    provenance
  };
  if (candidate.ranking !== undefined) {
    if (!plain(candidate.ranking) || !Number.isFinite(Number(candidate.ranking.score))) {
      fail("candidate.ranking is invalid");
    }
    result.rankScore = Number(candidate.ranking.score);
  }
  return result;
}

function sanitizeProvenance(value, index) {
  if (!plain(value)) fail(`candidate[${index}].provenance must be an object`);
  onlyKeys(value, PROVENANCE_KEYS, "provenance");
  const refs = Array.isArray(value.sourceRefs) ? value.sourceRefs : [];
  if (refs.length > SELECTION_EXPLAIN_LIMITS.sourceRefs) fail("too many sourceRefs");
  return {
    packId: required(value.packId, "provenance.packId", 100),
    packVersion: optional(value.packVersion, "provenance.packVersion", 120),
    fingerprint: optional(value.fingerprint, "provenance.fingerprint", 180),
    sourceRefs: refs.map((ref) => {
      if (!plain(ref)) fail("sourceRef must be an object");
      onlyKeys(ref, SOURCE_REF_KEYS, "sourceRef");
      return {
        sourceId: required(ref.sourceId, "sourceRef.sourceId", 100),
        recordId: required(ref.recordId, "sourceRef.recordId", 180)
      };
    })
  };
}

function stringArray(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  if (value.length > SELECTION_EXPLAIN_LIMITS.factsPerField) fail(`${label} has too many values`);
  return value.map((item) => required(item, label, SELECTION_EXPLAIN_LIMITS.factChars));
}

function required(value, label, max) {
  const text = normalizeLexicalExactKey(value);
  if (!text) fail(`${label} is required`);
  if (text.length > max) fail(`${label} exceeds ${max} characters`);
  return text;
}

function optional(value, label, max) {
  if (value === undefined || value === null || value === "") return "";
  const text = normalizeLexicalExactKey(value);
  if (text.length > max) fail(`${label} exceeds ${max} characters`);
  return text;
}

function parseJsonValue(value) {
  if (plain(value)) return value;
  const text = String(value || "").trim().replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  fail("response is not valid JSON");
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} contains unexpected field: ${key}`);
}

function fail(message) {
  const error = new Error(message);
  error.code = "SELECTION_EXPLAIN_PROTOCOL";
  throw error;
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
