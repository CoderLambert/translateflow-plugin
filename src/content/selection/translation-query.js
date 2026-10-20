(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.tasks || !app?.modules.selectionResultModel || app.modules.selectionTranslationQuery) return;
  const { messages, sendRuntimeMessage } = app.modules.runtime;
  const tasks = app.modules.tasks;
  const t = (key) => app.modules.contentI18n.t(key);
  function localizedError(key, response = null) {
    if (/^MT_(CONFIG|LANGUAGE|STRUCTURE|PERMISSION|INPUT|BUSY|RATE_LIMIT|BLOCKED|HTTP|TIMEOUT|NETWORK|RESPONSE|CONSENT)$/u.test(response?.errorCode || "")) key = `mt.error.${response.errorCode}`;
    const error = Object.assign(new Error(t(key)), { i18nKey: key });
    if (response?.errorCode) error.code = response.errorCode;
    return error;
  }
  const { buildTranslationResult, readingTranslation } = app.modules.selectionResultModel;

  // The existing AI/local routes are unchanged. Free online MT must not
  // upload protected DOM, link text or visible URLs from a selection.
  function selectionContainsProtectedContent(range, selectedText) {
    const urlLike = /(?:[a-z][a-z0-9+.-]*:\/\/|\b(?:mailto|data|blob|javascript|tel):|\bwww\.|\blocalhost(?::\d{1,5})?(?:[/?#][^\s]*)?|\[[0-9a-fA-F:.]+\](?::\d{1,5})?(?:[/?#][^\s]*)?|(?:[\p{L}\p{N}_-]+\.)+[\p{L}]{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[/?#][^\s]*)?)/iu;
    if (typeof selectedText !== "string" || urlLike.test(selectedText)) return true;
    if (!range?.startContainer || !range?.endContainer ||
        typeof range.intersectsNode !== "function" ||
        typeof range.toString !== "function") return true;
    const selector = "code,kbd,pre,samp,a[href],area[href]";
    const ancestor = node => node?.nodeType === 1 ? node : node?.parentElement;
    const comparable = value => String(value).replace(/[\t\n\r\f ]+/gu, " ").trim();
    try {
      // Range is live: a DOM mutation during CACHE_LOOKUP can invalidate it.
      if (range.startContainer.isConnected === false || range.endContainer.isConnected === false ||
          !comparable(selectedText) || comparable(range.toString()) !== comparable(selectedText)) return true;
      const from = ancestor(range.startContainer), to = ancestor(range.endContainer);
      if (typeof from?.closest !== "function" || typeof to?.closest !== "function" ||
          from.closest(selector) || to.closest(selector)) return true;
      const common = ancestor(range.commonAncestorContainer);
      if (typeof common?.querySelectorAll !== "function") return true;
      // Bound traversal; reject unknown or unusually complex selections.
      const candidates = common.querySelectorAll(selector);
      if (candidates.length > 512) return true;
      return [...candidates].some(node => range.intersectsNode(node));
    } catch { return true; }
  }

  function create({ assertCurrent, showResult, onResult }) {
    const popover = app.modules.selectionPopover;
    return async function translateSelection(snapshot, task, version, expectedPage, queryRecord = null, options = {}) {
      tasks.transition(task, "cache_lookup");
      popover.setLoadingStatus("content.selection.cacheChecking");
      const nativeContext = options.browserTranslationAllowed === true ? snapshot.sourceCapture?.context : null;
      // The projection owner has already checked sensitivity; never scan page DOM a second time.
      const detectFromContext = nativeContext?.sensitive === false && nativeContext.source === "visible-local"
        && typeof nativeContext.text === "string";
      const selectionDetectionSample = app.modules.browserTranslationContract?.selectionDetectionSample;
      const nativeDetectionText = detectFromContext && typeof selectionDetectionSample === "function"
        ? selectionDetectionSample(snapshot.text, nativeContext.text) : snapshot.text;
      const lookup = await sendRuntimeMessage({
        type: messages.background.CACHE_LOOKUP,
        requestId: task.id,
        languageSource: "selection",
        selectionKind: snapshot.selectionKind || (options.browserTranslationAllowed ? "word" : "text"),
        temporaryMethod: snapshot.temporaryMethod || "",
        browserTranslationAllowed: options.browserTranslationAllowed === true,
        ...(options.browserTranslationAllowed === true ? { detectionText: nativeDetectionText } : {}),
        pageUrl: snapshot.pageUrl,
        segments: [{ id: "selection", text: snapshot.text, format: "plain" }]
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!lookup?.ok) throw localizedError("content.selection.cacheLookupFailed", lookup);
      if (lookup.engine === "machine-translation" && selectionContainsProtectedContent(snapshot.range, snapshot.text)) {
        throw localizedError("mt.error.MT_PROTECTED_SELECTION",
          { errorCode: "MT_PROTECTED_SELECTION" });
      }
      const configSnapshotId = String(lookup.configSnapshotId || "");
      const cacheToken = (lookup.writeTokens || []).find(item => String(item.id) === "selection")?.token;
      if (lookup.skippedIds?.includes("selection")) {
        tasks.completeTask(task, { done: 1, cacheHits: 0, apiTranslated: 0 });
        popover.showEmpty(snapshot, { titleKey: "content.basic.alreadyTarget", messageKey: "content.basic.alreadyTargetHelp" });
        return;
      }

      const cached = (lookup.hits || [])
        .find((item) => String(item.id) === "selection")?.text?.trim();
      if (cached) {
        tasks.completeTask(task, { done: 1, cacheHits: 1 });
        const card = buildTranslationResult(cached, lookup);
        showResult(snapshot, card);
        onResult(queryRecord, readingTranslation(cached, lookup.readingResult));
        return;
      }

      tasks.transition(task, "translating");
      popover.setLoadingStatus("content.selection.translating");
      const translated = await sendRuntimeMessage({
        type: messages.background.TRANSLATE_BATCH,
        requestId: task.id,
        pageUrl: snapshot.pageUrl,
        configSnapshotId,
        segments: [{ id: "selection", text: snapshot.text, format: "plain" }]
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!translated?.ok) throw localizedError("content.page.translationFailed", translated);

      const translation = (translated.translations || [])
        .find((item) => String(item.id) === "selection")?.text?.trim();
      if (!translation) throw localizedError("content.selection.noTranslation");

      tasks.transition(task, "storing");
      popover.setLoadingStatus("content.selection.storing");
      popover.setLoadingCancelable(false);
      let cacheWarning = String(lookup.cacheWarning || "");
      if (!cacheWarning) {
        const stored = await sendRuntimeMessage({
          type: messages.background.CACHE_STORE,
          pageUrl: snapshot.pageUrl,
          pageTitle: document.title,
          configSnapshotId,
          items: [{ sourceText: snapshot.text, translation, format: "plain", cacheToken, routeRef: translated.translations.find(item => String(item.id) === "selection")?.routeRef }]
        });
        assertCurrent(version, snapshot, expectedPage, task);
        if (!stored?.ok && !app.modules.runtime.isCachePersistenceError?.(stored)) {
          throw localizedError("content.selection.cacheStoreFailed", stored);
        }
        cacheWarning = stored?.ok
          ? (stored.cacheWarning || (Number(stored.stored || 0) < 1 ? "CACHE_NOT_SAVED" : ""))
          : stored.errorCode;
      }

      tasks.completeTask(task, { done: 1, apiTranslated: 1 });
      const card = buildTranslationResult(translation, { ...lookup, ...translated });
      showResult(snapshot, card);
      onResult(queryRecord, readingTranslation(translation, translated.readingResult || lookup.readingResult));
      if (cacheWarning) app.modules.runtime.showToast(t("content.selection.cacheNotSaved"), "error");
      return cacheWarning ? { cacheWarning } : undefined;
    };
  }
  app.modules.selectionTranslationQuery = Object.freeze({ create });
})();
