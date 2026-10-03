(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.tasks
    || !app?.modules.selection
    || !app?.modules.selectionContext
    || !app?.modules.selectionPopover
    || !app?.modules.selectionResultModel
    || !app?.modules.selectionClipboard
    || !app?.modules.selectionMessages
    || !app?.modules.selectionRichDetails
    || app.modules.selectionController
  ) return;

  const { messages, getPageIdentity, sendRuntimeMessage, showToast } = app.modules.runtime;
  const tasks = app.modules.tasks;
  const { readSelection, isExtensionOwnedNode } = app.modules.selection;
  const { captureSelectionContext } = app.modules.selectionContext;
  const projection = app.modules.textProjection;
  const popover = app.modules.selectionPopover;
  const { writeText: writeSelectionText } = app.modules.selectionClipboard;
  const { unresolvedMessage } = app.modules.selectionMessages;
  const { load: loadRichDictionaryDetails, cancel: cancelRichDictionaryDetails } = app.modules.selectionRichDetails;
  const { buildLocalResult, buildExplainedResult, copyTextForCard } = app.modules.selectionResultModel;
  const model = app.modules.selectionResultModel;
  const records = app.modules.selectionRecordClient?.create({ onStatus: (view) => app.modules.selectionRecordStatus?.update(view, {
    save: (event) => records.save(event), retry: (event) => records.retry(event),
    open: (event) => records.open(event), decline: (event) => records.decline(event)
  }) });
  const runTranslation = app.modules.selectionTranslationQuery?.create({
    assertCurrent, showResult, onResult: (queryRecord, draft) => records?.accept(queryRecord, draft)
  }) || (() => Promise.reject(new Error("扩展已更新，请刷新网页后重新查询。")));
  let recordContext = null;
  let started = false;
  let activeSnapshot = null;
  let activeTask = null;
  let requestVersion = 0;
  let selectionTimer = null;
  function start() {
    if (started) return;
    started = true;
    popover.setCloseHandler(dismiss);
    projection.start(() => { if (activeSnapshot) { records?.invalidateReference(); dismiss(); } });

    document.addEventListener("mouseup", handlePotentialSelection, true);
    document.addEventListener("keyup", handlePotentialSelection, true);
    document.addEventListener("selectionchange", scheduleSelectionRefresh, true);
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", () => popover.reposition(), true);
    window.addEventListener("resize", () => popover.reposition(), true);
    window.addEventListener("focus", () => { void records?.refresh(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void records?.refresh(); });
    const checkReadingRoute = () => { records?.invalidateReference(); if (activeSnapshot && activeSnapshot.pageUrl !== location.href) dismiss(); };
    window.addEventListener("popstate", checkReadingRoute, true);
    window.addEventListener("hashchange", checkReadingRoute, true);
    const leaveDocument = () => { records?.invalidateReference(); dismiss(); };
    app.modules.selectionRichDetails.bindLifecycle({ getActivePage: () => activeSnapshot?.pageUrl, getPageIdentity, onRouteLeave: leaveDocument, onPageHide: leaveDocument });
  }

  function handlePotentialSelection(event) {
    if (isExtensionOwnedNode(event.target)) return;
    scheduleSelectionRefresh();
  }

  function scheduleSelectionRefresh() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(refreshSelectionUi, 90);
  }

  function refreshSelectionUi() {
    const snapshot = readSelection();
    if (!snapshot) {
      if (!activeSnapshot) {
        popover.hide();
        setQuickControlSelectionActive(false);
      }
      return;
    }

    if (
      activeSnapshot
      && activeSnapshot.text === snapshot.text && projection.sameRange(activeSnapshot, snapshot)
      && getPageIdentity(activeSnapshot.pageUrl) === getPageIdentity(snapshot.pageUrl)
    ) {
      activeSnapshot.range = snapshot.range;
      activeSnapshot.rect = snapshot.rect;
      popover.reposition();
      return;
    }

    cancelActiveTask({ showCancelled: false });
    void cancelRichDictionaryDetails();
    void records?.close();
    recordContext = null;
    app.modules.selectionRecordStatus?.clear();
    requestVersion += 1;
    snapshot.selectionGeneration = requestVersion;
    activeSnapshot = snapshot;
    projection.watchPage(snapshot.pageUrl);
    setQuickControlSelectionActive(true);
    popover.showChip(snapshot, (event) => translateSnapshot(snapshot, { event }));
  }

  async function translateSnapshot(snapshot, { forceTranslation = false, event } = {}) {
    if (!snapshot || snapshot !== activeSnapshot) return;
    const capture = freezeQuery(snapshot);
    if (activeTask && !tasks.isTerminal(activeTask)) {
      await tasks.cancelTask(activeTask);
    }

    if (!isFrozenCurrent(snapshot, capture)) return;
    const task = beginTask(snapshot);

    const version = ++requestVersion;
    const expectedPage = getPageIdentity(snapshot.pageUrl);
    const queryRecord = recordContext = records?.start({ snapshot, capture, event,
      isCurrent: () => isFrozenCurrent(snapshot, capture) && snapshot.pageUrl === location.href }) || null;
    popover.showLoading(snapshot, () => cancelActiveTask({ showCancelled: true }));

    let resolved = null;
    try {
      if (forceTranslation) {
        await translateSelection(snapshot, task, version, expectedPage, queryRecord);
        return;
      }

      tasks.transition(task, "translating");
      popover.setLoadingStatus("正在解析所选内容…");
      const selectionContext = captureSelectionContext(snapshot);
      resolved = await sendRuntimeMessage({
        type: messages.background.SELECTION_RESOLVE,
        text: snapshot.text,
        pageUrl: snapshot.pageUrl,
        context: selectionContext
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!resolved?.ok) throw tasks.responseError(resolved, "划词解析失败");

      if (resolved.route === "local") {
        const card = buildLocalResult(resolved);
        if (!card?.primaryMeaning) throw new Error("本地词典没有可展示结果。");
        tasks.completeTask(task, { done: 1 });
        showResult(
          snapshot,
          card,
          copyTextForCard(card),
          "结果已复制",
          resolved.explanationAllowed ? (event) => explainSnapshot(snapshot, resolved.depth, card, event) : null
        );
        records?.accept(queryRecord, model.readingDictionary(resolved, capture.selectedText), { sourceLanguage: resolved.intent?.sourceLanguage });
        void loadRich(snapshot, version, expectedPage, queryRecord);
        return;
      }

      if (resolved.route === "translation") {
        if (queryRecord) queryRecord.sourceLanguage = resolved.intent?.sourceLanguage || "unknown";
        await translateSelection(snapshot, task, version, expectedPage, queryRecord);
        return;
      }

      if (resolved.routeReason === "no-hit-local") {
        tasks.completeTask(task, { done: 1 });
        popover.showEmpty(snapshot, {
          title: "本地词典暂未收录",
          message: "没有找到可靠的本地词典结果。你可以选择进一步解释或普通翻译。",
          onExplain: resolved.explanationAllowed
            ? (event) => explainSnapshot(snapshot, resolved.depth, null, event)
            : null,
          onTranslate: (event) => translateSnapshot(snapshot, { forceTranslation: true, event })
        });
        records?.accept(queryRecord, model.readingDictionary(resolved, capture.selectedText), { sourceLanguage: resolved.intent?.sourceLanguage });
        void loadRich(snapshot, version, expectedPage, queryRecord);
        return;
      }

      tasks.completeTask(task, { done: 1 });
      popover.showError(
        snapshot,
        unresolvedMessage(resolved),
        (event) => translateSnapshot(snapshot, { event }),
        resolved.explanationAllowed ? (event) => explainSnapshot(snapshot, resolved.depth, null, event) : null
      );
      if (resolved.intent?.kind === "lexical") {
        void loadRich(snapshot, version, expectedPage, queryRecord);
      }
    } catch (error) {
      if (error?.name === "SelectionSupersededError") return;
      tasks.failTask(task, error);
      if (snapshot !== activeSnapshot) return;

      const cancelled = tasks.isCancelledError(error) || task.state === "cancelled";
      popover.showError(
        snapshot,
        cancelled ? "翻译已取消。" : failureMessage(error, resolved),
        (event) => translateSnapshot(snapshot, { event })
      );
    }
  }

  async function explainSnapshot(snapshot, depth, baseCard = null, event = null) {
    if (!snapshot || snapshot !== activeSnapshot) return;
    const existing = recordContext && isFrozenCurrent(snapshot, snapshot.sourceCapture);
    const capture = existing ? snapshot.sourceCapture : freezeQuery(snapshot);
    if (activeTask && !tasks.isTerminal(activeTask)) {
      await tasks.cancelTask(activeTask);
    }

    if (!isFrozenCurrent(snapshot, capture)) return;
    const task = beginTask(snapshot);

    const version = ++requestVersion;
    const expectedPage = getPageIdentity(snapshot.pageUrl);
    const queryRecord = existing ? recordContext : (recordContext = records?.start({ snapshot, capture, event, purpose: "assistant",
      isCurrent: () => isFrozenCurrent(snapshot, capture) && snapshot.pageUrl === location.href }) || null);
    const assistantOperation = existing ? records?.assistant(queryRecord, event) : queryRecord?.operations[0];
    const context = captureSelectionContext(snapshot);
    const preserveLocal = Boolean(baseCard?.primaryMeaning);

    if (preserveLocal) {
      popover.showAiDetailLoading(() => cancelAiDetail(snapshot, depth, baseCard));
    } else {
      popover.showLoading(snapshot, () => cancelActiveTask({ showCancelled: true }), "正在结合上下文解释…");
    }

    try {
      await explainSelection(snapshot, task, version, expectedPage, context, depth, baseCard, queryRecord, assistantOperation);
    } catch (error) {
      if (error?.name === "SelectionSupersededError") return;
      tasks.failTask(task, error);
      if (!isCurrentSelection(version, snapshot, expectedPage)) return;

      const cancelled = tasks.isCancelledError(error) || task.state === "cancelled";
      if (preserveLocal) {
        if (cancelled) {
          popover.showAiDetailCancelled((event) => explainSnapshot(snapshot, depth, baseCard, event));
        } else {
          popover.showAiDetailError(
            `AI 详解失败：${error?.message || error}`,
            (event) => explainSnapshot(snapshot, depth, baseCard, event)
          );
        }
        return;
      }

      popover.showError(
        snapshot,
        cancelled ? "AI 详解已取消。" : `AI 详解失败：${error?.message || error}`,
        (event) => explainSnapshot(snapshot, depth, null, event)
      );
    }
  }

  function cancelAiDetail(snapshot, depth, baseCard) {
    const task = activeTask;
    if (!task || tasks.isTerminal(task)) return;
    tasks.cancelTask(task).catch(() => {});
    if (snapshot === activeSnapshot) {
      popover.showAiDetailCancelled((event) => explainSnapshot(snapshot, depth, baseCard, event));
    }
  }

  async function explainSelection(snapshot, task, version, expectedPage, context, depth, baseCard = null, queryRecord = null, assistantOperation = null) {
    tasks.transition(task, "translating");
    if (!baseCard) popover.setLoadingStatus("正在结合上下文解释…");
    const explained = await sendRuntimeMessage({
      type: messages.background.SELECTION_EXPLAIN,
      requestId: task.id,
      text: snapshot.text,
      pageUrl: snapshot.pageUrl,
      context,
      depth
    });
    assertCurrent(version, snapshot, expectedPage, task);
    if (!explained?.ok) throw tasks.responseError(explained, "划词解释失败");

    if (explained.route === "local" && explained.resolved) {
      if (baseCard) throw new Error("当前本地结果没有可用的 AI 详解。");
      const card = buildLocalResult(explained.resolved);
      if (!card?.primaryMeaning) throw new Error("本地词典没有可展示结果。");
      tasks.completeTask(task, { done: 1 });
      showResult(snapshot, card, copyTextForCard(card), "结果已复制");
      return;
    }

    if (explained.route === "translation") {
      if (baseCard) throw new Error("当前选段已不再适合本地词典详解，请重新选择。");
      await translateSelection(snapshot, task, version, expectedPage);
      return;
    }

    if (explained.route !== "explained" || !explained.generated?.explanation) {
      throw new Error("模型没有返回可用的划词解释。");
    }

    const card = buildExplainedResult(explained);
    tasks.completeTask(task, {
      done: 1,
      cacheHits: explained.cacheHit ? 1 : 0,
      apiTranslated: explained.cacheHit ? 0 : 1
    });

    if (baseCard) {
      const combinedCard = {
        ...baseCard,
        generatedMeaning: card.generatedMeaning,
        explanation: card.explanation
      };
      popover.showAiDetailResult(
        card,
        copyAction(copyTextForCard(combinedCard), "解释已复制")
      );
      records?.accept(queryRecord, model.readingAssistant(card, explained.readingResult, { preserveLocal: true }),
        { key: assistantOperation?.operationId, operation: assistantOperation, sourceLanguage: explained.readingResult?.sourceLanguage });
      records?.render();
      return;
    }

    showResult(snapshot, card, copyTextForCard(card), "解释已复制");
    records?.accept(queryRecord, model.readingAssistant(card, explained.readingResult),
      { key: assistantOperation?.operationId, operation: assistantOperation, sourceLanguage: explained.readingResult?.sourceLanguage });
  }

  function translateSelection(snapshot, task, version, expectedPage, queryRecord = recordContext) {
    return runTranslation(snapshot, task, version, expectedPage, queryRecord);
  }

  function failureMessage(error) { return error?.message || String(error); }

  function showResult(snapshot, card, copyText, copiedMessage, onExplain = null) {
    popover.showResult(snapshot, card, copyAction(copyText, copiedMessage), onExplain);
    records?.render();
    if (!records) app.modules.selectionRecordStatus?.update({ state: "not-saved", message: "阅读记录暂不可用，当前结果仍可使用。" });
  }

  function loadRich(snapshot, version, expectedPage, queryRecord) {
    return loadRichDictionaryDetails(snapshot, version, expectedPage, isCurrentSelection, (record, dictionary) => {
      records?.accept(queryRecord, model.readingRich(record, dictionary), { key: `rich:${dictionary.id}` });
    });
  }

  function copyAction(copyText, copiedMessage) {
    return async () => {
      try {
        await writeSelectionText(copyText);
        showToast(copiedMessage, "success");
      } catch (error) {
        showToast("复制失败：" + (error?.message || error), "error");
      }
    };
  }

  function isCurrentSelection(version, snapshot, expectedPage) {
    return version === requestVersion
      && snapshot === activeSnapshot
      && snapshot.sourceRevision === projection.revision()
      && getPageIdentity(location.href) === expectedPage;
  }

  function assertCurrent(version, snapshot, expectedPage, task) {
    tasks.assertActive(task);
    if (!isCurrentSelection(version, snapshot, expectedPage)) {
      const error = new Error("selection superseded");
      error.name = "SelectionSupersededError";
      error.code = "CANCELLED";
      throw error;
    }
  }

  function handleOutsidePointerDown(event) {
    if (popover.contains(event.target)) return;
    if (!activeSnapshot) return;
    dismiss();
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape") return;
    dismiss();
  }

  function dismiss() {
    cancelActiveTask({ showCancelled: false });
    void cancelRichDictionaryDetails();
    void records?.close();
    recordContext = null;
    app.modules.selectionRecordStatus?.clear();
    activeSnapshot = null;
    projection.watchPage(null);
    requestVersion += 1;
    popover.hide();
    setQuickControlSelectionActive(false);
  }

  function cancelActiveTask({ showCancelled }) {
    const task = activeTask;
    if (!task || tasks.isTerminal(task)) return;
    tasks.cancelTask(task).catch(() => {});
    if (showCancelled && activeSnapshot) {
      const snapshot = activeSnapshot;
      popover.showError(snapshot, "翻译已取消。", (event) => translateSnapshot(snapshot, { event }));
    }
  }

  function setQuickControlSelectionActive(active) { app.modules.quickControl?.setSelectionActive(Boolean(active)); }

  function freezeQuery(snapshot) {
    const capture = app.modules.selectionSourceSnapshot.capture(snapshot);
    snapshot.sourceCapture = capture; snapshot.text = capture.selectedText;
    return capture;
  }
  function isFrozenCurrent(snapshot, capture) { return snapshot === activeSnapshot && snapshot.sourceCapture === capture && snapshot.sourceRevision === capture.sourceRevision && capture.sourceRevision === projection.revision(); }
  function beginTask(snapshot) { return activeTask = tasks.createTask({ surface: "selection", pageUrl: snapshot.pageUrl, total: 1 }); }
  app.modules.selectionController = { start, getQuerySource: () => { projection.revision(); return activeSnapshot?.sourceCapture || null; } };
})();
