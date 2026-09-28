import {
  LEXICAL_ERROR_CODES,
  LEXICAL_RESULT_STATUS,
  isLexicalPhrase,
  normalizeLexicalExactKey,
  normalizeLexicalKey,
  normalizeLexicalLookupForm
} from "../../shared/lexical.js";
import {
  buildContextPhraseLookupResult,
  resolveContextPhraseMatch
} from "./context-phrase.js";


export function createLexicalGateway({
  packReaders = [],
  resolveGlossary = async () => [],
  maxPhraseEvidenceTokens = 4
} = {}) {
  if (!Array.isArray(packReaders)) throw new Error("packReaders must be an array");
  if (typeof resolveGlossary !== "function") throw new Error("resolveGlossary must be a function");

  async function lookup({
    text,
    pageUrl = "",
    contextText = "",
    sourceLanguage = "en",
    targetLanguage = "zh-CN"
  } = {}) {
    const queryText = normalizeLexicalExactKey(text);
    if (sourceLanguage !== "en" || targetLanguage !== "zh-CN") {
      return {
        status: LEXICAL_RESULT_STATUS.UNSUPPORTED,
        query: makeQuery(queryText, sourceLanguage, targetLanguage),
        supported: { sourceLanguages: ["en"], targetLanguages: ["zh-CN"] }
      };
    }
    if (!queryText) {
      return { status: LEXICAL_RESULT_STATUS.NO_HIT, query: makeQuery(queryText, sourceLanguage, targetLanguage) };
    }

    try {
      const glossary = await resolveGlossary(pageUrl);
      const override = findGlossaryOverride(queryText, glossary);
      if (override) {
        return {
          status: LEXICAL_RESULT_STATUS.CANDIDATES,
          query: makeQuery(queryText, sourceLanguage, targetLanguage),
          override: true,
          matchedBy: "user-glossary",
          candidates: [glossaryCandidate(override)]
        };
      }

      const normalizedText = normalizeLexicalLookupForm(queryText);
      const normalizationApplied = normalizedText && normalizedText !== queryText;
      const lexicalText = normalizedText || queryText;

      // A phrase explicitly selected by the user remains authoritative. Context
      // expansion is only for one lexical token selected inside a local phrase.
      if (isLexicalPhrase(lexicalText)) {
        const exactPhrase = await lookupAcrossPacks(queryText, "exact");
        if (exactPhrase.length) {
          const resultMatch = exactPhrase.every((candidate) => candidate.matchedBy === "alias") ? "alias" : "exact";
          return candidateResult(queryText, sourceLanguage, targetLanguage, resultMatch, exactPhrase);
        }

        if (normalizationApplied) {
          const normalizedPhrase = await lookupAcrossPacks(normalizedText, "normalized");
          if (normalizedPhrase.length) {
            const resultMatch = normalizedPhrase.every((candidate) => candidate.matchedBy === "alias")
              ? "alias"
              : "normalized";
            return candidateResult(
              queryText,
              sourceLanguage,
              targetLanguage,
              resultMatch,
              normalizedPhrase,
              normalizedText,
              normalizedText
            );
          }
        }

        const evidence = await collectPhraseEvidence(lexicalText, maxPhraseEvidenceTokens);
        return {
          status: LEXICAL_RESULT_STATUS.NO_HIT,
          query: makeQuery(queryText, sourceLanguage, targetLanguage),
          evidence
        };
      }

      const contextPhraseMatch = await resolveContextPhraseMatch({
        selectionText: lexicalText,
        contextText,
        glossary,
        findGlossaryOverride,
        lookupPhrase: (phrase) => lookupAcrossPacks(phrase, "exact")
      });
      if (contextPhraseMatch) {
        const candidates = contextPhraseMatch.glossaryOverride
          ? [glossaryCandidate(contextPhraseMatch.glossaryOverride)]
          : contextPhraseMatch.candidates;
        return buildContextPhraseLookupResult({
          query: makeQuery(queryText, sourceLanguage, targetLanguage),
          match: contextPhraseMatch,
          candidates
        });
      }

      const exact = await lookupAcrossPacks(queryText, "exact");
      if (exact.length) {
        const resultMatch = exact.every((candidate) => candidate.matchedBy === "alias") ? "alias" : "exact";
        return candidateResult(queryText, sourceLanguage, targetLanguage, resultMatch, exact);
      }

      if (normalizationApplied) {
        const normalized = await lookupAcrossPacks(normalizedText, "normalized");
        if (normalized.length) {
          const resultMatch = normalized.every((candidate) => candidate.matchedBy === "alias")
            ? "alias"
            : "normalized";
          return candidateResult(
            queryText,
            sourceLanguage,
            targetLanguage,
            resultMatch,
            normalized,
            normalizedText,
            normalizedText
          );
        }
      }

      const canonical = normalizeLexicalKey(lexicalText);
      for (const lemma of conservativeMorphologyForms(canonical)) {
        const candidates = await lookupAcrossPacks(lemma, "morphology");
        if (candidates.length) {
          return candidateResult(
            queryText, sourceLanguage, targetLanguage, "morphology", candidates, lemma,
            normalizationApplied ? normalizedText : ""
          );
        }
      }

      return {
        status: LEXICAL_RESULT_STATUS.NO_HIT,
        query: makeQuery(queryText, sourceLanguage, targetLanguage)
      };
    } catch (error) {
      if (!Object.values(LEXICAL_ERROR_CODES).includes(error?.code)) throw error;
      return {
        status: LEXICAL_RESULT_STATUS.ERROR,
        query: makeQuery(queryText, sourceLanguage, targetLanguage),
        error: {
          code: error.code,
          message: error?.message || String(error),
          packId: error?.packId || "",
          path: error?.path || ""
        }
      };
    }
  }

  async function lookupAcrossPacks(text, matchedBy) {
    const candidates = [];
    for (const reader of packReaders) {
      const hits = typeof reader.lookupAll === "function"
        ? await reader.lookupAll(text)
        : [await reader.lookup(text)].filter(Boolean);
      for (const hit of hits) {
        candidates.push(...candidatesFromHit(hit, {
          matchedBy: hit.matchedAlias ? "alias" : matchedBy,
          queryForm: text
        }));
      }
    }
    return candidates;
  }

  async function collectPhraseEvidence(text, limit) {
    const tokens = [...new Set(normalizeLexicalKey(text).split(" ").filter(Boolean))].slice(0, limit);
    const evidence = [];
    for (const token of tokens) {
      const candidates = await lookupAcrossPacks(token, "token-evidence");
      if (candidates.length) evidence.push({ token, candidates });
    }
    return evidence;
  }

  return {
    lookup,
    stats() {
      return packReaders.map((reader, index) => ({
        index,
        ...(typeof reader.stats === "function" ? reader.stats() : {})
      }));
    }
  };
}

function candidatesFromHit(hit, { matchedBy, queryForm }) {
  const { record, pack } = hit;
  const base = {
    kind: record.kind,
    headword: record.displayForm,
    aliases: Array.isArray(record.aliases) ? [...record.aliases] : [],
    matchedBy,
    queryForm,
    exactCaseMatch: Boolean(hit.exactCaseMatch),
    provenance: {
      packId: pack.packId,
      packVersion: pack.packVersion,
      fingerprint: pack.fingerprint
    }
  };

  if (Array.isArray(record.senses) && record.senses.length) {
    return record.senses.map((sense) => ({
      ...base,
      id: pack.packId + ":" + sense.id,
      senseId: sense.id,
      partOfSpeech: sense.partOfSpeech || null,
      senseNumber: Number.isSafeInteger(sense.senseNumber) ? sense.senseNumber : null,
      tagCount: Number.isSafeInteger(sense.tagCount) ? sense.tagCount : null,
      translations: [...sense.translations],
      domains: Array.isArray(sense.domains) ? [...sense.domains] : [],
      typeLabels: Array.isArray(sense.typeLabels) ? [...sense.typeLabels] : [],
      provenance: {
        ...base.provenance,
        sourceRefs: Array.isArray(sense.sourceRefs) ? sense.sourceRefs.map((ref) => ({ ...ref })) : []
      }
    }));
  }

  return [{
    ...base,
    id: pack.packId + ":" + (record.entityId || record.lookupKey),
    entityId: record.entityId || null,
    partOfSpeech: null,
    translations: Array.isArray(record.translations) ? [...record.translations] : [],
    domains: Array.isArray(record.domains) ? [...record.domains] : [],
    typeLabels: Array.isArray(record.typeLabels) ? [...record.typeLabels] : [],
    provenance: {
      ...base.provenance,
      sourceRefs: Array.isArray(record.sourceRefs) ? record.sourceRefs.map((ref) => ({ ...ref })) : []
    }
  }];
}

function glossaryCandidate(entry) {
  return {
    id: "user-glossary:" + entry.id,
    kind: "user-glossary",
    headword: entry.source,
    aliases: [],
    matchedBy: "user-glossary",
    queryForm: entry.source,
    exactCaseMatch: true,
    partOfSpeech: null,
    translations: [entry.target],
    domains: [],
    provenance: {
      packId: "user-glossary",
      packVersion: "1",
      fingerprint: "",
      sourceRefs: [{ sourceId: "user-glossary", recordId: entry.id }]
    }
  };
}

function findGlossaryOverride(text, entries) {
  const exact = normalizeLexicalExactKey(text);
  const folded = normalizeLexicalKey(text);
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry?.enabled || !entry.source || !entry.target) continue;
    const sourceExact = normalizeLexicalExactKey(entry.source);
    if (entry.caseSensitive ? sourceExact === exact : normalizeLexicalKey(sourceExact) === folded) {
      return entry;
    }
  }
  return null;
}

export function conservativeMorphologyForms(value) {
  if (!/^[a-z][a-z'-]{2,}$/i.test(value)) return [];
  if (/(?:'s|s')$/i.test(value)) return [];
  const forms = [];

  if (value.endsWith("ies") && value.length > 4) forms.push(value.slice(0, -3) + "y");
  if (value.endsWith("ied") && value.length > 4) forms.push(value.slice(0, -3) + "y");

  if (value.endsWith("ing") && value.length > 5) {
    const stem = value.slice(0, -3);
    forms.push(undoubleFinalConsonant(stem), stem + "e", stem);
  }

  if (value.endsWith("ed") && value.length > 4) {
    const stem = value.slice(0, -2);
    forms.push(undoubleFinalConsonant(stem), stem + "e", stem);
  }

  if (/(?:sses|xes|zes|ches|shes|oes)$/.test(value) && value.length > 4) forms.push(value.slice(0, -2));
  if (
    value.endsWith("s") &&
    value.length > 3 &&
    !value.endsWith("ss") &&
    !value.endsWith("us") &&
    !value.endsWith("is")
  ) {
    forms.push(value.slice(0, -1));
  }

  return uniqueForms(forms).filter((form) => form && form !== value);
}

function undoubleFinalConsonant(value) {
  if (value.length < 3) return value;
  const last = value.at(-1);
  const before = value.at(-2);
  return last === before && /[bcdfghjklmnpqrstvwxyz]/.test(last) ? value.slice(0, -1) : value;
}

function uniqueForms(values) {
  return [...new Set(values.map(normalizeLexicalKey).filter(Boolean))];
}

function candidateResult(
  text,
  sourceLanguage,
  targetLanguage,
  matchedBy,
  candidates,
  resolvedForm = text,
  normalizedForm = ""
) {
  const result = {
    status: LEXICAL_RESULT_STATUS.CANDIDATES,
    query: makeQuery(text, sourceLanguage, targetLanguage),
    override: false,
    matchedBy,
    resolvedForm,
    candidates
  };
  if (normalizedForm) result.normalizedForm = normalizedForm;
  return result;
}

function makeQuery(text, sourceLanguage, targetLanguage) {
  return {
    text,
    normalized: normalizeLexicalKey(text),
    sourceLanguage,
    targetLanguage
  };
}
