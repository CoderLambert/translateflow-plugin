(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.tasks || !app?.modules.selectionResultModel || app.modules.selectionTranslationQuery) return;
  const { messages, sendRuntimeMessage } = app.modules.runtime;
  const tasks = app.modules.tasks;
  const { buildTranslationResult, copyTextForCard, readingTranslation } = app.modules.selectionResultModel;

  function create({ assertCurrent, showResult, onResult }) {
    const popover = app.modules.selectionPopover;
    return async function translateSelection(snapshot, task, version, expectedPage, queryRecord = null) {
      tasks.transition(task, "cache_lookup");
      popover.setLoadingStatus("正在检查翻译缓存…");
      const lookup = await sendRuntimeMessage({
        type: messages.background.CACHE_LOOKUP,
        pageUrl: snapshot.pageUrl,
        segments: [{ id: "selection", text: snapshot.text }]
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!lookup?.ok) throw tasks.responseError(lookup, "缓存查询失败");

      const cached = (lookup.hits || [])
        .find((item) => String(item.id) === "selection")?.text?.trim();
      if (cached) {
        tasks.completeTask(task, { done: 1, cacheHits: 1 });
        const card = buildTranslationResult(cached);
        showResult(snapshot, card, copyTextForCard(card), "译文已复制");
        onResult(queryRecord, readingTranslation(cached, lookup.readingResult));
        return;
      }

      tasks.transition(task, "translating");
      popover.setLoadingStatus("正在翻译…");
      const translated = await sendRuntimeMessage({
        type: messages.background.TRANSLATE_BATCH,
        requestId: task.id,
        pageUrl: snapshot.pageUrl,
        segments: [{ id: "selection", text: snapshot.text }]
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!translated?.ok) throw tasks.responseError(translated, "翻译失败");

      const translation = (translated.translations || [])
        .find((item) => String(item.id) === "selection")?.text?.trim();
      if (!translation) throw new Error("模型没有返回可用译文。");

      tasks.transition(task, "storing");
      popover.setLoadingStatus("正在保存译文…");
      const stored = await sendRuntimeMessage({
        type: messages.background.CACHE_STORE,
        pageUrl: snapshot.pageUrl,
        pageTitle: document.title,
        items: [{ sourceText: snapshot.text, translation }]
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!stored?.ok) throw tasks.responseError(stored, "译文缓存失败");

      tasks.completeTask(task, { done: 1, apiTranslated: 1 });
      const card = buildTranslationResult(translation);
      showResult(snapshot, card, copyTextForCard(card), "译文已复制");
      onResult(queryRecord, readingTranslation(translation, translated.readingResult));
    };
  }
  app.modules.selectionTranslationQuery = Object.freeze({ create });
})();
