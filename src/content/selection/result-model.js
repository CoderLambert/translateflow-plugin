(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.contentI18n || app.modules.selectionResultModel) return;
  const t = (key, args) => app.modules.contentI18n.t(key, args);

  function buildLocalResult(resolved) {
    const candidates = orderedCandidates(resolved);
    if (!candidates.length) return null;

    const candidate = candidates[0];
    const card = cardFromCandidate(candidate, {
      kind: isTechnicalCandidate(candidate) ? "technical" : "local"
    });
    const entries = candidates.slice(0, 5).map((item, index) =>
      dictionaryEntryFromCandidate(item, { primary: index === 0 })
    );

    return {
      ...card,
      dictionaryEntries: entries,
      moreEntryCount: Math.max(0, candidates.length - entries.length)
    };
  }

  function buildExplainedResult(explained) {
    const candidates = Array.isArray(explained?.local?.candidates) ? explained.local.candidates : [];
    const selectedIds = new Set(
      Array.isArray(explained?.generated?.selectedCandidateIds)
        ? explained.generated.selectedCandidateIds.map(String)
        : []
    );
    const candidate = candidates.find((item) => selectedIds.has(String(item?.id)))
      || candidates.find((item) => item?.id === explained?.local?.topCandidateId)
      || candidates[0]
      || null;
    const base = candidate
      ? cardFromCandidate(candidate, {
          kind: isTechnicalCandidate(candidate) ? "technical" : "local"
        })
      : {
          kind: "explained",
          headword: "",
          primaryMeaning: "",
          senses: [],
          domains: [],
          typeLabels: [],
          badges: [],
          dictionaryEntries: [],
          moreEntryCount: 0
        };

    const generatedTranslation = String(explained?.generated?.translation || "").trim();
    return {
      ...base,
      kind: "explained",
      primaryMeaning: base.primaryMeaning || generatedTranslation,
      generatedMeaning: base.primaryMeaning && generatedTranslation && generatedTranslation !== base.primaryMeaning
        ? generatedTranslation
        : "",
      explanation: String(explained?.generated?.explanation || "").trim(),
      badges: dedupeBadges([
        ...(Array.isArray(base.badges) ? base.badges : []),
        { label: t("content.selection.badgeAi"), labelKey: "content.selection.badgeAi", kind: "ai" }
      ]),
      dictionaryEntries: base.dictionaryEntries || [],
      moreEntryCount: Number(base.moreEntryCount || 0)
    };
  }

  function buildTranslationResult(text) {
    return {
      kind: "translation",
      primaryMeaning: String(text || "").trim(),
      badges: [{ label: t("content.selection.badgeTranslation"), labelKey: "content.selection.badgeTranslation", kind: "translation" }],
      senses: [],
      domains: [],
      typeLabels: []
    };
  }

  function cardFromCandidate(candidate, { kind } = {}) {
    const translations = uniqueText(candidate?.translations);
    const labels = uniqueText(candidate?.typeLabels);
    const headword = String(candidate?.headword || "").trim();
    const primaryMeaning = translations[0]
      || labels.slice(0, 2).join(" · ")
      || headword;

    return {
      kind: kind || "local",
      headword,
      pronunciation: String(candidate?.pronunciation || "").trim(),
      partOfSpeech: String(candidate?.partOfSpeech || "").trim(),
      primaryMeaning,
      senses: translations.slice(1),
      examples: uniqueText([
        ...(Array.isArray(candidate?.examples) ? candidate.examples : []),
        candidate?.example
      ]),
      domains: uniqueText(candidate?.domains),
      typeLabels: labels,
      badges: [{ ...provenanceDescriptor(candidate), kind: "local" }]
    };
  }

  function orderedCandidates(resolved) {
    const candidates = Array.isArray(resolved?.decision?.candidates)
      ? resolved.decision.candidates
      : (Array.isArray(resolved?.lookup?.candidates) ? resolved.lookup.candidates : []);
    if (!candidates.length) return [];

    const topId = String(resolved?.decision?.topCandidateId || "");
    if (!topId) return [...candidates];
    const topIndex = candidates.findIndex((item) => String(item?.id || "") === topId);
    if (topIndex <= 0) return [...candidates];
    return [
      candidates[topIndex],
      ...candidates.slice(0, topIndex),
      ...candidates.slice(topIndex + 1)
    ];
  }

  function dictionaryEntryFromCandidate(candidate, { primary = false } = {}) {
    return {
      id: String(candidate?.id || ""),
      kind: String(candidate?.kind || "lexical"),
      headword: String(candidate?.headword || "").trim(),
      pronunciation: String(candidate?.pronunciation || "").trim(),
      partOfSpeech: String(candidate?.partOfSpeech || "").trim(),
      translations: uniqueText(candidate?.translations),
      examples: uniqueText([
        ...(Array.isArray(candidate?.examples) ? candidate.examples : []),
        candidate?.example
      ]),
      domains: uniqueText(candidate?.domains),
      typeLabels: uniqueText(candidate?.typeLabels),
      ...provenanceDescriptor(candidate, "provenance"),
      provenanceKind: isTechnicalCandidate(candidate) ? "technical" : "local",
      primary: Boolean(primary)
    };
  }

  function isTechnicalCandidate(candidate) {
    return candidate?.kind === "technical-concept"
      || candidate?.kind === "technical-entity";
  }

  function provenanceDescriptor(candidate, prefix = "label") {
    if (candidate?.kind === "technical-entity") return localizedDescriptor("content.selection.sourceTechnical", {}, prefix);
    const packId = String(candidate?.provenance?.packId || "").trim();
    if (!packId || packId === "core" || packId.includes("core")) return localizedDescriptor("content.selection.sourceLocal", {}, prefix);
    if (packId.includes("technical") || packId.includes("wikidata")) return localizedDescriptor("content.selection.sourceTechnical", {}, prefix);
    const args = { packId };
    return localizedDescriptor("content.selection.sourcePack", args, prefix);
  }

  function localizedDescriptor(key, args, prefix) {
    if (prefix === "provenance") return { provenanceLabel: t(key, args), provenanceKey: key, provenanceArgs: args };
    return { label: t(key, args), labelKey: key, labelArgs: args };
  }

  function copyTextForCard(card) {
    const entries = Array.isArray(card?.dictionaryEntries) ? card.dictionaryEntries : [];
    const lexicalLines = entries.length > 1
      ? entries.flatMap((entry, index) => {
          const meta = uniqueText([
            entry?.partOfSpeech,
            entry?.provenanceKey ? t(entry.provenanceKey, entry.provenanceArgs || {}) : entry?.provenanceLabel,
            ...(Array.isArray(entry?.domains) ? entry.domains : []),
            ...(Array.isArray(entry?.typeLabels) ? entry.typeLabels : [])
          ]);
          const heading = meta.length ? `${index + 1}. ${meta.join(" · ")}` : `${index + 1}.`;
          return [
            heading,
            ...uniqueText(entry?.translations).map((value) => `   ${value}`)
          ];
        })
      : uniqueText([
          card?.primaryMeaning,
          ...(Array.isArray(card?.senses) ? card.senses : [])
        ]);

    if (Number(card?.moreEntryCount || 0) > 0) {
      lexicalLines.push(t("content.selection.moreCandidates", { count: Number(card.moreEntryCount) }));
    }

    return [
      ...lexicalLines,
      card?.generatedMeaning,
      card?.explanation
    ]
      .map((value) => String(value || "").trimEnd())
      .filter((value) => value.trim())
      .join("\n");
  }

  function dedupeBadges(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).filter((item) => {
      const label = String(item?.labelKey || item?.label || "").trim();
      if (!label || seen.has(label)) return false;
      seen.add(label);
      return true;
    });
  }

  function uniqueText(values) {
    return [...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )];
  }

  function readingDictionary(resolved, selectedText) {
    if (resolved?.routeReason === "no-hit-local") return { kind: "dictionary", targetLanguage: "zh-CN",
      payload: { outcome: "no-hit", headword: selectedText, phonetic: "", partOfSpeech: "", definitions: [] }, provenance: [] };
    const candidate = orderedCandidates(resolved)[0], limits = app.modules.readingContract?.READING_LIMITS;
    if (!candidate || !limits) return null;
    const definitions = uniqueText(candidate.translations).slice(0, limits.dictionaryEntries).map((s) => s.slice(0, limits.definitionChars));
    const p = candidate.provenance;
    const provenance = (p?.sourceRefs || []).slice(0, limits.provenanceEntries).map((ref) => ({
      sourceId: ref.sourceId, packId: p.packId, packVersion: p.packVersion, sourceEntryId: ref.recordId }));
    if (!definitions.length || !provenance.length) return null;
    return { kind: "dictionary", targetLanguage: "zh-CN", payload: { outcome: "hit", headword: candidate.headword,
      phonetic: String(candidate.pronunciation || ""), partOfSpeech: String(candidate.partOfSpeech || ""), definitions }, provenance };
  }
  function vocabularyDraft(resolved) {
    if (resolved?.routeReason === "no-hit-local") return null;
    const candidate = orderedCandidates(resolved)[0];
    const provenance = candidate?.provenance;
    const sourceRefs = Array.isArray(provenance?.sourceRefs) ? provenance.sourceRefs.slice(0, 4) : [];
    const sources = sourceRefs.map((ref) => ({
      sourceId: String(ref?.sourceId || ""),
      packId: String(provenance?.packId || ""),
      packVersion: String(provenance?.packVersion || ""),
      sourceEntryId: String(ref?.recordId || "")
    }));
    const definitions = uniqueText(candidate?.translations).slice(0, 4);
    if (!candidate?.headword || !definitions.length || !sources.length || sources.some((source) =>
      !source.sourceId || !source.packId || !source.packVersion || !source.sourceEntryId)) return null;
    return {
      headword: String(candidate.headword).trim(),
      sourceLanguage: String(resolved?.intent?.sourceLanguage || "en"),
      targetLanguage: "zh-CN",
      pronunciation: String(candidate.pronunciation || "").trim(),
      partOfSpeech: String(candidate.partOfSpeech || "").trim(),
      definitions,
      examples: uniqueText([...(Array.isArray(candidate.examples) ? candidate.examples : []), candidate.example]).slice(0, 2),
      sources
    };
  }
  function readingTranslation(text, result) {
    if (!result?.provenance || !text) return null;
    return { kind: "translation", targetLanguage: result.targetLanguage, payload: { text }, provenance: result.provenance };
  }
  function readingAssistant(card, result, { preserveLocal = false } = {}) {
    if (!result?.userQuestion || !result.provenance || !card.explanation) return null;
    const answer = [card.generatedMeaning || (!preserveLocal && !card.dictionaryEntries?.length ? card.primaryMeaning : ""), card.explanation].filter(Boolean).join("\n");
    return { kind: "assistant", targetLanguage: result.targetLanguage, provenance: result.provenance,
      payload: { userQuestion: result.userQuestion, assistantAnswer: answer, action: result.action,
        threadId: crypto.randomUUID(), turnId: crypto.randomUUID(), parentTurnId: null, branchId: crypto.randomUUID(),
        regenerationOf: null, completionStatus: "completed" } };
  }
  function readingRich(record, dictionary) {
    const limits = app.modules.readingContract?.READING_LIMITS;
    // The optional renderer hook projects actual displayed safe text, never the raw rich payload.
    if (!limits || record?.id !== dictionary?.id || !record.packVersion || typeof record.text !== "string") return null;
    const summary = record.text.trim();
    if (!summary || summary === record.headword || /(?:<\/?[a-z]|`\d+`|(?:file|sound|entry|https?):\/\/|(?:[A-Za-z]:\\|\/home\/))/iu.test(summary)) return null;
    const normalizedHeadword = String(record.headword || "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
    const definitions = uniqueText(summary.split(/\n+/u).map((value) => value.replace(/[\t\r\f ]+/gu, " ").trim())
      .filter((value) => value.normalize("NFKC").toLocaleLowerCase("en-US") !== normalizedHeadword))
      .slice(0, limits.dictionaryEntries).map((s) => s.slice(0, limits.definitionChars));
    if (!definitions.length) return null;
    return { kind: "dictionary", targetLanguage: "zh-CN", payload: { outcome: "hit", headword: record.headword,
      phonetic: "", partOfSpeech: "", definitions }, provenance: [{ sourceId: "local-rich-mdict", packId: dictionary.id,
        packVersion: record.packVersion, sourceEntryId: record.headword }] };
  }
  function vocabularyDraftFromRich(record, dictionary, sourceLanguage = "en") {
    const reading = readingRich(record, dictionary), headword = String(reading?.payload?.headword || "").trim();
    const source = reading?.provenance?.[0];
    if (!reading || !headword || headword.length > 180 || !source || String(sourceLanguage).length > 80) return null;
    return {
      headword,
      sourceLanguage: String(sourceLanguage || "en"),
      targetLanguage: reading.targetLanguage,
      pronunciation: "",
      partOfSpeech: "",
      definitions: reading.payload.definitions.slice(0, 4),
      examples: [],
      sources: [source]
    };
  }

  app.modules.selectionResultModel = Object.freeze({
    buildLocalResult,
    buildExplainedResult,
    buildTranslationResult,
    copyTextForCard,
    readingDictionary, readingTranslation, readingAssistant, readingRich, vocabularyDraft, vocabularyDraftFromRich
  });
})();
