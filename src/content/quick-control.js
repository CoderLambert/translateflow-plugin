(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.uiHost
    || !app?.modules.uiPrimitives
    || !app?.modules.tasks
    || !app?.modules.processor
    || !app?.modules.auto
    || !app?.modules.appearance
    || app.modules.quickControl
  ) return;

  const { messages, state, getSiteScope, sendRuntimeMessage } = app.modules.runtime;
  const { getLayer } = app.modules.uiHost;
  const { button, surface, status, setStatus, badge, progress, setProgress } = app.modules.uiPrimitives;
  const tasks = app.modules.tasks;
  const { processPage } = app.modules.processor;
  const { enableAutoMode, disableAutoMode } = app.modules.auto;
  const appearance = app.modules.appearance;

  const WORKING_STATES = new Set(["queued", "cache_lookup", "translating", "storing"]);
  let started = false;
  let tabVisible = false;
  let persistentVisible = false;
  let hiddenForSite = false;
  let selectionActive = false;
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
  let latestTask = null;
  let context = null;
  let unsubscribeTasks = null;

  function start() {
    if (started) return;
    started = true;

    unsubscribeTasks = tasks.subscribe(handleTaskEvent);
    latestTask = tasks.getLatestTask("page");
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    chrome.storage.onChanged.addListener(handleStorageChange);
    refreshSiteVisibility().catch(() => {});
  }

  async function showForTab() {
    tabVisible = true;
    await refreshSiteVisibility();
    if (!hiddenForSite) {
      ensureUi();
      await refreshContext().catch(() => {});
    }
  }

  function isVisible() {
    return Boolean(root?.isConnected && !root.hidden && !selectionActive);
  }

  function setSelectionActive(active) {
    selectionActive = Boolean(active);
    if (selectionActive) closePanel({ restoreFocus: false });
    if (root) root.dataset.suppressed = selectionActive ? "true" : "false";
  }

  async function refreshSiteVisibility() {
    const origin = getSiteScope(location.href);
    const stored = await chrome.storage.local.get(["quickControlSites", "quickControlHiddenSites"]);
    persistentVisible = Array.isArray(stored.quickControlSites)
      && stored.quickControlSites.includes(origin);
    hiddenForSite = Array.isArray(stored.quickControlHiddenSites)
      && stored.quickControlHiddenSites.includes(origin);
    updateVisibility();
  }

  function updateVisibility() {
    const shouldRender = (tabVisible || persistentVisible) && !hiddenForSite;
    if (!shouldRender) {
      destroyUi();
      return;
    }

    ensureUi();
    root.dataset.suppressed = selectionActive ? "true" : "false";
    renderTask(latestTask);
    renderAuto();
  }

  function ensureUi() {
    if (root?.isConnected) return;

    root = document.createElement("div");
    root.className = "tf-quick-control";
    root.setAttribute("data-tf-quick-control", "");

    trigger = button({
      text: "译",
      label: "TranslateFlow Quick Control",
      className: "tf-quick-trigger"
    });
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", togglePanel);

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
    close.addEventListener("click", () => closePanel());
    header.append(title, stateBadge, close);

    statusNode = status({ className: "tf-quick-status" });
    setStatus(statusNode, "准备就绪", "info");
    progressNode = progress({ value: 0, max: 1, label: "翻译进度", className: "tf-quick-progress" });
    progressNode.hidden = true;

    const actions = document.createElement("div");
    actions.className = "tf-quick-actions";
    translateButton = button({ text: "翻译 / 重翻", className: "tf-quick-translate" });
    retryButton = button({ text: "重试", className: "tf-quick-retry" });
    cancelButton = button({ text: "取消", className: "tf-quick-cancel" });
    autoButton = button({ text: "开启本页自动翻译", className: "tf-quick-auto" });
    translateButton.addEventListener("click", runTranslation);
    retryButton.addEventListener("click", runTranslation);
    cancelButton.addEventListener("click", cancelTranslation);
    autoButton.addEventListener("click", toggleAuto);
    retryButton.hidden = true;
    cancelButton.hidden = true;
    actions.append(translateButton, retryButton, cancelButton, autoButton);

    const presetField = document.createElement("div");
    presetField.className = "tf-quick-field";
    const presetLabel = document.createElement("label");
    presetLabel.textContent = "翻译模式";
    presetSelect = document.createElement("select");
    presetSelect.className = "tf-ui-select tf-quick-preset";
    presetSelect.setAttribute("aria-label", "翻译模式");
    presetSelect.addEventListener("change", changePreset);
    presetField.append(presetLabel, presetSelect);

    const appearanceField = document.createElement("div");
    appearanceField.className = "tf-quick-field";
    const appearanceLabel = document.createElement("label");
    appearanceLabel.textContent = "阅读外观";
    appearanceSelect = document.createElement("select");
    appearanceSelect.className = "tf-ui-select tf-quick-appearance";
    appearanceSelect.setAttribute("aria-label", "阅读外观");
    appearanceSelect.addEventListener("change", changeAppearance);
    appearanceField.append(appearanceLabel, appearanceSelect);

    const footer = document.createElement("div");
    footer.className = "tf-quick-footer";
    const settingsButton = button({ text: "设置", className: "tf-quick-settings" });
    const hideButton = button({ text: "在本站隐藏", className: "tf-quick-hide-site" });
    settingsButton.addEventListener("click", openSettings);
    hideButton.addEventListener("click", hideOnSite);
    footer.append(settingsButton, hideButton);

    panel.append(header, statusNode, progressNode, actions, presetField, appearanceField, footer);
    root.append(trigger, panel);
    getLayer("quick-control").appendChild(root);
    root.dataset.suppressed = selectionActive ? "true" : "false";
    renderTask(latestTask);
    renderAuto();
  }

  function destroyUi() {
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

  async function togglePanel() {
    if (!panel) return;
    if (panel.hidden) {
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      await refreshContext().catch((error) => {
        setStatus(statusNode, error?.message || "无法读取当前配置。", "error");
      });
    } else {
      closePanel();
    }
  }

  function closePanel({ restoreFocus = true } = {}) {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger?.focus();
  }

  function handleOutsidePointerDown(event) {
    if (!panel || panel.hidden || !root) return;
    const path = event.composedPath?.() || [];
    if (path.includes(root)) return;
    closePanel({ restoreFocus: false });
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape" || !panel || panel.hidden) return;
    event.stopPropagation();
    closePanel();
  }

  function handleTaskEvent(task) {
    if (!task || task.surface !== "page") return;
    latestTask = task;
    renderTask(task);
  }

  function renderTask(task) {
    if (!trigger || !statusNode || !stateBadge || !progressNode) return;
    const taskState = task?.state || "idle";
    const working = WORKING_STATES.has(taskState);
    const progressText = task?.total > 0 ? ` ${Math.min(task.done, task.total)}/${task.total}` : "";
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
      setStatus(statusNode, labels[taskState] || "正在处理…", taskState === "failed" ? "error" : (taskState === "completed" ? "success" : "info"));
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

  async function runTranslation() {
    if (latestTask && WORKING_STATES.has(latestTask.state)) return;
    setStatus(statusNode, "正在准备翻译…", "info");
    try {
      const result = await processPage({ cacheOnly: false, taskId: crypto.randomUUID() });
      if (!tasks.getLatestTask("page") && result?.message) {
        setStatus(statusNode, result.message, "info");
      }
      await refreshContext().catch(() => {});
    } catch (error) {
      if (!latestTask || latestTask.state !== "failed") {
        setStatus(statusNode, error?.message || String(error), "error");
      }
    }
  }

  async function cancelTranslation() {
    if (!latestTask || !WORKING_STATES.has(latestTask.state)) return;
    cancelButton.disabled = true;
    await tasks.cancelTask(latestTask.id).catch((error) => {
      setStatus(statusNode, error?.message || "取消失败。", "error");
    });
  }

  async function toggleAuto() {
    autoButton.disabled = true;
    try {
      if (state.auto) disableAutoMode({ announce: false });
      else await enableAutoMode({ announce: false });
      renderAuto();
      setStatus(statusNode, state.auto ? "本页自动翻译已开启。" : "本页自动翻译已关闭。", "info");
    } catch (error) {
      setStatus(statusNode, error?.message || "自动翻译切换失败。", "error");
    } finally {
      autoButton.disabled = false;
    }
  }

  function renderAuto() {
    if (!autoButton) return;
    autoButton.textContent = state.auto ? "关闭本页自动翻译" : "开启本页自动翻译";
    autoButton.dataset.active = state.auto ? "true" : "false";
  }

  async function refreshContext() {
    const response = await sendRuntimeMessage({
      type: messages.background.EFFECTIVE_CONTEXT,
      pageUrl: location.href
    });
    if (!response?.ok) throw new Error(response?.error || "读取当前翻译配置失败。");
    context = response.context || {};
    renderContext();
    return context;
  }

  function renderContext() {
    if (!context || !presetSelect || !appearanceSelect) return;

    const presetOptions = [
      option("inherit", "继承本站设置"),
      option("none", "无 Preset / 默认 Prompt"),
      ...(Array.isArray(context.availablePresets) ? context.availablePresets : [])
        .map((item) => option(item.id, `${item.label} · ${item.description}`))
    ];
    presetSelect.replaceChildren(...presetOptions);
    presetSelect.value = context.temporaryPresetActive
      ? (context.temporaryPresetId || "none")
      : (context.savedPresetId || "inherit");

    const appearanceOptions = [
      option("inherit", "继承默认外观"),
      ...(Array.isArray(context.availableAppearances) ? context.availableAppearances : [])
        .map((item) => option(item.id, `${item.label} · ${item.description}`))
    ];
    appearanceSelect.replaceChildren(...appearanceOptions);
    appearanceSelect.value = context.appearanceSource === "site"
      ? context.appearanceId
      : "inherit";
  }

  async function changePreset() {
    presetSelect.disabled = true;
    try {
      const response = await sendRuntimeMessage({
        type: messages.background.TEMP_PRESET_SET,
        pageUrl: location.href,
        preset: presetSelect.value
      });
      if (!response?.ok) throw new Error(response?.error || "翻译模式切换失败。");
      context = response.context || context;
      renderContext();
      setStatus(
        statusNode,
        context?.hasSitePromptOverride
          ? "本站自定义 Prompt 优先，模式已记录但当前不生效。"
          : "翻译模式已切换；点击“翻译 / 重翻”应用到页面。",
        "info"
      );
    } catch (error) {
      setStatus(statusNode, error?.message || String(error), "error");
    } finally {
      presetSelect.disabled = false;
    }
  }

  async function changeAppearance() {
    appearanceSelect.disabled = true;
    try {
      const response = await sendRuntimeMessage({
        type: messages.background.SITE_APPEARANCE_SAVE,
        pageUrl: location.href,
        appearance: appearanceSelect.value
      });
      if (!response?.ok) throw new Error(response?.error || "阅读外观切换失败。");
      context = response.context || context;
      appearance.applyContext(context || {});
      renderContext();
      setStatus(statusNode, "阅读外观已应用到本站；不会重新调用翻译模型。", "success");
    } catch (error) {
      setStatus(statusNode, error?.message || String(error), "error");
    } finally {
      appearanceSelect.disabled = false;
    }
  }

  async function openSettings() {
    const response = await sendRuntimeMessage({ type: messages.background.OPEN_OPTIONS });
    if (!response?.ok) setStatus(statusNode, response?.error || "无法打开设置。", "error");
  }

  async function hideOnSite() {
    const response = await sendRuntimeMessage({
      type: messages.background.QUICK_CONTROL_SITE_HIDE,
      origin: getSiteScope(location.href)
    });
    if (!response?.ok) {
      setStatus(statusNode, response?.error || "隐藏 Quick Control 失败。", "error");
      return;
    }
    hiddenForSite = true;
    tabVisible = false;
    persistentVisible = false;
    destroyUi();
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local") return;
    if (changes.quickControlSites || changes.quickControlHiddenSites) {
      refreshSiteVisibility().catch(() => {});
    }
    if (changes.siteProfiles || changes.appearance) {
      refreshContext().catch(() => {});
    }
    if (changes.autoSites) renderAuto();
  }

  function option(value, label) {
    const node = document.createElement("option");
    node.value = String(value);
    node.textContent = String(label);
    return node;
  }

  app.modules.quickControl = {
    start,
    showForTab,
    isVisible,
    setSelectionActive
  };
})();
