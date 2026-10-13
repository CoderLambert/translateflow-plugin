(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.selection || !app?.modules.uiHost ||
    !app?.modules.uiPrimitives || !app?.modules.selectionViewTabs || !app?.modules.selectionEmptyState ||
    !app?.modules.selectionResultRenderer || app.modules.selectionPopover) return;

  const { installInteractionIsolation, clearPageSelection, positionPopover } = app.modules.selection;
  const locale = app.modules.contentI18n;
  const { getLayer, ownsNode, createFocusReturn, isEventInsidePanel: eventInsidePanel } = app.modules.uiHost;
  const { button, surface, status, setStatus } = app.modules.uiPrimitives;
  const { create: createViewTabs } = app.modules.selectionViewTabs;
  const { create: createEmptyState } = app.modules.selectionEmptyState;
  const createVocabularyActions = app.modules.selectionVocabularyActions?.create;
  const { render: renderStructuredResult, appendRichDictionaryDetails: appendRichDetails,
    appendRichDictionaryCards: appendRichCards, updateSource, setLocalizedStatus } = app.modules.selectionResultRenderer;
  const focusReturn = createFocusReturn();
  let root, chip, panel, sourceNode, resultNode, workspace, tabList, emptyState, statusNode, vocabularyActions,
    footerActions, retryButton, cancelButton, closeButton, activeSnapshot;
  let translateHandler, retryHandler, explainHandler, cancelHandler, closeHandler,
    localEmptyOptions = null, readingLayout, viewTabs;

  function ensureUi() {
    if (root?.isConnected) return;
    root = document.createElement("div");
    root.className = "tf-selection-ui";

    chip = button({ text: locale.t("content.selection.chipMark"), label: locale.t("content.selection.process"), className: "tf-selection-chip" });
    locale.bindText(chip, "content.selection.chipMark");
    locale.bindAttribute(chip, "aria-label", "content.selection.process");
    chip.addEventListener("pointerdown", (event) => event.preventDefault());
    chip.addEventListener("click", (event) => translateHandler?.(event));

    panel = surface({ className: "tf-selection-panel", role: "dialog" });
    locale.bindAttribute(panel, "aria-label", "content.selection.aria");
    panel.setAttribute("aria-modal", "false"); panel.addEventListener("toggle", onDetailsToggle, true);
    installInteractionIsolation(panel);
    const header = document.createElement("div");
    header.className = "tf-selection-header";
    const title = document.createElement("strong");
    title.textContent = "TranslateFlow";

    closeButton = button({ text: "×", label: locale.t("content.common.close"), icon: true, className: "tf-selection-icon-button" });
    locale.bindAttribute(closeButton, "aria-label", "content.common.close");
    closeButton.addEventListener("click", (event) => closeHandler?.({ restoreFocus: eventInsidePanel(event, panel) }));
    header.append(title, closeButton);

    sourceNode = document.createElement("div");
    sourceNode.className = "tf-selection-source";
    statusNode = status({ className: "tf-selection-status" });
    statusNode.setAttribute("aria-live", "polite");

    tabList = document.createElement("div");
    tabList.className = "tf-selection-view-tabs";
    tabList.setAttribute("role", "tablist");
    locale.bindAttribute(tabList, "aria-label", "content.selection.viewTabsAria");
    tabList.hidden = true;

    workspace = document.createElement("div");
    workspace.className = "tf-selection-workspace";

    resultNode = document.createElement("div");
    resultNode.className = "tf-selection-result tf-selection-view-panel tf-selection-dictionary-panel";
    resultNode.id = "tf-selection-panel-dictionary";
    resultNode.setAttribute("role", "tabpanel");
    resultNode.setAttribute("aria-labelledby", "tf-selection-tab-dictionary");
    resultNode.setAttribute("aria-live", "polite");
    emptyState = createEmptyState({ container: resultNode, onResize: reposition });
    vocabularyActions = createVocabularyActions?.({ onResize: reposition }) || { ensure: () => document.createDocumentFragment(), show() {}, setActive() {}, reset() {}, hide() {}, dispose() {} };
    workspace.appendChild(resultNode);
    viewTabs = createViewTabs({ tabList, workspace, dictionaryPane: resultNode,
      onDictionaryLeave: suspendDictionaryTransients,
      onRequest: (event, action, handler) => handler(event, action),
      onChange: syncView,
      onResize: reposition });

    footerActions = document.createElement("div");
    footerActions.className = "tf-selection-actions tf-selection-footer-actions";
    retryButton = button({ text: locale.t("content.common.retry"), className: "tf-selection-action-primary" });
    locale.bindText(retryButton, "content.common.retry");
    retryButton.addEventListener("click", (event) => retryHandler?.(event));
    retryButton.hidden = true;
    cancelButton = button({ text: locale.t("content.common.cancel"), className: "tf-selection-action-quiet" });
    locale.bindText(cancelButton, "content.common.cancel");
    cancelButton.addEventListener("click", () => cancelHandler?.());
    cancelButton.hidden = true;

    footerActions.append(vocabularyActions.ensure(), retryButton, cancelButton);
    panel.append(header, sourceNode, statusNode, tabList, workspace, footerActions);
    root.append(chip, panel);
    getLayer("selection").appendChild(root);
    readingLayout = app.modules.selection.createReadingLayout?.({ panel, result: resultNode, header, onResize: reposition });
    viewTabs.selectDictionary();
  }

  function configureTabs(handler, visible) {
    explainHandler = typeof handler === "function" ? handler : null;
    viewTabs.configure(explainHandler, visible);
  }

  function syncView(view = viewTabs?.active?.() || "dictionary") {
    if (!retryButton || !statusNode) return;
    panel.dataset.selectionView = view;
    readingLayout?.setActiveView?.(view);
    vocabularyActions?.setActive?.(view === "dictionary");
    retryButton.hidden = view !== "dictionary" || typeof retryHandler !== "function";
    statusNode.hidden = !tabList.hidden && view !== "dictionary";
    syncFooterVisibility();
    reposition();
  }

  function suspendDictionaryTransients() {
    for (const host of resultNode?.querySelectorAll(".tf-selection-rich-text") || []) {
      app.modules.richResourceResolver?.stopAudio(host);
      app.modules.richResourceResolver?.closeImagePreview(host);
    }
    app.modules.richOxfordAdapter?.dismissTransients?.(resultNode);
  }
  function syncFooterVisibility() {
    if (!footerActions) return;
    const vocabulary = vocabularyActions?.ensure?.();
    footerActions.hidden = Boolean(vocabulary?.hidden && retryButton?.hidden && cancelButton?.hidden);
  }

  function showChip(snapshot, onTranslate) {
    app.modules.richResourceResolver?.closeAll();
    focusReturn.capture(document.activeElement);
    ensureUi();
    activeSnapshot = snapshot;
    translateHandler = onTranslate;
    clearActionHandlers();
    panel.hidden = true;
    chip.hidden = false;
    position(snapshot, chip);
  }

  function showLoading(snapshot, onCancel, loadingMessage = defaultLoadingMessage(snapshot)) {
    app.modules.richResourceResolver?.closeAll();
    ensureUi();
    focusReturn.capture(document.activeElement);
    activeSnapshot = snapshot;
    cancelHandler = onCancel;
    chip.hidden = true;
    panel.hidden = false;
    clearPageSelection();
    updateSource(sourceNode, snapshot);
    setLocalizedStatus(statusNode, loadingMessage, "content.selection.loadingText", "loading");
    viewTabs.reset();
    emptyState?.reset();
    resultNode.replaceChildren();
    resultNode.hidden = true;
    configureTabs(null, false);
    viewTabs.selectDictionary();
    hideActionButtons();
    cancelButton.hidden = false;
    cancelButton.disabled = false;
    syncFooterVisibility();
    position(snapshot, panel);
    focusPanelEntry();
  }

  function setLoadingStatus(message, args = {}) {
    if (!statusNode || panel?.hidden) return;
    setLocalizedStatus(statusNode, typeof message === "string" && !message.startsWith("content.") ? message : { key: message, args }, "content.selection.loadingText", "loading");
    reposition();
  }

  function setLoadingCancelable(cancelable) {
    if (cancelButton && !cancelButton.hidden) cancelButton.disabled = !cancelable;
  }

  function defaultLoadingMessage(snapshot) {
    const text = String(snapshot?.text || "").trim();
    return /^[A-Za-z][A-Za-z’'-]*$/u.test(text)
      ? "content.selection.loadingWord"
      : "content.selection.loadingText";
  }

  function showResult(snapshot, result, onExplain, onSaveVocabulary, onOpenVocabulary) {
    ensureUi();
    activeSnapshot = snapshot;
    clearActionHandlers();
    explainHandler = typeof onExplain === "function" ? onExplain : null;
    vocabularyActions.show({ onSave: onSaveVocabulary, onOpen: onOpenVocabulary,
      current: () => snapshot === activeSnapshot && !panel?.hidden });
    chip.hidden = true;
    panel.hidden = false;
    updateSource(sourceNode, snapshot, result);
    locale.unbind(statusNode); setStatus(statusNode, "", "success");
    const hasGenerated = renderResult(result);
    configureTabs(explainHandler, Boolean(explainHandler || hasGenerated));
    viewTabs.selectDictionary();
    resultNode.hidden = false;
    cancelButton.hidden = true;
    retryButton.hidden = true;
    syncView();
    position(snapshot, panel);
  }

  function showError(snapshot, message, onRetry, onExplain) {
    app.modules.richResourceResolver?.closeAll();
    ensureUi();
    activeSnapshot = snapshot;
    clearActionHandlers();
    retryHandler = onRetry;
    explainHandler = typeof onExplain === "function" ? onExplain : null;
    chip.hidden = true;
    panel.hidden = false;
    updateSource(sourceNode, snapshot);
    setLocalizedStatus(statusNode, message, "content.selection.errorRetry", "error");
    viewTabs.reset();
    emptyState?.reset();
    resultNode.replaceChildren();
    resultNode.hidden = false;
    configureTabs(explainHandler, Boolean(explainHandler));
    viewTabs.selectDictionary();
    cancelButton.hidden = true;
    retryButton.hidden = false;
    syncFooterVisibility();
    position(snapshot, panel);
  }

  function renderResult(input) {
    app.modules.richResourceResolver?.closeAll();
    viewTabs.reset();
    emptyState?.reset();
    const { generatedMeaning, explanation } = renderStructuredResult(resultNode, input);
    if (generatedMeaning || explanation) {
      viewTabs.success("understand", { generatedMeaning, explanation });
      return true;
    }
    return false;
  }

  function appendRichDictionaryDetails(response) {
    ensureUi();
    if (!resultNode || panel.hidden) return false;
    const appended = appendRichDetails(resultNode, response);
    if (appended) {
      resultNode.hidden = false;
      reposition();
    }
    return appended;
  }

  function appendRichDictionaryCards(dictionaries, onLookup) {
    ensureUi();
    if (!resultNode || panel.hidden) return false;
    const cards = appendRichCards(resultNode, dictionaries, onLookup);
    if (cards.length) {
      resultNode.hidden = false;
      reposition();
    }
    return cards.length > 0;
  }

  function updateRichDictionarySummary(snapshot, summary) {
    if (snapshot !== activeSnapshot || panel?.hidden || !localEmptyOptions) return;
    if (summary.hasHit) {
      emptyState?.reset();
      reposition();
      return;
    }
    emptyState.show({ ...localEmptyOptions, ...summary.feedback });
    reposition();
  }

  function showVocabularyActions(snapshot, onSave, onOpen) { ensureUi();
    if (snapshot !== activeSnapshot || panel?.hidden || typeof onSave !== "function") return false;
    vocabularyActions.show({ onSave, onOpen, current: () => snapshot === activeSnapshot && !panel?.hidden }); syncFooterVisibility(); reposition(); return true; }
  function showEmpty(snapshot, { titleKey, messageKey, onExplain, onTranslate } = {}) {
    app.modules.richResourceResolver?.closeAll();
    ensureUi();
    activeSnapshot = snapshot;
    clearActionHandlers();
    chip.hidden = true;
    panel.hidden = false;
    updateSource(sourceNode, snapshot);
    locale.unbind(statusNode); setStatus(statusNode, "", "info");
    viewTabs.reset();
    emptyState?.reset();
    resultNode.replaceChildren();
    resultNode.hidden = false;
    hideActionButtons();
    localEmptyOptions = { titleKey, messageKey, onExplain: null, onTranslate };
    emptyState.show(localEmptyOptions);
    explainHandler = typeof onExplain === "function" ? onExplain : null;
    configureTabs(explainHandler, Boolean(explainHandler));
    viewTabs.selectDictionary();
    position(snapshot, panel);
  }
  function showAiDetailLoading(onCancel, action = "understand") {
    ensureUi(); viewTabs.loading(action, onCancel);
  }
  function showAiDetailStreaming(answer, onStop, action = "understand") {
    ensureUi(); locale.unbind(statusNode); setStatus(statusNode, "", "info"); cancelButton.hidden = true;
    viewTabs.streaming(action, answer, onStop);
  }

  function showAiDetailStopping(answer, action = "understand") {
    ensureUi(); cancelButton.hidden = true; viewTabs.stopping(action, answer);
  }

  function showAiDetailInterrupted(answer, message, onRetry, action = "understand") {
    ensureUi(); viewTabs.interrupted(action, answer, message, onRetry);
  }

  function showAiDetailResult(result, action = "understand") {
    ensureUi(); locale.unbind(statusNode); setStatus(statusNode, "", "success");
    cancelButton.hidden = true;
    viewTabs.success(action, result);
  }

  function showAiDetailError(message, onRetry, action = "understand") {
    ensureUi(); viewTabs.error(action, message, onRetry);
  }

  function showAiDetailCancelled(onRetry, action = "understand") {
    ensureUi(); viewTabs.cancelled(action, onRetry);
  }

  function focusPanelEntry() {
    requestAnimationFrame(() => {
      if (!panel?.hidden && closeButton?.isConnected) {
        closeButton.focus({ preventScroll: true });
      }
    });
  }

  function hide({ restoreFocus = false } = {}) {
    if (!root) return;
    app.modules.richResourceResolver?.closeAll();
    locale.unbindTree(root);
    readingLayout?.dispose(); readingLayout = null;
    root.remove(); panel.removeEventListener("toggle", onDetailsToggle, true);
    root = null;
    chip = null;
    panel = null;
    sourceNode = null;
    viewTabs?.dispose(); viewTabs = null;
    emptyState?.reset();
    resultNode = null;
    workspace = null;
    tabList = null;
    emptyState = null;
    statusNode = null;
    vocabularyActions?.dispose();
    vocabularyActions = null;
    footerActions = null;
    retryButton = null;
    cancelButton = null;
    closeButton = null;
    activeSnapshot = null;
    translateHandler = null;
    clearActionHandlers();
    if (restoreFocus) focusReturn.restore();
    else focusReturn.clear();
  }

  function clearActionHandlers() {
    localEmptyOptions = null;
    retryHandler = explainHandler = cancelHandler = null;
    vocabularyActions?.reset();
  }

  function hideActionButtons() {
    cancelButton.hidden = retryButton.hidden = true;
    vocabularyActions?.hide();
    syncFooterVisibility();
  }
  function setCloseHandler(handler) { closeHandler = typeof handler === "function" ? handler : null; }
  function contains(target) { return ownsNode(target); }
  function isEventInsidePanel(event) { return eventInsidePanel(event, panel); }
  function reposition() {
    if (!root || !activeSnapshot) return;
    position(activeSnapshot, !panel?.hidden ? panel : chip);
  }
  function onDetailsToggle(event) { if (event.target?.tagName === "DETAILS") reposition(); }
  function position(snapshot, element) { readingLayout?.update(snapshot); positionPopover({ snapshot, element, panel }); }

  app.modules.selectionPopover = {
    showChip,
    showLoading,
    setLoadingStatus,
    setLoadingCancelable,
    showResult,
    appendRichDictionaryDetails,
    appendRichDictionaryCards,
    updateRichDictionarySummary,
    showVocabularyActions,
    showError,
    showEmpty,
    showAiDetailLoading,
    showAiDetailStreaming,
    showAiDetailStopping,
    showAiDetailInterrupted,
    showAiDetailResult,
    showAiDetailError,
    showAiDetailCancelled,
    hide,
    setCloseHandler,
    consumeRichEscape: (event) => !panel?.hidden && isEventInsidePanel(event) && app.modules.richOxfordAdapter?.consumeEscape(event, panel),
    contains,
    isEventInsidePanel,
    reposition
  };
})();
