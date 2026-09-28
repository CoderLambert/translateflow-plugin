(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.selection
    || !app?.modules.uiHost
    || !app?.modules.uiPrimitives
    || app.modules.selectionPopover
  ) return;

  const { refreshRect } = app.modules.selection;
  const { getLayer, ownsNode } = app.modules.uiHost;
  const { button, surface, status, setStatus } = app.modules.uiPrimitives;

  let root;
  let chip;
  let panel;
  let sourceNode;
  let resultNode;
  let aiDetailNode;
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

    chip = button({ text: "译", label: "翻译所选文本", className: "tf-selection-chip" });
    chip.addEventListener("pointerdown", (event) => event.preventDefault());
    chip.addEventListener("click", () => translateHandler?.());

    panel = surface({ className: "tf-selection-panel", role: "dialog" });
    panel.setAttribute("aria-label", "TranslateFlow 划词翻译");
    panel.setAttribute("aria-modal", "false");

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

    const actions = document.createElement("div");
    actions.className = "tf-selection-actions";

    cancelButton = button({ text: "取消" });
    cancelButton.addEventListener("click", () => cancelHandler?.());
    copyButton = button({ text: "复制" });
    copyButton.addEventListener("click", () => copyHandler?.());
    explainButton = button({ text: "AI 详解", label: "使用 AI 结合上下文详解" });
    explainButton.addEventListener("click", () => explainHandler?.());
    retryButton = button({ text: "重试" });
    retryButton.addEventListener("click", () => retryHandler?.());

    actions.append(cancelButton, copyButton, explainButton, retryButton);
    panel.append(header, sourceNode, statusNode, resultNode, actions);
    root.append(chip, panel);
    getLayer("selection").appendChild(root);
  }

  function showChip(snapshot, onTranslate) {
    ensureUi();
    activeSnapshot = snapshot;
    translateHandler = onTranslate;
    retryHandler = null;
    copyHandler = null;
    explainHandler = null;
    cancelHandler = null;
    panel.hidden = true;
    chip.hidden = false;
    position(snapshot, chip);
  }

  function showLoading(snapshot, onCancel) {
    ensureUi();
    activeSnapshot = snapshot;
    cancelHandler = onCancel;
    chip.hidden = true;
    panel.hidden = false;
    sourceNode.textContent = snapshot.text;
    setStatus(statusNode, "正在检查缓存…", "loading");
    aiDetailNode = null;
    resultNode.replaceChildren();
    resultNode.hidden = true;
    cancelButton.hidden = false;
    cancelButton.disabled = false;
    copyButton.hidden = true;
    explainButton.hidden = true;
    retryButton.hidden = true;
    position(snapshot, panel);
    focusPanelEntry();
  }

  function setLoadingStatus(message) {
    if (!statusNode || panel?.hidden) return;
    setStatus(statusNode, message, "loading");
    reposition();
  }

  function showResult(snapshot, result, onCopy, onExplain) {
    ensureUi();
    activeSnapshot = snapshot;
    copyHandler = onCopy;
    explainHandler = typeof onExplain === "function" ? onExplain : null;
    retryHandler = null;
    cancelHandler = null;
    chip.hidden = true;
    panel.hidden = false;
    sourceNode.textContent = snapshot.text;
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
    ensureUi();
    activeSnapshot = snapshot;
    retryHandler = onRetry;
    copyHandler = null;
    explainHandler = typeof onExplain === "function" ? onExplain : null;
    cancelHandler = null;
    chip.hidden = true;
    panel.hidden = false;
    sourceNode.textContent = snapshot.text;
    setStatus(statusNode, message || "翻译失败，请重试。", "error");
    aiDetailNode = null;
    resultNode.replaceChildren();
    resultNode.hidden = true;
    cancelButton.hidden = true;
    copyButton.hidden = true;
    explainButton.hidden = !explainHandler;
    retryButton.hidden = false;
    position(snapshot, panel);
  }

  function renderResult(input) {
    aiDetailNode = null;
    resultNode.replaceChildren();
    const result = typeof input === "string"
      ? { kind: "translation", primaryMeaning: input }
      : (input || {});

    resultNode.dataset.resultKind = String(result.kind || "translation");

    const meta = document.createElement("div");
    meta.className = "tf-selection-result-meta";

    for (const item of Array.isArray(result.badges) ? result.badges : []) {
      const label = String(item?.label || "").trim();
      if (!label) continue;
      const badge = document.createElement("span");
      badge.className = "tf-selection-result-badge";
      badge.dataset.kind = String(item?.kind || "local");
      badge.textContent = label;
      meta.appendChild(badge);
    }
    if (meta.childElementCount) resultNode.appendChild(meta);

    const headword = String(result.headword || "").trim();
    const pronunciation = String(result.pronunciation || "").trim();
    const partOfSpeech = String(result.partOfSpeech || "").trim();
    if (headword || pronunciation || partOfSpeech) {
      const heading = document.createElement("div");
      heading.className = "tf-selection-headword-row";
      if (headword) {
        const strong = document.createElement("strong");
        strong.className = "tf-selection-headword";
        strong.textContent = headword;
        heading.appendChild(strong);
      }
      const details = [pronunciation, partOfSpeech].filter(Boolean);
      if (details.length) {
        const secondary = document.createElement("span");
        secondary.className = "tf-selection-headword-meta";
        secondary.textContent = details.join(" · ");
        heading.appendChild(secondary);
      }
      resultNode.appendChild(heading);
    }

    const primary = String(result.primaryMeaning || "").trim();
    if (primary) {
      const node = document.createElement("div");
      node.className = "tf-selection-primary";
      node.textContent = primary;
      resultNode.appendChild(node);
    }

    const senses = uniqueText(result.senses);
    if (senses.length) {
      const list = document.createElement("div");
      list.className = "tf-selection-senses";
      for (const sense of senses.slice(0, 5)) {
        const row = document.createElement("div");
        row.textContent = sense;
        list.appendChild(row);
      }
      resultNode.appendChild(list);
    }

    const facts = uniqueText([
      ...(Array.isArray(result.domains) ? result.domains : []),
      ...(Array.isArray(result.typeLabels) ? result.typeLabels : [])
    ]);
    if (facts.length) {
      const factRow = document.createElement("div");
      factRow.className = "tf-selection-facts";
      for (const fact of facts.slice(0, 6)) {
        const item = document.createElement("span");
        item.textContent = fact;
        factRow.appendChild(item);
      }
      resultNode.appendChild(factRow);
    }

    const generatedMeaning = String(result.generatedMeaning || "").trim();
    const explanation = String(result.explanation || "").trim();

    if (!resultNode.childElementCount && !generatedMeaning && !explanation) {
      const empty = document.createElement("div");
      empty.className = "tf-selection-primary";
      empty.textContent = "暂无可展示结果。";
      resultNode.appendChild(empty);
    }

    ensureAiDetailNode();
    if (generatedMeaning || explanation) {
      renderAiDetail({
        state: "success",
        generatedMeaning,
        explanation
      });
    }
  }

  function showAiDetailLoading(onCancel) {
    ensureUi();
    if (!resultNode || resultNode.hidden) return;
    explainHandler = null;
    explainButton.hidden = true;
    renderAiDetail({
      state: "loading",
      message: "正在结合上下文解释…",
      onCancel
    });
    reposition();
  }

  function showAiDetailResult(result, onCopy) {
    ensureUi();
    if (!resultNode || resultNode.hidden) return;
    if (typeof onCopy === "function") copyHandler = onCopy;
    explainHandler = null;
    explainButton.hidden = true;
    renderAiDetail({
      state: "success",
      generatedMeaning: String(result?.generatedMeaning || "").trim(),
      explanation: String(result?.explanation || "").trim()
    });
    reposition();
  }

  function showAiDetailError(message, onRetry) {
    ensureUi();
    if (!resultNode || resultNode.hidden) return;
    explainHandler = null;
    explainButton.hidden = true;
    renderAiDetail({
      state: "error",
      message: message || "AI 详解暂不可用。",
      onRetry
    });
    reposition();
  }

  function showAiDetailCancelled(onRetry) {
    ensureUi();
    if (!resultNode || resultNode.hidden) return;
    explainHandler = null;
    explainButton.hidden = true;
    renderAiDetail({
      state: "cancelled",
      message: "AI 详解已取消。",
      onRetry
    });
    reposition();
  }

  function ensureAiDetailNode() {
    if (aiDetailNode?.isConnected) return aiDetailNode;
    aiDetailNode = document.createElement("section");
    aiDetailNode.className = "tf-selection-generated tf-selection-ai-detail";
    aiDetailNode.setAttribute("aria-live", "polite");
    aiDetailNode.hidden = true;
    resultNode.appendChild(aiDetailNode);
    return aiDetailNode;
  }

  function renderAiDetail({
    state = "idle",
    message = "",
    generatedMeaning = "",
    explanation = "",
    onRetry = null,
    onCancel = null
  } = {}) {
    const node = ensureAiDetailNode();
    node.replaceChildren();
    node.hidden = state === "idle";
    node.dataset.state = state;
    node.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    if (node.hidden) return;

    const header = document.createElement("div");
    header.className = "tf-selection-ai-header";
    const label = document.createElement("div");
    label.className = "tf-selection-generated-label";
    label.textContent = "AI 详解";
    header.appendChild(label);

    if (state === "success") {
      const badge = document.createElement("span");
      badge.className = "tf-selection-result-badge";
      badge.dataset.kind = "ai";
      badge.textContent = "AI 辅助";
      header.appendChild(badge);
    }
    node.appendChild(header);

    if (state === "success") {
      if (generatedMeaning) {
        const meaning = document.createElement("div");
        meaning.className = "tf-selection-generated-meaning";
        meaning.textContent = generatedMeaning;
        node.appendChild(meaning);
      }
      if (explanation) {
        const body = document.createElement("div");
        body.className = "tf-selection-generated-body";
        body.textContent = explanation;
        node.appendChild(body);
      }
      return;
    }

    const statusNode = document.createElement("div");
    statusNode.className = "tf-selection-ai-status";
    statusNode.dataset.kind = state;
    statusNode.textContent = message;
    node.appendChild(statusNode);

    if (typeof onRetry === "function" || typeof onCancel === "function") {
      const actions = document.createElement("div");
      actions.className = "tf-selection-ai-actions";
      if (typeof onRetry === "function") {
        const retry = button({ text: "重试", label: "重新请求 AI 详解" });
        retry.addEventListener("click", () => onRetry());
        actions.appendChild(retry);
      }
      if (typeof onCancel === "function") {
        const cancel = button({ text: "取消", label: "取消 AI 详解" });
        cancel.addEventListener("click", () => onCancel());
        actions.appendChild(cancel);
      }
      node.appendChild(actions);
    }
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
    root.remove();
    root = null;
    chip = null;
    panel = null;
    sourceNode = null;
    resultNode = null;
    aiDetailNode = null;
    statusNode = null;
    copyButton = null;
    explainButton = null;
    retryButton = null;
    cancelButton = null;
    closeButton = null;
    activeSnapshot = null;
    translateHandler = null;
    retryHandler = null;
    copyHandler = null;
    explainHandler = null;
    cancelHandler = null;
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
    showError,
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
