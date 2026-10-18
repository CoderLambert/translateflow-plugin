(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.selectionTranslationActions) return;
  function create({ showResult, explainSnapshot, vocabularyBook }) {
    function showTranslationResult(snapshot, card) {
      const pair = card.browserPair;
      const entry = snapshot.text.length <= 180 ? { headword: snapshot.text,
        sourceLanguage: pair?.sourceLanguage || "auto", targetLanguage: pair?.targetLanguage || "zh",
        pronunciation: "", partOfSpeech: "", definitions: [card.primaryMeaning.slice(0, 1200)], examples: [],
        sources: [{ sourceId: pair ? "browser-translator" : "ai-translation", packId: pair ? "translator-v1" : "translation-v1", packVersion: "1", sourceEntryId: snapshot.text.slice(0, 180) }] } : null;
      showResult(snapshot, card,
        (event, action) => explainSnapshot(snapshot, "auto", card, event, action),
        entry ? event => vocabularyBook.add(entry, event) : null, event => vocabularyBook.open(event));
    }
    return showTranslationResult;
  }
  app.modules.selectionTranslationActions = { create };
})();
