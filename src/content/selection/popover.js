(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.selection || !app?.modules.uiHost ||
    !app?.modules.uiPrimitives || !app?.modules.selectionAiDetail || !app?.modules.selectionEmptyState ||
    !app?.modules.selectionResultRenderer || !app?.modules.selectionVocabularyActions || app.modules.selectionPopover) return;

  const { refreshRect, installInteractionIsolation, clearPageSelection } = app.modules.selection;
  const locale = app.modules.contentI18n;
  const { getLayer, ownsNode, createFocusReturn, isEventInsidePanel: eventInsidePanel } = app.modules.uiHost;
  const { button, surface, status, setStatus } = app.modules.uiPrimitives;
  const { create: createAiDetail } = app.modules.selectionAiDetail;
  const { create: createEmptyState } = app.modules.selectionEmptyState;
  const { create: createVocabularyActions } = app.modules.selectionVocabularyActions;
  const { render: renderStructuredResult } = app.modules.selectionResultRenderer;
  const { appendRichDictionaryDetails: appendRichDetails } = app.modules.selectionResultRenderer;
  const { appendRichDictionaryCards: appendRichCards } = app.modules.selectionResultRenderer;
  const focusReturn = createFocusReturn();

  let root, chip, panel, sourceNode, resultNode, aiDetail, emptyState, statusNode, vocabularyActions;
  let copyButton, explainButton, retryButton, cancelButton, closeButton, activeSnapshot;
  let translateHandler, retryHandler, copyHandler, explainHandler, cancelHandler, closeHandler;

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

    resultNode = document.createElement("div");
    resultNode.className = "tf-selection-result";
    resultNode.setAttribute("aria-live", "polite");
    aiDetail = createAiDetail({ container: resultNode, onResize: reposition });
    emptyState = createEmptyState({ container: resultNode, onResize: reposition });
    vocabularyActions = createVocabularyActions({ onResize: reposition });

    const actions = document.createElement("div");
    actions.className = "tf-selection-actions";

    explainButton = button({
      text: locale.t("content.selection.aiDetail"),
      label: locale.t("content.selection.aiDetailAria"),
      className: "tf-selection-action-primary"
    });
    locale.bindText(explainButton, "content.selection.aiDetail");
    locale.bindAttribute(explainButton, "aria-label", "content.selection.aiDetailAria");
    explainButton.addEventListener("click", (event) => explainHandler?.(event));
    copyButton = button({ text: locale.t("content.common.copy"), className: "tf-selection-action-quiet" });
    locale.bindText(copyButton, "content.common.copy");
    copyButton.addEventListener("click", () => copyHandler?.());
    retryButton = button({ text: locale.t("content.common.retry"), className: "tf-selection-action-primary" });
    locale.bindText(retryButton, "content.common.retry");
    retryButton.addEventListener("click", (event) => retryHandler?.(event));
    cancelButton = button({ text: locale.t("content.common.cancel"), className: "tf-selection-action-quiet" });
    locale.bindText(cancelButton, "content.common.cancel");
    cancelButton.addEventListener("click", () => cancelHandler?.());

    actions.append(explainButton, copyButton, retryButton, cancelButton);
    panel.append(header, sourceNode, statusNode, resultNode, vocabularyActions.ensure(), actions);
    root.append(chip, panel);
    getLayer("selection").appendChild(root);
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
    updateSource(snapshot);
    setLocalizedStatus(statusNode, loadingMessage, "content.selection.loadingText", "loading");
    aiDetail?.reset();
    emptyState?.reset();
    resultNode.replaceChildren();
    resultNode.hidden = true;
    hideActionButtons();
    cancelButton.hidden = false;
    cancelButton.disabled = false;
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

  function showResult(snapshot, result, onCopy, onExplain, onSaveVocabulary, onOpenVocabulary) {
    ensureUi();
    activeSnapshot = snapshot;
    clearActionHandlers();
    copyHandler = onCopy;
    explainHandler = typeof onExplain === "function" ? onExplain : null;
    vocabularyActions.show({ onSave: onSaveVocabulary, onOpen: onOpenVocabulary,
      current: () => snapshot === activeSnapshot && !panel?.hidden });
    chip.hidden = true;
    panel.hidden = false;
    updateSource(snapshot, result);
    locale.unbind(statusNode); setStatus(statusNode, "", "success");
    renderResult(result);
    if (explainHandler) aiDetail.choices(explainHandler);
    resultNode.hidden = false;
    cancelButton.hidden = true;
    copyButton.hidden = false;
    explainButton.hidden = !explainHandler;
    retryButton.hidden = true;
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
    updateSource(snapshot);
    setLocalizedStatus(statusNode, message, "content.selection.errorRetry", "error");
    aiDetail?.reset();
    emptyState?.reset();
    resultNode.replaceChildren();
    resultNode.hidden = true;
    cancelButton.hidden = true;
    copyButton.hidden = true;
    explainButton.hidden = !explainHandler;
    retryButton.hidden = false;
    position(snapshot, panel);
  }

  function renderResult(input) {
    app.modules.richResourceResolver?.closeAll();
    aiDetail?.reset();
    emptyState?.reset();
    const { generatedMeaning, explanation } = renderStructuredResult(resultNode, input);
    aiDetail.ensure();
    if (generatedMeaning || explanation) {
      aiDetail.success({ generatedMeaning, explanation });
    }
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

  function updateSource(snapshot, result = null) {
    const sourceText = String(snapshot?.text || "").trim();
    const headword = String(result?.headword || "").trim();
    const resultKind = String(result?.kind || "");
    const lexicalResult = ["local", "technical", "explained"].includes(resultKind);
    const duplicatesHeadword = lexicalResult
      && headword
      && normalizeDisplayText(sourceText) === normalizeDisplayText(headword);

    sourceNode.textContent = sourceText;
    sourceNode.hidden = !sourceText || duplicatesHeadword;
    sourceNode.dataset.role = lexicalResult ? "lexical-source" : "selection-source";
  }

  function normalizeDisplayText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .trim()
      .toLocaleLowerCase("en-US");
  }

  function showEmpty(snapshot, { titleKey, messageKey, onExplain, onTranslate } = {}) {
    app.modules.richResourceResolver?.closeAll();
    ensureUi();
    activeSnapshot = snapshot;
    clearActionHandlers();
    chip.hidden = true;
    panel.hidden = false;
    updateSource(snapshot);
    locale.unbind(statusNode); setStatus(statusNode, "", "info");
    aiDetail?.reset();
    emptyState?.reset();
    resultNode.replaceChildren();
    resultNode.hidden = false;
    hideActionButtons();
    emptyState.show({ titleKey, messageKey, onExplain, onTranslate });
    if (typeof onExplain === "function") aiDetail.choices(onExplain);
    position(snapshot, panel);
  }

  function showAiDetailLoading(onCancel) {
    ensureUi(); if (!resultNode || resultNode.hidden) return;
    explainHandler = null; explainButton.hidden = true;
    aiDetail.loading(onCancel);
  }

  function showAiDetailStreaming(answer, onStop) {
    ensureUi(); if (!resultNode) return;
    resultNode.hidden = false; explainHandler = null;
    explainButton.hidden = cancelButton.hidden = true;
    aiDetail.streaming(answer, onStop);
  }

  function showAiDetailStopping(answer) {
    ensureUi(); if (!resultNode) return;
    resultNode.hidden = false; cancelButton.hidden = true;
    aiDetail.streaming(answer, null, true);
  }

  function showAiDetailInterrupted(answer, message, onRetry) {
    ensureUi(); if (!resultNode) return;
    resultNode.hidden = false; explainHandler = null; explainButton.hidden = true;
    aiDetail.interrupted(answer, message, onRetry);
  }

  function showAiDetailResult(result, onCopy) {
    ensureUi(); if (!resultNode || resultNode.hidden) return;
    if (typeof onCopy === "function") copyHandler = onCopy;
    explainHandler = null; explainButton.hidden = cancelButton.hidden = true;
    copyButton.hidden = typeof onCopy !== "function";
    aiDetail.success(result);
  }

  function showAiDetailError(message, onRetry) {
    ensureUi(); if (!resultNode || resultNode.hidden) return;
    explainHandler = null; explainButton.hidden = true;
    aiDetail.error(message, onRetry);
  }

  function showAiDetailCancelled(onRetry) {
    ensureUi(); if (!resultNode || resultNode.hidden) return;
    explainHandler = null; explainButton.hidden = true;
    aiDetail.cancelled(onRetry);
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
    root.remove(); panel.removeEventListener("toggle", onDetailsToggle, true);
    root = null;
    chip = null;
    panel = null;
    sourceNode = null;
    aiDetail?.reset();
    emptyState?.reset();
    resultNode = null;
    aiDetail = null;
    emptyState = null;
    statusNode = null;
    vocabularyActions?.dispose();
    vocabularyActions = null;
    copyButton = null;
    explainButton = null;
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
    retryHandler = copyHandler = explainHandler = cancelHandler = null;
    vocabularyActions?.reset();
  }

  function setLocalizedStatus(node, message, fallbackKey, kind) {
    setStatus(node, "", kind);
    const descriptor = typeof message === "string"
      ? { key: message.startsWith("content.") ? message : null, text: message, args: {} }
      : { key: message?.key || fallbackKey, text: "", args: message?.args || {} };
    if (descriptor.key) locale.bindText(node, descriptor.key, descriptor.args);
    else {
      locale.unbind(node);
      node.textContent = descriptor.text || locale.t(fallbackKey);
    }
  }
  function hideActionButtons() {
    cancelButton.hidden = copyButton.hidden = explainButton.hidden = retryButton.hidden = true;
    vocabularyActions?.hide();
  }
  function setCloseHandler(handler) { closeHandler = typeof handler === "function" ? handler : null; }
  function contains(target) { return ownsNode(target); }
  function isEventInsidePanel(event) { return eventInsidePanel(event, panel); }
  function reposition() {
    if (!root || !activeSnapshot) return;
    position(activeSnapshot, !panel?.hidden ? panel : chip);
  }
  function onDetailsToggle(event) { if (event.target?.tagName === "DETAILS") reposition(); }

  function position(snapshot, element) {
    const rect = refreshRect(snapshot);
    if (!rect || !element) return;

    requestAnimationFrame(() => {
      if (!element?.isConnected) return;
      const box = element.getBoundingClientRect();
      const margin = 10;
      const maxWidth = Math.max(0, window.innerWidth - margin * 2);
      let left = rect.left;
      let top = rect.bottom + 8;

      if (box.width > maxWidth) left = margin;
      else if (left + box.width > window.innerWidth - margin) left = window.innerWidth - box.width - margin;
      if (left < margin) left = margin;

      if (top + box.height > window.innerHeight - margin) {
        const above = rect.top - box.height - 8;
        top = above >= margin ? above : margin;
      }
      if (top < margin) top = margin;

      element.style.left = `${Math.round(left)}px`;
      element.style.top = `${Math.round(top)}px`;
    });
  }

  app.modules.selectionPopover = {
    showChip,
    showLoading,
    setLoadingStatus,
    setLoadingCancelable,
    showResult,
    appendRichDictionaryDetails,
    appendRichDictionaryCards,
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
    contains,
    isEventInsidePanel,
    reposition
  };
})();
