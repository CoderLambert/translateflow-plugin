(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.contentI18n
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
  const i18n = app.modules.contentI18n;
  const t = (key, args) => i18n.t(key, args);
  const tasks = app.modules.tasks;
  const { readSelection, isExtensionOwnedNode } = app.modules.selection;
  const { captureSelectionContext } = app.modules.selectionContext;
  const projection = app.modules.textProjection;
  const popover = app.modules.selectionPopover;
  const { writeText: writeSelectionText } = app.modules.selectionClipboard;
  const { unresolvedMessage } = app.modules.selectionMessages;
  const { load: loadRichDictionaryDetails, cancel: cancelRichDictionaryDetails } = app.modules.selectionRichDetails;
  const vocabularyBook = app.modules.selectionVocabularyBook?.create() || {
    add: async () => ({ ignored: true }),
    open: () => ({ ignored: true })
  };
  const { buildLocalResult, copyTextForCard } = app.modules.selectionResultModel;
  const model = app.modules.selectionResultModel;
  const records = app.modules.selectionRecordClient?.create({ onStatus: (view) => app.modules.selectionRecordStatus?.update(view, {
    save: (event) => records.save(event), retry: (event) => records.retry(event),
    open: (event) => records.open(event), decline: (event) => records.decline(event)
  }) });
  const runTranslation = app.modules.selectionTranslationQuery?.create({
    assertCurrent, showResult, onResult: (queryRecord, draft) => records?.accept(queryRecord, draft)
  }) || (() => Promise.reject(localizedError("content.selection.updatedRefresh")));
  let recordContext = null;
  let started = false;
  let activeSnapshot = null;
  let activeTask = null;
  let activeAssistant = null;
  let requestVersion = 0;
  let selectionTimer = null;
  function start() {
    if (started) return;
    started = true;
    popover.setCloseHandler(dismiss);
    projection.start(handleProjectionInvalidation);

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
  function handleProjectionInvalidation(revision = projection.revision()) {
    const snapshot = activeSnapshot, capture = snapshot?.sourceCapture; if (!snapshot) return;
    const current = app.modules.selectionSourceSnapshot.matchesCurrentPage(snapshot, capture, location.href, getPageIdentity);
    if (!current) { records?.invalidateReference(); dismiss(); return; }
    snapshot.sourceRevision = revision; if (capture) capture.sourceRevision = revision; popover.reposition();
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
    abandonAssistant();
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
    popover.showLoading(snapshot, () => cancelActiveTask({ showCancelled: true, snapshot, task, version }));

    let resolved = null;
    try {
      if (forceTranslation) {
        await translateSelection(snapshot, task, version, expectedPage, queryRecord);
        return;
      }

      tasks.transition(task, "translating");
      popover.setLoadingStatus("content.selection.resolving");
      const selectionContext = captureSelectionContext(snapshot);
      resolved = await sendRuntimeMessage({
        type: messages.background.SELECTION_RESOLVE,
        text: snapshot.text,
        pageUrl: snapshot.pageUrl,
        context: selectionContext
      });
      assertCurrent(version, snapshot, expectedPage, task);
      if (!resolved?.ok) throw localizedError("content.selection.resolveFailed", resolved?.errorCode);

      if (resolved.route === "local") {
        const card = buildLocalResult(resolved);
        if (!card?.primaryMeaning) throw localizedError("content.selection.noLocalResult");
        const vocabularyEntry = model.vocabularyDraft(resolved);
        tasks.completeTask(task, { done: 1 });
        showResult(
          snapshot,
          card,
          copyTextForCard(card),
          "content.selection.resultCopied",
          resolved.explanationAllowed ? (event, action) => explainSnapshot(snapshot, resolved.depth, card, event, action) : null,
          vocabularyEntry ? (event) => {
            if (!event?.isTrusted) return { ignored: true };
            if (!isCurrentVocabularySelection(snapshot, capture, expectedPage)) throw localizedError("content.vocabulary.updated");
            return vocabularyBook.add(vocabularyEntry, event);
          } : null,
          (event) => vocabularyBook.open(event)
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
          titleKey: "content.selection.localEmptyTitle",
          messageKey: "content.selection.localEmptyHelp",
          onExplain: resolved.explanationAllowed
            ? (event, action) => explainSnapshot(snapshot, resolved.depth, null, event, action)
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
        resolved.explanationAllowed ? (event, action) => explainSnapshot(snapshot, resolved.depth, null, event, action) : null
      );
      if (resolved.intent?.kind === "lexical") {
        void loadRich(snapshot, version, expectedPage, queryRecord);
      }
    } catch (error) {
      if (error?.name === "SelectionSupersededError" || snapshot !== activeSnapshot || task !== activeTask) return;
      tasks.failTask(task, error);

      const cancelled = tasks.isCancelledError(error) || task.state === "cancelled";
      popover.showError(
        snapshot,
        cancelled ? "content.selection.cancelled" : failureMessage(error, resolved),
        (event) => translateSnapshot(snapshot, { event })
      );
    }
  }

  async function explainSnapshot(snapshot, depth, baseCard = null, event = null, action = "understand") {
    if (!snapshot || snapshot !== activeSnapshot || !["understand", "analyze", "usage"].includes(action)) return;
    const currentCapture = snapshot.sourceCapture;
    const captureIsCurrent = Boolean(currentCapture && isFrozenCurrent(snapshot, currentCapture));
    const existing = Boolean(recordContext && captureIsCurrent);
    const capture = captureIsCurrent ? currentCapture : freezeQuery(snapshot);
    if (activeTask && !tasks.isTerminal(activeTask)) await tasks.cancelTask(activeTask);
    if (!isFrozenCurrent(snapshot, capture)) return;
    abandonAssistant();
    const version = ++requestVersion, expectedPage = getPageIdentity(snapshot.pageUrl);
    const queryRecord = existing ? recordContext : (recordContext = records?.start({ snapshot, capture, event, purpose: "assistant",
      isCurrent: () => isFrozenCurrent(snapshot, capture) && snapshot.pageUrl === location.href }) || null);
    const operation = existing ? records?.assistant(queryRecord, event) : queryRecord?.operations[0];
    const requestId = `assistant-${crypto.randomUUID()}`;
    const state = activeAssistant = { snapshot, capture, version, expectedPage, depth, baseCard, action, queryRecord, operation,
      requestId, partial: "", sequence: 0, stopping: false, terminal: false, port: null };
    if (!baseCard) popover.showLoading(snapshot, () => stopAssistant(true), "content.ai.connecting");
    popover.showAiDetailStreaming("", () => stopAssistant(true));
    try {
      const port = state.port = chrome.runtime.connect({ name: "selection.assistant-stream" });
      port.onMessage.addListener(message => handleAssistantMessage(state, message));
      port.onDisconnect.addListener(() => {
        if (!state.terminal) interruptAssistant(state, "content.ai.disconnected");
      });
      port.postMessage({ protocolVersion: 1, type: "start", requestId, text: capture.selectedText,
        pageUrl: snapshot.pageUrl, context: captureSelectionContext(snapshot), depth, ownerToken: ownerToken(),
        action, threadId: `thread-${crypto.randomUUID()}`, turnId: `turn-${crypto.randomUUID()}`,
        parentTurnId: null, branchId: `branch-${crypto.randomUUID()}`, regenerationOf: null });
    } catch { interruptAssistant(state, "content.ai.connectFailed"); }
  }

  function handleAssistantMessage(state, message) {
    if (!assistantLive(state) || message?.protocolVersion !== 1 || message.requestId !== state.requestId) return;
    if (message.type === "started") {
      if (!["stream", "unary"].includes(message.mode) || state.sequence !== 0 || state.partial) {
        interruptAssistant(state, "content.ai.protocolError");
      }
      return;
    }
    if (message.type === "delta") {
      if (message.sequence !== state.sequence || typeof message.text !== "string") return interruptAssistant(state, "content.ai.orderError");
      state.sequence++; state.partial += message.text;
      if (!state.stopping) popover.showAiDetailStreaming(state.partial, () => stopAssistant(true));
      return;
    }
    if (message.type === "interrupted") {
      const stopped = state.stopping || message.code === "CANCELLED";
      return interruptAssistant(state, stopped ? "content.ai.stopped" : "content.ai.interrupted");
    }
    if (message.type !== "complete" || state.stopping || message.turn?.completionStatus !== "completed" ||
        message.turn.assistantAnswer !== message.text || !message.readingResult?.targetLanguage || !message.readingResult?.provenance) {
      return interruptAssistant(state, state.stopping ? "content.ai.stopped" : "content.ai.incomplete");
    }
    state.terminal = true; activeAssistant = null;
    try { state.port.disconnect(); } catch {}
    const answer = String(message.text || "");
    popover.showAiDetailResult({ explanation: answer }, copyAction(answer, "content.selection.answerCopied"));
    records?.accept(state.queryRecord, { kind: "assistant", targetLanguage: message.readingResult.targetLanguage,
      provenance: message.readingResult.provenance, payload: message.turn },
    { key: state.operation?.operationId, operation: state.operation, sourceLanguage: message.readingResult.sourceLanguage });
    records?.render();
  }

  function stopAssistant(show) {
    const state = activeAssistant;
    if (!state || state.terminal || state.stopping) return;
    state.stopping = true;
    try { state.port?.postMessage({ type: "cancel", requestId: state.requestId }); } catch {}
    if (show && assistantLive(state)) popover.showAiDetailStopping(state.partial);
  }
  function abandonAssistant() {
    const state = activeAssistant;
    if (!state || state.terminal) return;
    state.terminal = true; activeAssistant = null;
    try { state.port?.postMessage({ type: "cancel", requestId: state.requestId }); state.port?.disconnect(); } catch {}
    void records?.discard(state.queryRecord, state.operation);
  }
  function interruptAssistant(state, message) {
    if (state.terminal) return;
    state.terminal = true;
    if (activeAssistant === state) activeAssistant = null;
    try { state.port?.disconnect(); } catch {}
    void records?.discard(state.queryRecord, state.operation);
    if (isCurrentSelection(state.version, state.snapshot, state.expectedPage)) {
      popover.showAiDetailInterrupted(state.partial, message,
        (event) => explainSnapshot(state.snapshot, state.depth, state.baseCard, event, state.action));
    }
  }
  function assistantLive(state) { return activeAssistant === state && !state.terminal && isCurrentSelection(state.version, state.snapshot, state.expectedPage); }
  function ownerToken() { return [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, "0")).join(""); }

  function translateSelection(snapshot, task, version, expectedPage, queryRecord = recordContext) {
    return runTranslation(snapshot, task, version, expectedPage, queryRecord);
  }

  function failureMessage(error) { return error?.i18nKey || "content.selection.errorRetry"; }

  function localizedError(key, code = "") {
    return Object.assign(new Error(t(key)), { i18nKey: key, code: String(code || "") });
  }

  function showResult(snapshot, card, copyText, copiedMessage, onExplain = null, onSaveVocabulary = null, onOpenVocabulary = null) {
    popover.showResult(snapshot, card, copyAction(copyText, copiedMessage), onExplain, onSaveVocabulary, onOpenVocabulary);
    records?.render();
    if (!records) app.modules.selectionRecordStatus?.update({ state: "not-saved", messageKey: "content.reading.recordsUnavailable", messageArgs: {} });
  }

  function loadRich(snapshot, version, expectedPage, queryRecord) {
    return loadRichDictionaryDetails(snapshot, version, expectedPage, isCurrentSelection, (record, dictionary) => {
      records?.accept(queryRecord, model.readingRich(record, dictionary), { key: `rich:${dictionary.id}` });
    });
  }

  function copyAction(copyText, copiedMessageKey) {
    return async () => {
      try {
        await writeSelectionText(copyText);
        showToast(t(copiedMessageKey), "success");
      } catch (error) {
        const message = error?.i18nKey ? t(error.i18nKey) : String(error?.message || error);
        showToast(t("content.selection.copyFailed", { message }), "error");
      }
    };
  }

  function isCurrentSelection(version, snapshot, expectedPage) {
    return version === requestVersion
      && snapshot === activeSnapshot
      && snapshot.sourceRevision === projection.revision()
      && getPageIdentity(location.href) === expectedPage;
  }

  function isCurrentVocabularySelection(snapshot, capture, expectedPage) {
    return isFrozenCurrent(snapshot, capture)
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
    dismiss({ restoreFocus: popover.isEventInsidePanel(event) });
  }

  function dismiss({ restoreFocus = false } = {}) {
    abandonAssistant();
    cancelActiveTask({ showCancelled: false });
    void cancelRichDictionaryDetails();
    void records?.close();
    recordContext = null;
    app.modules.selectionRecordStatus?.clear();
    activeSnapshot = null;
    projection.watchPage(null);
    requestVersion += 1;
    popover.hide({ restoreFocus });
    setQuickControlSelectionActive(false);
  }

  function cancelActiveTask({ showCancelled, snapshot: expectedSnapshot, task: expectedTask, version: expectedVersion }) {
    const task = activeTask;
    if (!task || tasks.isTerminal(task)) return;
    if ((expectedSnapshot && expectedSnapshot !== activeSnapshot)
      || (expectedTask && expectedTask !== task)
      || (expectedVersion !== undefined && expectedVersion !== requestVersion)) return;
    if (showCancelled && task.state === "storing") return;
    tasks.cancelTask(task).catch(() => {});
    if (showCancelled && activeSnapshot) {
      const snapshot = activeSnapshot;
      popover.showError(snapshot, "content.selection.cancelled", (event) => translateSnapshot(snapshot, { event }));
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
