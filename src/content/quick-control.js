(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.contentI18n
    || !app?.modules.quickControlView
    || !app?.modules.tasks
    || !app?.modules.processor
    || !app?.modules.auto
    || !app?.modules.appearance
    || app.modules.quickControl
  ) return;

  const { messages, state, getSiteScope, sendRuntimeMessage } = app.modules.runtime;
  const i18n = app.modules.contentI18n;
  const t = (key, args) => i18n.t(key, args);
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
  let latestTask = null;
  let context = null;

  const view = app.modules.quickControlView.create({
    onToggle: togglePanel,
    onClose: () => view.closePanel(),
    onTranslate: runTranslation,
    onRetry: runTranslation,
    onCancel: cancelTranslation,
    onToggleAuto: toggleAuto,
    onPresetChange: changePreset,
    onAppearanceChange: changeAppearance,
    onSettings: openSettings,
    onHideSite: hideOnSite
  });

  function start() {
    if (started) return;
    started = true;
    tasks.subscribe(handleTaskEvent);
    latestTask = tasks.getLatestTask("page");
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    chrome.storage.onChanged.addListener(handleStorageChange);
    refreshSiteVisibility().catch(() => {});
  }

  async function showForTab() {
    await i18n.start();
    tabVisible = true;
    await refreshSiteVisibility();
    if (!hiddenForSite) {
      view.ensure();
      view.setSuppressed(selectionActive);
      view.setTask(latestTask, WORKING_STATES);
      view.setAuto(state.auto);
      await refreshContext().catch(() => {});
    }
  }

  async function toggleForTab() {
    if (view.isVisible()) {
      tabVisible = false;
      persistentVisible = false;
      view.destroy();
      return false;
    }
    await showForTab();
    return view.isVisible();
  }

  function isVisible() {
    return view.isVisible();
  }

  function setSelectionActive(active) {
    selectionActive = Boolean(active);
    if (selectionActive) view.closePanel({ restoreFocus: false });
    view.setSuppressed(selectionActive);
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

  function shouldRender() {
    return (tabVisible || persistentVisible) && !hiddenForSite;
  }

  function updateVisibility() {
    if (!shouldRender()) {
      view.destroy();
      return;
    }
    view.ensure();
    view.setSuppressed(selectionActive);
    view.setTask(latestTask, WORKING_STATES);
    view.setAuto(state.auto);
  }

  async function togglePanel() {
    const opened = view.togglePanel();
    if (!opened) return;
    await refreshContext().catch((error) => {
      view.setMessage("content.quick.readConfigError", {}, "error");
    });
  }

  function handleOutsidePointerDown(event) {
    if (!view.isOpen() || view.containsEvent(event)) return;
    view.closePanel({ restoreFocus: false });
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape" || !view.isOpen()) return;
    event.stopPropagation();
    view.closePanel();
  }

  function handleTaskEvent(task) {
    if (!task || task.surface !== "page") return;
    latestTask = task;
    if (shouldRender()) view.setTask(task, WORKING_STATES);
  }

  async function runTranslation() {
    if (latestTask && WORKING_STATES.has(latestTask.state)) return;
    view.setMessage("content.quick.preparing", {}, "info");
    try {
      const result = await processPage({ cacheOnly: false, taskId: crypto.randomUUID() });
      if (!tasks.getLatestTask("page") && result?.message) {
        if (result.messageKey) view.setMessage(result.messageKey, result.messageArgs || {}, "info");
        else view.setMessageText(result.message, "info");
      }
      await refreshContext().catch(() => {});
    } catch (error) {
      if (!latestTask || latestTask.state !== "failed") {
        view.setMessage("content.quick.taskFailed", {}, "error");
      }
    }
  }

  async function cancelTranslation() {
    if (!latestTask || !WORKING_STATES.has(latestTask.state)) return;
    await tasks.cancelTask(latestTask.id).catch(() => {
      view.setMessage("content.quick.cancelFailed", {}, "error");
    });
  }

  async function toggleAuto() {
    view.setAutoDisabled(true);
    try {
      if (state.auto) disableAutoMode({ announce: false });
      else await enableAutoMode({ announce: false });
      view.setAuto(state.auto);
      view.setMessage(state.auto ? "content.quick.autoEnabled" : "content.quick.autoDisabled", {}, "info");
    } catch {
      view.setMessage("content.quick.autoToggleFailed", {}, "error");
    } finally {
      view.setAutoDisabled(false);
    }
  }

  async function refreshContext() {
    const response = await sendRuntimeMessage({
      type: messages.background.EFFECTIVE_CONTEXT,
      pageUrl: location.href
    });
    if (!response?.ok) throw new Error(t("content.quick.contextReadFailed"));
    context = response.context || {};
    view.setContext(context);
    return context;
  }

  async function changePreset(value) {
    view.setPresetDisabled(true);
    try {
      const response = await sendRuntimeMessage({
        type: messages.background.TEMP_PRESET_SET,
        pageUrl: location.href,
        preset: value
      });
      if (!response?.ok) throw new Error(t("content.quick.presetUpdateFailed"));
      context = response.context || context;
      view.setContext(context);
      view.setMessage(
        context?.hasSitePromptOverride
          ? "content.quick.promptOverrideActive"
          : "content.quick.presetApplied",
        {},
        "info"
      );
    } catch {
      view.setMessage("content.quick.presetUpdateFailed", {}, "error");
    } finally {
      view.setPresetDisabled(false);
    }
  }

  async function changeAppearance(value) {
    view.setAppearanceDisabled(true);
    try {
      const response = await sendRuntimeMessage({
        type: messages.background.SITE_APPEARANCE_SAVE,
        pageUrl: location.href,
        appearance: value
      });
      if (!response?.ok) throw new Error(t("content.quick.appearanceUpdateFailed"));
      context = response.context || context;
      appearance.applyContext(context || {});
      view.setContext(context);
      view.setMessage("content.quick.appearanceApplied", {}, "success");
    } catch {
      view.setMessage("content.quick.appearanceUpdateFailed", {}, "error");
    } finally {
      view.setAppearanceDisabled(false);
    }
  }

  async function openSettings() {
    const response = await sendRuntimeMessage({ type: messages.background.OPEN_OPTIONS });
    if (!response?.ok) view.setMessage("content.quick.openSettingsFailed", {}, "error");
  }

  async function hideOnSite() {
    const response = await sendRuntimeMessage({
      type: messages.background.QUICK_CONTROL_SITE_HIDE,
      origin: getSiteScope(location.href)
    });
    if (!response?.ok) {
      view.setMessage("content.quick.hideFailed", {}, "error");
      return;
    }
    hiddenForSite = true;
    tabVisible = false;
    persistentVisible = false;
    view.destroy();
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local") return;
    if (changes.quickControlSites || changes.quickControlHiddenSites) {
      refreshSiteVisibility().catch(() => {});
    }
    if ((changes.siteProfiles || changes.appearance) && shouldRender()) {
      refreshContext().catch(() => {});
    }
    if (changes.autoSites && shouldRender()) view.setAuto(state.auto);
  }

  app.modules.quickControl = {
    start,
    showForTab,
    toggleForTab,
    isVisible,
    setSelectionActive
  };
})();
