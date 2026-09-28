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
    || app.modules.selectionController
  ) return;

  const { messages, getPageIdentity, sendRuntimeMessage, showToast } = app.modules.runtime;
  const tasks = app.modules.tasks;
  const { readSelection, isExtensionOwnedNode } = app.modules.selection;
  const { captureSelectionContext } = app.modules.selectionContext;
  const popover = app.modules.selectionPopover;
  const { writeText: writeSelectionText } = app.modules.selectionClipboard;
  const { unresolvedMessage } = app.modules.selectionMessages;
  const { buildLocalResult, buildExplainedResult, buildTranslationResult, copyTextForCard } = app.modules.selectionResultModel;

  let started = false;
  let activeSnapshot = null;
  let activeTask = null;
  let requestVersion = 0;
  let selectionTimer = null;

  function start() {
    if (started) return;
    started = true;
    popover.setCloseHandler(dismiss);

    document.addEventListener("mouseup", handlePotentialSelection, true);
    document.addEventListener("keyup", handlePotentialSelection, true);
    document.addEventListener("selectionchange", scheduleSelectionRefresh, true);
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", () => popover.reposition(), true);
    window.addEventListener("resize", () => popover.reposition(), true);
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
      && activeSnapshot.text === snapshot.text
      && getPageIdentity(activeSnapshot.pageUrl) === getPageIdentity(snapshot.pageUrl)
    ) {
      activeSnapshot.range = snapshot.range;
      activeSnapshot.rect = snapshot.rect;
      popover.reposition();
      return;
    }

    cancelActiveTask({ showCancelled: false });
    requestVersion += 1;
    activeSnapshot = snapshot;
    setQuickControlSelectionActive(true);
    popover.showChip(snapshot, () => translateSnapshot(snapshot));
  }

  async function translateSnapshot(snapshot, { forceTranslation = false } = {}) {
    if (!snapshot || snapshot !== activeSnapshot) return;

    if (activeTask && !tasks.isTerminal(activeTask)) {
      await tasks.cancelTask(activeTask);
    }

    const task = tasks.createTask({
      surface: "selection",
      pageUrl: snapshot.pageUrl,
      total: 1
    });
    activeTask = task;

    const version = ++requestVersion;
    const expectedPage = getPageIdentity(snapshot.pageUrl);
    popover.showLoading(snapshot, () => cancelActiveTask({ showCancelled: true }));

    let resolved = null;
    try {
      if (forceTranslation) {
        await translateSelection(snapshot, task, version, expectedPage);
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
          resolved.explanationAllowed ? () => explainSnapshot(snapshot, resolved.depth, card) : null
        );
        return;
      }

      if (resolved.route === "translation") {
        await translateSelection(snapshot, task, version, expectedPage);
        return;
      }

      if (resolved.routeReason === "no-hit-local") {
        tasks.completeTask(task, { done: 1 });
        popover.showEmpty(snapshot, {
          title: "本地词典暂未收录",
          message: "没有找到可靠的本地词典结果。你可以选择进一步解释或普通翻译。",
          onExplain: resolved.explanationAllowed
            ? () => explainSnapshot(snapshot, resolved.depth)
            : null,
          onTranslate: () => translateSnapshot(snapshot, { forceTranslation: true })
        });
        return;
      }

      tasks.completeTask(task, { done: 1 });
      popover.showError(
        snapshot,
        unresolvedMessage(resolved),
        () => translateSnapshot(snapshot),
        resolved.explanationAllowed ? () => explainSnapshot(snapshot, resolved.depth) : null
      );
    } catch (error) {
      if (error?.name === "SelectionSupersededError") return;
      tasks.failTask(task, error);
      if (snapshot !== activeSnapshot) return;

      const cancelled = tasks.isCancelledError(error) || task.state === "cancelled";
      popover.showError(
        snapshot,
        cancelled ? "翻译已取消。" : failureMessage(error, resolved),
        () => translateSnapshot(snapshot)
      );
    }
  }

  async function explainSnapshot(snapshot, depth, baseCard = null) {
    if (!snapshot || snapshot !== activeSnapshot) return;

    if (activeTask && !tasks.isTerminal(activeTask)) {
      await tasks.cancelTask(activeTask);
    }

    const task = tasks.createTask({
      surface: "selection",
      pageUrl: snapshot.pageUrl,
      total: 1
    });
    activeTask = task;

    const version = ++requestVersion;
    const expectedPage = getPageIdentity(snapshot.pageUrl);
    const context = captureSelectionContext(snapshot);
    const preserveLocal = Boolean(baseCard?.primaryMeaning);

    if (preserveLocal) {
      popover.showAiDetailLoading(() => cancelAiDetail(snapshot, depth, baseCard));
    } else {
      popover.showLoading(snapshot, () => cancelActiveTask({ showCancelled: true }));
    }

    try {
      await explainSelection(snapshot, task, version, expectedPage, context, depth, baseCard);
    } catch (error) {
      if (error?.name === "SelectionSupersededError") return;
      tasks.failTask(task, error);
      if (!isCurrentSelection(version, snapshot, expectedPage)) return;

      const cancelled = tasks.isCancelledError(error) || task.state === "cancelled";
      if (preserveLocal) {
        if (cancelled) {
          popover.showAiDetailCancelled(() => explainSnapshot(snapshot, depth, baseCard));
        } else {
          popover.showAiDetailError(
            `AI 详解失败：${error?.message || error}`,
            () => explainSnapshot(snapshot, depth, baseCard)
          );
        }
        return;
      }

      popover.showError(
        snapshot,
        cancelled ? "AI 详解已取消。" : `AI 详解失败：${error?.message || error}`,
        () => explainSnapshot(snapshot, depth)
      );
    }
  }

  function cancelAiDetail(snapshot, depth, baseCard) {
    const task = activeTask;
    if (!task || tasks.isTerminal(task)) return;
    tasks.cancelTask(task).catch(() => {});
    if (snapshot === activeSnapshot) {
      popover.showAiDetailCancelled(() => explainSnapshot(snapshot, depth, baseCard));
    }
  }

  async function explainSelection(snapshot, task, version, expectedPage, context, depth, baseCard = null) {
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
      return;
    }

    showResult(snapshot, card, copyTextForCard(card), "解释已复制");
  }

  async function translateSelection(snapshot, task, version, expectedPage) {
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
  }

  function failureMessage(error) {
    return error?.message || String(error);
  }

  function showResult(snapshot, card, copyText, copiedMessage, onExplain = null) {
    popover.showResult(snapshot, card, copyAction(copyText, copiedMessage), onExplain);
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
      && getPageIdentity(location.href) === expectedPage;
  }

  function assertCurrent(version, snapshot, expectedPage, task) {
    tasks.assertActive(task);
    if (
      version !== requestVersion
      || snapshot !== activeSnapshot
      || getPageIdentity(location.href) !== expectedPage
    ) {
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
    activeSnapshot = null;
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
      popover.showError(snapshot, "翻译已取消。", () => translateSnapshot(snapshot));
    }
  }

  function setQuickControlSelectionActive(active) {
    app.modules.quickControl?.setSelectionActive(Boolean(active));
  }

  app.modules.selectionController = { start };
})();
