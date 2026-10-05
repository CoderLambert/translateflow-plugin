(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.tasks || !app?.modules.selectionResultModel || app.modules.selectionTranslationQuery) return;
  const { messages, sendRuntimeMessage } = app.modules.runtime;
  const tasks = app.modules.tasks;
  const t = (key) => app.modules.contentI18n.t(key);
  function localizedError(key, response = null) {
    const error = Object.assign(new Error(t(key)), { i18nKey: key });
    if (response?.errorCode) error.code = response.errorCode;
    return error;
  }
  const { buildTranslationResult, copyTextForCard, readingTranslation } = app.modules.selectionResultModel;

  function create({ assertCurrent, showResult, onResult }) {
    const popover = app.modules.selectionPopover;
    return async function translateSelection(snapshot, task, version, expectedPage, queryRecord = null) {
      tasks.transition(task, "cache_lookup");
      popover.setLoadingStatus("content.selection.cacheChecking");
      const lookup = await sendRuntimeMessage({
        type: messages.background.CACHE_LOOKUP,
        pageUrl: snapshot.pageUrl,
        segments: [{ id: "selection", text: snapshot.text }]
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!lookup?.ok) throw localizedError("content.selection.cacheLookupFailed", lookup);

      const cached = (lookup.hits || [])
        .find((item) => String(item.id) === "selection")?.text?.trim();
      if (cached) {
        tasks.completeTask(task, { done: 1, cacheHits: 1 });
        const card = buildTranslationResult(cached);
        showResult(snapshot, card, copyTextForCard(card), "content.selection.translationCopied");
        onResult(queryRecord, readingTranslation(cached, lookup.readingResult));
        return;
      }

      tasks.transition(task, "translating");
      popover.setLoadingStatus("content.selection.translating");
      const translated = await sendRuntimeMessage({
        type: messages.background.TRANSLATE_BATCH,
        requestId: task.id,
        pageUrl: snapshot.pageUrl,
        segments: [{ id: "selection", text: snapshot.text }]
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!translated?.ok) throw localizedError("content.page.translationFailed", translated);

      const translation = (translated.translations || [])
        .find((item) => String(item.id) === "selection")?.text?.trim();
      if (!translation) throw localizedError("content.selection.noTranslation");

      tasks.transition(task, "storing");
      popover.setLoadingStatus("content.selection.storing");
      popover.setLoadingCancelable(false);
      const stored = await sendRuntimeMessage({
        type: messages.background.CACHE_STORE,
        pageUrl: snapshot.pageUrl,
        pageTitle: document.title,
        items: [{ sourceText: snapshot.text, translation }]
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!stored?.ok) throw localizedError("content.selection.cacheStoreFailed", stored);

      tasks.completeTask(task, { done: 1, apiTranslated: 1 });
      const card = buildTranslationResult(translation);
      showResult(snapshot, card, copyTextForCard(card), "content.selection.translationCopied");
      onResult(queryRecord, readingTranslation(translation, translated.readingResult));
    };
  }
  app.modules.selectionTranslationQuery = Object.freeze({ create });
})();
