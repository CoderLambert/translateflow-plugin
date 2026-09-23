(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.selection || app.modules.selectionPopover) return;

  const { constants } = app.modules.runtime;
  const { refreshRect } = app.modules.selection;
  const { EXTENSION_UI_ATTR } = constants;

  let root;
  let chip;
  let panel;
  let sourceNode;
  let resultNode;
  let statusNode;
  let copyButton;
  let retryButton;
  let activeSnapshot;
  let translateHandler;
  let retryHandler;
  let copyHandler;
  let closeHandler;

  function ensureUi() {
    if (root?.isConnected) return;

    root = document.createElement("div");
    root.className = "tf-selection-ui";
    root.setAttribute(EXTENSION_UI_ATTR, "selection");

    chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tf-selection-chip";
    chip.textContent = "译";
    chip.setAttribute("aria-label", "翻译所选文本");
    chip.addEventListener("pointerdown", (event) => event.preventDefault());
    chip.addEventListener("click", () => translateHandler?.());

    panel = document.createElement("section");
    panel.className = "tf-selection-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "TranslateFlow 划词翻译");

    const header = document.createElement("div");
    header.className = "tf-selection-header";

    const title = document.createElement("strong");
    title.textContent = "TranslateFlow";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "tf-selection-icon-button";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "关闭");
    closeButton.addEventListener("click", () => closeHandler?.());
    header.append(title, closeButton);

    sourceNode = document.createElement("div");
    sourceNode.className = "tf-selection-source";

    statusNode = document.createElement("div");
    statusNode.className = "tf-selection-status";
    statusNode.setAttribute("aria-live", "polite");

    resultNode = document.createElement("div");
    resultNode.className = "tf-selection-result";

    const actions = document.createElement("div");
    actions.className = "tf-selection-actions";

    copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "复制";
    copyButton.addEventListener("click", () => copyHandler?.());

    retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = "重试";
    retryButton.addEventListener("click", () => retryHandler?.());

    actions.append(copyButton, retryButton);
    panel.append(header, sourceNode, statusNode, resultNode, actions);
    root.append(chip, panel);
    document.documentElement.appendChild(root);
  }

  function showChip(snapshot, onTranslate) {
    ensureUi();
    activeSnapshot = snapshot;
    translateHandler = onTranslate;
    retryHandler = null;
    copyHandler = null;
    panel.hidden = true;
    chip.hidden = false;
    position(snapshot, chip);
  }

  function showLoading(snapshot) {
    ensureUi();
    activeSnapshot = snapshot;
    chip.hidden = true;
    panel.hidden = false;
    sourceNode.textContent = snapshot.text;
    statusNode.textContent = "正在翻译…";
    statusNode.dataset.kind = "loading";
    resultNode.textContent = "";
    resultNode.hidden = true;
    copyButton.hidden = true;
    retryButton.hidden = true;
    position(snapshot, panel);
  }

  function showResult(snapshot, translation, onCopy) {
    ensureUi();
    activeSnapshot = snapshot;
    copyHandler = onCopy;
    retryHandler = null;
    chip.hidden = true;
    panel.hidden = false;
    sourceNode.textContent = snapshot.text;
    statusNode.textContent = "";
    statusNode.dataset.kind = "success";
    resultNode.textContent = translation;
    resultNode.hidden = false;
    copyButton.hidden = false;
    retryButton.hidden = true;
    position(snapshot, panel);
  }

  function showError(snapshot, message, onRetry) {
    ensureUi();
    activeSnapshot = snapshot;
    retryHandler = onRetry;
    copyHandler = null;
    chip.hidden = true;
    panel.hidden = false;
    sourceNode.textContent = snapshot.text;
    statusNode.textContent = message || "翻译失败，请重试。";
    statusNode.dataset.kind = "error";
    resultNode.textContent = "";
    resultNode.hidden = true;
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
    activeSnapshot = null;
    translateHandler = null;
    retryHandler = null;
    copyHandler = null;
  }

  function setCloseHandler(handler) {
    closeHandler = typeof handler === "function" ? handler : null;
  }

  function contains(target) {
    return Boolean(root && target instanceof Node && root.contains(target));
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

      if (left + box.width > window.innerWidth - margin) {
        left = window.innerWidth - box.width - margin;
      }
      if (left < margin) left = margin;

      if (top + box.height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - box.height - 8);
      }
      if (top < margin) top = margin;

      element.style.left = `${Math.round(left)}px`;
      element.style.top = `${Math.round(top)}px`;
    });
  }

  app.modules.selectionPopover = {
    showChip,
    showLoading,
    showResult,
    showError,
    hide,
    setCloseHandler,
    contains,
    reposition
  };
})();
