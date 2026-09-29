(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.selectionResultModel) return;

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
        { label: "AI 辅助", kind: "ai" }
      ]),
      dictionaryEntries: base.dictionaryEntries || [],
      moreEntryCount: Number(base.moreEntryCount || 0)
    };
  }

  function buildTranslationResult(text) {
    return {
      kind: "translation",
      primaryMeaning: String(text || "").trim(),
      badges: [{ label: "翻译", kind: "translation" }],
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
      domains: uniqueText(candidate?.domains),
      typeLabels: labels,
      badges: [{ label: provenanceLabel(candidate), kind: "local" }]
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
      domains: uniqueText(candidate?.domains),
      typeLabels: uniqueText(candidate?.typeLabels),
      provenanceLabel: provenanceLabel(candidate),
      provenanceKind: isTechnicalCandidate(candidate) ? "technical" : "local",
      primary: Boolean(primary)
    };
  }

  function isTechnicalCandidate(candidate) {
    return candidate?.kind === "technical-concept"
      || candidate?.kind === "technical-entity";
  }

  function provenanceLabel(candidate) {
    if (candidate?.kind === "technical-entity") return "技术词条";
    const packId = String(candidate?.provenance?.packId || "").trim();
    if (!packId || packId === "core" || packId.includes("core")) return "本地词典";
    if (packId.includes("technical") || packId.includes("wikidata")) return "技术词条";
    return `词典包 · ${packId}`;
  }

  function copyTextForCard(card) {
    const entries = Array.isArray(card?.dictionaryEntries) ? card.dictionaryEntries : [];
    const lexicalLines = entries.length > 1
      ? entries.flatMap((entry, index) => {
          const meta = uniqueText([
            entry?.partOfSpeech,
            entry?.provenanceLabel,
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
      lexicalLines.push(`… 还有 ${Number(card.moreEntryCount)} 个候选`);
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
      const label = String(item?.label || "").trim();
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

  app.modules.selectionResultModel = Object.freeze({
    buildLocalResult,
    buildExplainedResult,
    buildTranslationResult,
    copyTextForCard
  });
})();
