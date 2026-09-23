(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.uiHost
    || !app?.modules.uiPrimitives
    || app.modules.quickControlView
  ) return;

  const { getLayer } = app.modules.uiHost;
  const {
    button,
    surface,
    status,
    setStatus,
    badge,
    progress,
    setProgress
  } = app.modules.uiPrimitives;

  function create(handlers = {}) {
    let root;
    let trigger;
    let panel;
    let stateBadge;
    let statusNode;
    let progressNode;
    let translateButton;
    let retryButton;
    let cancelButton;
    let autoButton;
    let presetSelect;
    let appearanceSelect;

    function ensure() {
      if (root?.isConnected) return api;

      root = document.createElement("div");
      root.className = "tf-quick-control";
      root.setAttribute("data-tf-quick-control", "");

      trigger = button({
        text: "译",
        label: "TranslateFlow Quick Control",
        className: "tf-quick-trigger"
      });
      trigger.setAttribute("aria-expanded", "false");
      trigger.addEventListener("click", () => handlers.onToggle?.());

      panel = surface({ className: "tf-quick-panel", role: "dialog" });
      panel.setAttribute("aria-label", "TranslateFlow Quick Control");
      panel.hidden = true;

      const header = document.createElement("div");
      header.className = "tf-quick-header";
      const title = document.createElement("div");
      title.className = "tf-quick-title";
      title.textContent = "TranslateFlow";
      stateBadge = badge({ text: "就绪" });
      const close = button({ text: "×", label: "关闭 Quick Control", icon: true });
      close.addEventListener("click", () => handlers.onClose?.());
      header.append(title, stateBadge, close);

      statusNode = status({ className: "tf-quick-status" });
      setStatus(statusNode, "准备就绪", "info");
      progressNode = progress({
        value: 0,
        max: 1,
        label: "翻译进度",
        className: "tf-quick-progress"
      });
      progressNode.hidden = true;

      const actions = document.createElement("div");
      actions.className = "tf-quick-actions";
      translateButton = action("翻译 / 重翻", "tf-quick-translate", handlers.onTranslate);
      retryButton = action("重试", "tf-quick-retry", handlers.onRetry);
      cancelButton = action("取消", "tf-quick-cancel", handlers.onCancel);
      autoButton = action("开启本页自动翻译", "tf-quick-auto", handlers.onToggleAuto);
      retryButton.hidden = true;
      cancelButton.hidden = true;
      actions.append(translateButton, retryButton, cancelButton, autoButton);

      const presetField = field("翻译模式");
      presetSelect = presetField.select;
      presetSelect.classList.add("tf-quick-preset");
      presetSelect.setAttribute("aria-label", "翻译模式");
      presetSelect.addEventListener("change", () => handlers.onPresetChange?.(presetSelect.value));

      const appearanceField = field("阅读外观");
      appearanceSelect = appearanceField.select;
      appearanceSelect.classList.add("tf-quick-appearance");
      appearanceSelect.setAttribute("aria-label", "阅读外观");
      appearanceSelect.addEventListener("change", () => handlers.onAppearanceChange?.(appearanceSelect.value));

      const footer = document.createElement("div");
      footer.className = "tf-quick-footer";
      const settingsButton = action("设置", "tf-quick-settings", handlers.onSettings);
      const hideButton = action("在本站隐藏", "tf-quick-hide-site", handlers.onHideSite);
      footer.append(settingsButton, hideButton);

      panel.append(
        header,
        statusNode,
        progressNode,
        actions,
        presetField.root,
        appearanceField.root,
        footer
      );
      root.append(trigger, panel);
      getLayer("quick-control").appendChild(root);
      return api;
    }

    function destroy() {
      root?.remove();
      root = null;
      trigger = null;
      panel = null;
      stateBadge = null;
      statusNode = null;
      progressNode = null;
      translateButton = null;
      retryButton = null;
      cancelButton = null;
      autoButton = null;
      presetSelect = null;
      appearanceSelect = null;
    }

    function togglePanel() {
      ensure();
      if (panel.hidden) {
        panel.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        return true;
      }
      closePanel();
      return false;
    }

    function closePanel({ restoreFocus = true } = {}) {
      if (!panel || panel.hidden) return;
      panel.hidden = true;
      trigger?.setAttribute("aria-expanded", "false");
      if (restoreFocus) trigger?.focus();
    }

    function containsEvent(event) {
      if (!root) return false;
      return (event.composedPath?.() || []).includes(root);
    }

    function setSuppressed(value) {
      if (root) root.dataset.suppressed = value ? "true" : "false";
    }

    function isVisible() {
      return Boolean(root?.isConnected && !root.hidden && root.dataset.suppressed !== "true");
    }

    function setMessage(message, kind = "info") {
      ensure();
      setStatus(statusNode, message, kind);
    }

    function setTask(task, workingStates) {
      ensure();
      const taskState = task?.state || "idle";
      const working = workingStates.has(taskState);
      const progressText = task?.total > 0
        ? ` ${Math.min(task.done, task.total)}/${task.total}`
        : "";
      const labels = {
        queued: "准备翻译…",
        cache_lookup: `正在检查缓存…${progressText}`,
        translating: `正在调用模型翻译…${progressText}`,
        storing: `正在保存译文…${progressText}`,
        completed: `翻译完成${progressText}`,
        failed: task?.error || "翻译失败",
        cancelled: "翻译已取消"
      };

      trigger.dataset.state = working
        ? "working"
        : taskState === "failed"
          ? "failed"
          : taskState === "completed"
            ? "completed"
            : "idle";

      stateBadge.textContent = working
        ? "进行中"
        : taskState === "failed"
          ? "需处理"
          : taskState === "completed"
            ? "完成"
            : "就绪";
      stateBadge.dataset.kind = taskState === "failed"
        ? "error"
        : taskState === "completed"
          ? "success"
          : working
            ? "info"
            : "neutral";

      if (task) {
        setStatus(
          statusNode,
          labels[taskState] || "正在处理…",
          taskState === "failed" ? "error" : (taskState === "completed" ? "success" : "info")
        );
        setProgress(progressNode, task.done || 0, task.total || 1);
        progressNode.hidden = !(working || taskState === "completed");
      } else {
        setStatus(statusNode, "准备就绪", "info");
        progressNode.hidden = true;
      }

      translateButton.disabled = working;
      retryButton.hidden = taskState !== "failed";
      retryButton.disabled = working;
      cancelButton.hidden = !working;
      cancelButton.disabled = !working;
    }

    function setAuto(enabled) {
      ensure();
      autoButton.textContent = enabled ? "关闭本页自动翻译" : "开启本页自动翻译";
      autoButton.dataset.active = enabled ? "true" : "false";
    }

    function setAutoDisabled(disabled) {
      if (autoButton) autoButton.disabled = Boolean(disabled);
    }

    function setContext(context) {
      ensure();
      presetSelect.replaceChildren(
        option("inherit", "继承本站设置"),
        option("none", "无 Preset / 默认 Prompt"),
        ...(Array.isArray(context?.availablePresets) ? context.availablePresets : [])
          .map((item) => option(item.id, `${item.label} · ${item.description}`))
      );
      presetSelect.value = context?.temporaryPresetActive
        ? (context.temporaryPresetId || "none")
        : (context?.savedPresetId || "inherit");

      appearanceSelect.replaceChildren(
        option("inherit", "继承默认外观"),
        ...(Array.isArray(context?.availableAppearances) ? context.availableAppearances : [])
          .map((item) => option(item.id, `${item.label} · ${item.description}`))
      );
      appearanceSelect.value = context?.appearanceSource === "site"
        ? context.appearanceId
        : "inherit";
    }

    function setPresetDisabled(disabled) {
      if (presetSelect) presetSelect.disabled = Boolean(disabled);
    }

    function setAppearanceDisabled(disabled) {
      if (appearanceSelect) appearanceSelect.disabled = Boolean(disabled);
    }

    const api = {
      ensure,
      destroy,
      togglePanel,
      closePanel,
      containsEvent,
      setSuppressed,
      isVisible,
      setMessage,
      setTask,
      setAuto,
      setAutoDisabled,
      setContext,
      setPresetDisabled,
      setAppearanceDisabled,
      isOpen: () => Boolean(panel && !panel.hidden)
    };
    return api;
  }

  function action(text, className, handler) {
    const node = button({ text, className });
    node.addEventListener("click", () => handler?.());
    return node;
  }

  function field(labelText) {
    const root = document.createElement("div");
    root.className = "tf-quick-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    const select = document.createElement("select");
    select.className = "tf-ui-select";
    root.append(label, select);
    return { root, select };
  }

  function option(value, label) {
    const node = document.createElement("option");
    node.value = String(value);
    node.textContent = String(label);
    return node;
  }

  app.modules.quickControlView = { create };
})();
