(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.selectionResultModel) return;

  function buildLocalResult(resolved) {
    const candidates = Array.isArray(resolved?.decision?.candidates)
      ? resolved.decision.candidates
      : (Array.isArray(resolved?.lookup?.candidates) ? resolved.lookup.candidates : []);
    if (!candidates.length) return null;

    const topId = resolved?.decision?.topCandidateId;
    const candidate = candidates.find((item) => item?.id === topId) || candidates[0];
    return cardFromCandidate(candidate, {
      kind: candidate?.kind === "technical-entity" ? "technical" : "local"
    });
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
          kind: candidate?.kind === "technical-entity" ? "technical" : "local"
        })
      : {
          kind: "explained",
          headword: "",
          primaryMeaning: "",
          senses: [],
          domains: [],
          typeLabels: [],
          badges: []
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
      ])
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

  function provenanceLabel(candidate) {
    if (candidate?.kind === "technical-entity") return "技术词条";
    const packId = String(candidate?.provenance?.packId || "").trim();
    if (!packId || packId === "core" || packId.includes("core")) return "本地词典";
    if (packId.includes("technical") || packId.includes("wikidata")) return "技术词条";
    return `词典包 · ${packId}`;
  }

  function copyTextForCard(card) {
    return uniqueText([
      card?.primaryMeaning,
      ...(Array.isArray(card?.senses) ? card.senses : []),
      card?.generatedMeaning,
      card?.explanation
    ]).join("\n");
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
