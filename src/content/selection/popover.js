(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.selection
    || !app?.modules.uiHost
    || !app?.modules.uiPrimitives
    || !app?.modules.selectionAiDetail
    || !app?.modules.selectionEmptyState
    || !app?.modules.selectionResultRenderer
    || app.modules.selectionPopover
  ) return;

  const { refreshRect, installInteractionIsolation, clearPageSelection } = app.modules.selection;
  const { getLayer, ownsNode } = app.modules.uiHost;
  const { button, surface, status, setStatus } = app.modules.uiPrimitives;
  const { create: createAiDetail } = app.modules.selectionAiDetail;
  const { create: createEmptyState } = app.modules.selectionEmptyState;
  const { render: renderStructuredResult } = app.modules.selectionResultRenderer;
  const { appendRichDictionaryDetails: appendRichDetails } = app.modules.selectionResultRenderer;
  const { appendRichDictionaryCards: appendRichCards } = app.modules.selectionResultRenderer;

  let root;
  let chip;
  let panel;
  let sourceNode;
  let resultNode;
  let aiDetail;
  let emptyState;
  let statusNode;
  let copyButton;
  let explainButton;
  let retryButton;
  let cancelButton;
  let closeButton;
  let activeSnapshot;
  let translateHandler;
  let retryHandler;
  let copyHandler;
  let explainHandler;
  let cancelHandler;
  let closeHandler;

  function ensureUi() {
    if (root?.isConnected) return;

    root = document.createElement("div");
    root.className = "tf-selection-ui";

    chip = button({ text: "译", label: "处理所选文本", className: "tf-selection-chip" });
    chip.addEventListener("pointerdown", (event) => event.preventDefault());
    chip.addEventListener("click", (event) => translateHandler?.(event));

    panel = surface({ className: "tf-selection-panel", role: "dialog" });
    panel.setAttribute("aria-label", "TranslateFlow 划词翻译");
    panel.setAttribute("aria-modal", "false");
    installInteractionIsolation(panel);
    const header = document.createElement("div");
    header.className = "tf-selection-header";
    const title = document.createElement("strong");
    title.textContent = "TranslateFlow";

    closeButton = button({ text: "×", label: "关闭", icon: true, className: "tf-selection-icon-button" });
    closeButton.addEventListener("click", () => closeHandler?.());
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

    const actions = document.createElement("div");
    actions.className = "tf-selection-actions";

    explainButton = button({
      text: "AI 详解",
      label: "使用 AI 结合上下文详解",
      className: "tf-selection-action-primary"
    });
    explainButton.addEventListener("click", (event) => explainHandler?.(event));
    copyButton = button({ text: "复制", className: "tf-selection-action-quiet" });
    copyButton.addEventListener("click", () => copyHandler?.());
    retryButton = button({ text: "重试", className: "tf-selection-action-primary" });
    retryButton.addEventListener("click", (event) => retryHandler?.(event));
    cancelButton = button({ text: "取消", className: "tf-selection-action-quiet" });
    cancelButton.addEventListener("click", () => cancelHandler?.());

    actions.append(explainButton, copyButton, retryButton, cancelButton);
    panel.append(header, sourceNode, statusNode, resultNode, actions);
    root.append(chip, panel);
    getLayer("selection").appendChild(root);
  }

  function showChip(snapshot, onTranslate) {
    app.modules.richResourceResolver?.closeAll();
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
    activeSnapshot = snapshot;
    cancelHandler = onCancel;
    chip.hidden = true;
    panel.hidden = false;
    clearPageSelection();
    updateSource(snapshot);
    setStatus(statusNode, loadingMessage, "loading");
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

  function setLoadingStatus(message) {
    if (!statusNode || panel?.hidden) return;
    setStatus(statusNode, message, "loading");
    reposition();
  }

  function defaultLoadingMessage(snapshot) {
    const text = String(snapshot?.text || "").trim();
    return /^[A-Za-z][A-Za-z’'-]*$/u.test(text)
      ? "正在查词…"
      : "正在处理所选内容…";
  }

  function showResult(snapshot, result, onCopy, onExplain) {
    ensureUi();
    activeSnapshot = snapshot;
    clearActionHandlers();
    copyHandler = onCopy;
    explainHandler = typeof onExplain === "function" ? onExplain : null;
    chip.hidden = true;
    panel.hidden = false;
    updateSource(snapshot, result);
    setStatus(statusNode, "", "success");
    renderResult(result);
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
    setStatus(statusNode, message || "翻译失败，请重试。", "error");
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

  function showEmpty(snapshot, { title, message, onExplain, onTranslate } = {}) {
    app.modules.richResourceResolver?.closeAll();
    ensureUi();
    activeSnapshot = snapshot;
    clearActionHandlers();
    chip.hidden = true;
    panel.hidden = false;
    updateSource(snapshot);
    setStatus(statusNode, "", "info");
    aiDetail?.reset();
    emptyState?.reset();
    resultNode.replaceChildren();
    resultNode.hidden = false;
    hideActionButtons();
    emptyState.show({ title, message, onExplain, onTranslate });
    position(snapshot, panel);
  }

  function showAiDetailLoading(onCancel) {
    ensureUi();
    if (!resultNode || resultNode.hidden) return;
    explainHandler = null;
    explainButton.hidden = true;
    aiDetail.loading(onCancel);
  }

  function showAiDetailResult(result, onCopy) {
    ensureUi();
    if (!resultNode || resultNode.hidden) return;
    if (typeof onCopy === "function") copyHandler = onCopy;
    explainHandler = null;
    explainButton.hidden = true;
    aiDetail.success(result);
  }

  function showAiDetailError(message, onRetry) {
    ensureUi();
    if (!resultNode || resultNode.hidden) return;
    explainHandler = null;
    explainButton.hidden = true;
    aiDetail.error(message, onRetry);
  }

  function showAiDetailCancelled(onRetry) {
    ensureUi();
    if (!resultNode || resultNode.hidden) return;
    explainHandler = null;
    explainButton.hidden = true;
    aiDetail.cancelled(onRetry);
  }

  function uniqueText(values) {
    return [...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )];
  }

  function focusPanelEntry() {
    requestAnimationFrame(() => {
      if (!panel?.hidden && closeButton?.isConnected) {
        closeButton.focus({ preventScroll: true });
      }
    });
  }

  function hide() {
    if (!root) return;
    app.modules.richResourceResolver?.closeAll();
    root.remove();
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
    copyButton = null;
    explainButton = null;
    retryButton = null;
    cancelButton = null;
    closeButton = null;
    activeSnapshot = null;
    translateHandler = null;
    clearActionHandlers();
  }

  function clearActionHandlers() {
    retryHandler = copyHandler = explainHandler = cancelHandler = null;
  }
  function hideActionButtons() {
    cancelButton.hidden = copyButton.hidden = explainButton.hidden = retryButton.hidden = true;
  }

  function setCloseHandler(handler) {
    closeHandler = typeof handler === "function" ? handler : null;
  }

  function contains(target) {
    return ownsNode(target);
  }

  function reposition() {
    if (!root || !activeSnapshot) return;
    const target = !panel?.hidden ? panel : chip;
    if (target) position(activeSnapshot, target);
  }

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
    showResult,
    appendRichDictionaryDetails,
    appendRichDictionaryCards,
    showError,
    showEmpty,
    showAiDetailLoading,
    showAiDetailResult,
    showAiDetailError,
    showAiDetailCancelled,
    hide,
    setCloseHandler,
    contains,
    reposition
  };
})();
