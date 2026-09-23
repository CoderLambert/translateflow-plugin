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
  let statusNode;
  let copyButton;
  let retryButton;
  let cancelButton;
  let activeSnapshot;
  let translateHandler;
  let retryHandler;
  let copyHandler;
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

    const header = document.createElement("div");
    header.className = "tf-selection-header";
    const title = document.createElement("strong");
    title.textContent = "TranslateFlow";

    const closeButton = button({ text: "×", label: "关闭", icon: true, className: "tf-selection-icon-button" });
    closeButton.addEventListener("click", () => closeHandler?.());
    header.append(title, closeButton);

    sourceNode = document.createElement("div");
    sourceNode.className = "tf-selection-source";

    statusNode = status({ className: "tf-selection-status" });

    resultNode = document.createElement("div");
    resultNode.className = "tf-selection-result";

    const actions = document.createElement("div");
    actions.className = "tf-selection-actions";

    cancelButton = button({ text: "取消" });
    cancelButton.addEventListener("click", () => cancelHandler?.());
    copyButton = button({ text: "复制" });
    copyButton.addEventListener("click", () => copyHandler?.());
    retryButton = button({ text: "重试" });
    retryButton.addEventListener("click", () => retryHandler?.());

    actions.append(cancelButton, copyButton, retryButton);
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
    resultNode.textContent = "";
    resultNode.hidden = true;
    cancelButton.hidden = false;
    cancelButton.disabled = false;
    copyButton.hidden = true;
    retryButton.hidden = true;
    position(snapshot, panel);
  }

  function setLoadingStatus(message) {
    if (!statusNode || panel?.hidden) return;
    setStatus(statusNode, message, "loading");
  }

  function showResult(snapshot, translation, onCopy) {
    ensureUi();
    activeSnapshot = snapshot;
    copyHandler = onCopy;
    retryHandler = null;
    cancelHandler = null;
    chip.hidden = true;
    panel.hidden = false;
    sourceNode.textContent = snapshot.text;
    setStatus(statusNode, "", "success");
    resultNode.textContent = translation;
    resultNode.hidden = false;
    cancelButton.hidden = true;
    copyButton.hidden = false;
    retryButton.hidden = true;
    position(snapshot, panel);
  }

  function showError(snapshot, message, onRetry) {
    ensureUi();
    activeSnapshot = snapshot;
    retryHandler = onRetry;
    copyHandler = null;
    cancelHandler = null;
    chip.hidden = true;
    panel.hidden = false;
    sourceNode.textContent = snapshot.text;
    setStatus(statusNode, message || "翻译失败，请重试。", "error");
    resultNode.textContent = "";
    resultNode.hidden = true;
    cancelButton.hidden = true;
    copyButton.hidden = true;
    retryButton.hidden = false;
    position(snapshot, panel);
  }

  function hide() {
    if (!root) return;
    root.remove();
    root = null;
    chip = null;
    panel = null;
    sourceNode = null;
    resultNode = null;
    statusNode = null;
    copyButton = null;
    retryButton = null;
    cancelButton = null;
    activeSnapshot = null;
    translateHandler = null;
    retryHandler = null;
    copyHandler = null;
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
      let left = rect.left;
      let top = rect.bottom + 8;

      if (left + box.width > window.innerWidth - margin) left = window.innerWidth - box.width - margin;
      if (left < margin) left = margin;
      if (top + box.height > window.innerHeight - margin) top = Math.max(margin, rect.top - box.height - 8);
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
    hide,
    setCloseHandler,
    contains,
    reposition
  };
})();
