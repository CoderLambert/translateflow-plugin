(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiHost || !app?.modules.uiPrimitives || !app?.modules.contentI18n || app.modules.quickControlView) return;

  const { getLayer } = app.modules.uiHost, locale = app.modules.contentI18n, t = (key, args) => locale.t(key, args),
    { button, surface, status, setStatus, badge, progress, setProgress } = app.modules.uiPrimitives;

  function create(handlers = {}) {
    let root, trigger, panel, stateBadge, statusNode, progressNode, translateButton;
    let retryButton, cancelButton, autoButton, autoStatus, presetSelect, appearanceSelect;
    let taskValue = null, workingStateValues = new Set(), autoValue = false, contextValue = null, messageValue = null;
    const unsubscribeLocale = locale.subscribe(refreshLocale);
    function ensure() {
      if (root?.isConnected) return api;

      root = document.createElement("div");
      root.className = "tf-quick-control";
      root.setAttribute("data-tf-quick-control", "");

      trigger = button({
        text: "",
        label: t("content.quick.aria"),
        className: "tf-quick-trigger"
      });
      trigger.setAttribute("aria-expanded", "false");
      const triggerMark = document.createElement("span");
      triggerMark.className = "tf-quick-trigger-mark";
      triggerMark.setAttribute("aria-hidden", "true");
      triggerMark.textContent = t("content.brandMark");
      trigger.appendChild(triggerMark);
      trigger.addEventListener("click", () => handlers.onToggle?.());

      panel = surface({ className: "tf-quick-panel", role: "dialog" });
      panel.setAttribute("aria-label", t("content.quick.aria"));
      panel.hidden = true;

      const header = document.createElement("div");
      header.className = "tf-quick-header";

      const brand = document.createElement("div");
      brand.className = "tf-quick-brand";
      const brandMark = document.createElement("span");
      brandMark.className = "tf-quick-brand-mark";
      brandMark.setAttribute("aria-hidden", "true");
      brandMark.textContent = t("content.brandMark");
      const brandCopy = document.createElement("div");
      brandCopy.className = "tf-quick-brand-copy";
      const title = document.createElement("strong");
      title.className = "tf-quick-title";
      title.textContent = "TranslateFlow";
      const subtitle = document.createElement("span");
      subtitle.className = "tf-quick-subtitle";
      subtitle.textContent = t("content.quick.pageTranslation");
      brandCopy.append(title, subtitle);
      brand.append(brandMark, brandCopy);

      const headerActions = document.createElement("div");
      headerActions.className = "tf-quick-header-actions";
      stateBadge = badge({ text: t("content.quick.ready"), kind: "neutral" });
      stateBadge.classList.add("tf-quick-state-badge");
      const close = button({
        text: "×",
        label: t("content.quick.close"),
        icon: true,
        className: "tf-quick-close"
      });
      close.addEventListener("click", () => handlers.onClose?.());
      headerActions.append(stateBadge, close);
      header.append(brand, headerActions);

      const stateBlock = document.createElement("div");
      stateBlock.className = "tf-quick-state-block";
      statusNode = status({ className: "tf-quick-status" });
      setStatus(statusNode, t("content.quick.readyMessage"), "info");
      progressNode = progress({
        value: 0,
        max: 1,
        label: t("content.quick.progress"),
        className: "tf-quick-progress"
      });
      progressNode.hidden = true;
      stateBlock.append(statusNode, progressNode);

      const primaryActions = document.createElement("div");
      primaryActions.className = "tf-quick-primary-actions";
      translateButton = action(t("content.quick.translate"), "tf-quick-translate", handlers.onTranslate);
      primaryActions.appendChild(translateButton);

      const inlineActions = document.createElement("div");
      inlineActions.className = "tf-quick-inline-actions";
      retryButton = action(t("content.common.retry"), "tf-quick-retry", handlers.onRetry);
      cancelButton = action(t("content.common.cancel"), "tf-quick-cancel", handlers.onCancel);
      retryButton.hidden = true;
      cancelButton.hidden = true;
      inlineActions.append(retryButton, cancelButton);

      autoButton = button({
        text: "",
        label: t("content.quick.toggleAuto"),
        className: "tf-quick-auto"
      });
      autoButton.setAttribute("aria-pressed", "false");
      const autoCopy = document.createElement("span");
      autoCopy.className = "tf-quick-auto-copy";
      const autoTitle = document.createElement("strong");
      autoTitle.textContent = t("content.quick.auto");
      autoStatus = document.createElement("span");
      autoStatus.className = "tf-quick-auto-status";
      autoStatus.textContent = t("content.quick.autoOff");
      autoCopy.append(autoTitle, autoStatus);
      const autoSwitch = document.createElement("span");
      autoSwitch.className = "tf-quick-switch-visual";
      autoSwitch.setAttribute("aria-hidden", "true");
      autoButton.append(autoCopy, autoSwitch);
      autoButton.addEventListener("click", () => handlers.onToggleAuto?.());

      const preferences = document.createElement("section");
      preferences.className = "tf-quick-preferences";
      const preferencesTitle = document.createElement("div");
      preferencesTitle.className = "tf-quick-section-title";
      preferencesTitle.textContent = t("content.quick.preferences");

      const presetField = field(t("content.quick.preset"));
      presetSelect = presetField.select;
      presetSelect.classList.add("tf-quick-preset");
      presetSelect.setAttribute("aria-label", t("content.quick.preset"));
      presetSelect.addEventListener("change", () => handlers.onPresetChange?.(presetSelect.value));

      const appearanceField = field(t("content.quick.appearance"));
      appearanceSelect = appearanceField.select;
      appearanceSelect.classList.add("tf-quick-appearance");
      appearanceSelect.setAttribute("aria-label", t("content.quick.appearance"));
      appearanceSelect.addEventListener("change", () => handlers.onAppearanceChange?.(appearanceSelect.value));
      preferences.append(preferencesTitle, presetField.root, appearanceField.root);

      const footer = document.createElement("div");
      footer.className = "tf-quick-footer";
      const settingsButton = action(t("content.common.settings"), "tf-quick-settings", handlers.onSettings);
      const hideButton = action(t("content.quick.hideSite"), "tf-quick-hide-site", handlers.onHideSite);
      footer.append(settingsButton, hideButton);

      panel.append(header, stateBlock, primaryActions, inlineActions, autoButton, preferences, footer);
      root.append(trigger, panel);
      getLayer("quick-control").appendChild(root);
      renderTask();
      renderAuto();
      renderContext();
      renderMessage();
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
      autoStatus = null;
      presetSelect = null;
      appearanceSelect = null;
    }

    function togglePanel() {
      ensure();
      if (panel.hidden) {
        panel.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        queueMicrotask(() => translateButton?.focus({ preventScroll: true }));
        return true;
      }
      closePanel();
      return false;
    }

    function closePanel({ restoreFocus = true } = {}) {
      if (!panel || panel.hidden) return;
      panel.hidden = true;
      trigger?.setAttribute("aria-expanded", "false");
      if (restoreFocus) trigger?.focus({ preventScroll: true });
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

    function setMessage(key, args = {}, kind = "info") {
      messageValue = { key, args, kind, text: null };
      ensure();
      renderMessage();
    }

    function setMessageText(message, kind = "info") {
      messageValue = { key: null, args: {}, kind, text: String(message || "") };
      ensure();
      renderMessage();
    }

    function setTask(task, workingStates) {
      taskValue = task || null;
      workingStateValues = workingStates || new Set();
      messageValue = null;
      ensure();
      renderTask();
    }

    function renderTask() {
      if (!root) return;
      const taskState = taskValue?.state || "idle";
      const working = workingStateValues.has(taskState);
      const progressText = taskValue?.total > 0
        ? ` ${Math.min(taskValue.done, taskValue.total)}/${taskValue.total}`
        : "";
      const labels = {
        queued: t("content.quick.taskQueued", { progress: progressText }),
        cache_lookup: t("content.quick.taskCacheLookup", { progress: progressText }),
        translating: t("content.quick.taskTranslating", { progress: progressText }),
        storing: t("content.quick.taskStoring", { progress: progressText }),
        completed: t("content.quick.taskCompleted", { progress: progressText }),
        failed: t("content.quick.taskFailed"),
        cancelled: t("content.quick.taskCancelled")
      };

      trigger.dataset.state = working
        ? "working"
        : taskState === "failed"
          ? "failed"
          : taskState === "completed"
            ? "completed"
            : "idle";

      trigger.setAttribute(
        "aria-label",
        working
          ? t("content.quick.ariaWorking")
          : taskState === "failed"
            ? t("content.quick.ariaNeedsAttention")
            : taskState === "completed"
              ? t("content.quick.ariaComplete")
              : t("content.quick.aria")
      );

      stateBadge.textContent = working
        ? t("content.quick.working")
        : taskState === "failed"
          ? t("content.quick.needsAttention")
          : taskState === "completed"
            ? t("content.quick.completed")
            : t("content.quick.ready");
      stateBadge.dataset.kind = taskState === "failed"
        ? "error"
        : taskState === "completed"
          ? "success"
          : working
            ? "info"
            : "neutral";

      if (taskValue) {
        setStatus(
          statusNode,
          labels[taskState] || t("content.quick.taskProcessing"),
          taskState === "failed" ? "error" : (taskState === "completed" ? "success" : "info")
        );
        setProgress(progressNode, taskValue.done || 0, taskValue.total || 1);
        progressNode.hidden = !(working || taskState === "completed");
      } else {
        setStatus(statusNode, t("content.quick.readyMessage"), "info");
        progressNode.hidden = true;
      }

      translateButton.disabled = working;
      retryButton.hidden = taskState !== "failed";
      retryButton.disabled = working;
      cancelButton.hidden = !working;
      cancelButton.disabled = !working;
    }

    function setAuto(enabled) {
      autoValue = Boolean(enabled);
      ensure();
      renderAuto();
    }

    function renderAuto() {
      if (!autoButton) return;
      const active = autoValue;
      autoButton.dataset.active = active ? "true" : "false";
      autoButton.setAttribute("aria-pressed", active ? "true" : "false");
      autoStatus.textContent = active
        ? t("content.quick.autoOn")
        : t("content.quick.autoOff");
    }

    function setAutoDisabled(disabled) {
      if (autoButton) autoButton.disabled = Boolean(disabled);
    }

    function setContext(context) {
      contextValue = context || {};
      ensure();
      renderContext();
    }

    function renderContext() {
      if (!presetSelect || !appearanceSelect) return;
      const context = contextValue || {};
      presetSelect.replaceChildren(
        option("inherit", t("content.quick.inheritSite")),
        option("none", t("content.quick.noPreset")),
        ...(Array.isArray(context?.availablePresets) ? context.availablePresets : [])
          .map((item) => option(item.id, `${item.label} · ${item.description}`))
      );
      presetSelect.value = context?.temporaryPresetActive
        ? (context.temporaryPresetId || "none")
        : (context?.savedPresetId || "inherit");

      appearanceSelect.replaceChildren(
        option("inherit", t("content.quick.inheritAppearance")),
        ...(Array.isArray(context?.availableAppearances) ? context.availableAppearances : [])
          .map((item) => option(item.id, `${item.label} · ${item.description}`))
      );
      appearanceSelect.value = context?.appearanceSource === "site"
        ? context.appearanceId
        : "inherit";
    }

    function setPresetDisabled(disabled) { if (presetSelect) presetSelect.disabled = Boolean(disabled); }
    function setAppearanceDisabled(disabled) { if (appearanceSelect) appearanceSelect.disabled = Boolean(disabled); }

    function renderMessage() {
      if (!statusNode || !messageValue) return;
      const text = messageValue.key
        ? t(messageValue.key, messageValue.args)
        : messageValue.text;
      setStatus(statusNode, text, messageValue.kind);
    }

    function refreshLocale() {
      if (!root?.isConnected) return;
      const open = Boolean(panel && !panel.hidden);
      const suppressed = root.dataset.suppressed === "true";
      const active = root.getRootNode()?.activeElement;
      const focusClass = root.contains(active) ? [...(active.classList || [])].find((name) => name.startsWith("tf-quick-")) : "";
      root.remove();
      root = null;
      ensure();
      setSuppressed(suppressed);
      if (open) {
        panel.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
      }
      if (focusClass) root.querySelector(`.${focusClass}`)?.focus({ preventScroll: true });
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
      setMessageText,
      setTask,
      setAuto,
      setAutoDisabled,
      setContext,
      setPresetDisabled,
      setAppearanceDisabled,
      isOpen: () => Boolean(panel && !panel.hidden),
      dispose: () => { unsubscribeLocale(); destroy(); }
    };
    return api;
  }

  function action(text, className, handler) {
    const node = button({ text, className });
    node.addEventListener("click", () => handler?.());
    return node;
  }

  function field(labelText) {
    const root = document.createElement("label");
    root.className = "tf-quick-field";
    const label = document.createElement("span");
    label.className = "tf-quick-field-label";
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
