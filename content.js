(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime || !app?.modules.appearance || !app?.modules.tasks || !app?.modules.dom || !app?.modules.processor
    || !app?.modules.auto || !app?.modules.selectionController || !app?.modules.quickControl || !app?.modules.subtitleController
  ) throw new Error("TranslateFlow content modules were not loaded in the expected order.");
  if (app.loaded) return;
  app.loaded = true;

  const { constants, messages, state, getSiteScope, getPageIdentity, sendRuntimeMessage } = app.modules.runtime;
  const appearance = app.modules.appearance;
  const tasks = app.modules.tasks;
  const { clearTranslations } = app.modules.dom;
  const { processPage } = app.modules.processor;
  const { enableAutoMode, disableAutoMode, rescanAutoPage, maybeStartAutoMode, scheduleAutoDrain } = app.modules.auto;
  const { start: startSelectionTranslation } = app.modules.selectionController;
  const quickControl = app.modules.quickControl;
  const subtitleController = app.modules.subtitleController;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case messages.content.TRANSLATE_PAGE:
        processPage({ cacheOnly: false, taskId: message.taskId }).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message, errorCode: error?.code || "" })); return true;
      case messages.content.RESTORE_CACHE:
        processPage({ cacheOnly: true }).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message, errorCode: error?.code || "" })); return true;
      case messages.content.TASK_STATUS: sendResponse({ ok: true, task: tasks.getTaskStatus(message.taskId) }); return false;
      case messages.content.CANCEL_TASK:
        tasks.cancelTask(message.taskId).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message, errorCode: error?.code || "" })); return true;
      case messages.content.QUICK_CONTROL_SHOW:
        quickControl.showForTab().then(() => sendResponse({ ok: true, visible: quickControl.isVisible() })).catch((error) => sendResponse({ ok: false, error: error.message })); return true;
      case messages.content.ENABLE_AUTO:
        enableAutoMode({ announce: true }).then(() => sendResponse({ ok: true, auto: true })).catch((error) => sendResponse({ ok: false, error: error.message })); return true;
      case messages.content.DISABLE_AUTO: disableAutoMode({ announce: true }); sendResponse({ ok: true, auto: false }); return false;
      case messages.content.CACHE_STATUS:
        sendRuntimeMessage({ type: messages.background.CACHE_PAGE_STATUS, pageUrl: location.href }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message })); return true;
      case messages.content.CLEAR_PAGE_CACHE:
        sendRuntimeMessage({ type: messages.background.CACHE_CLEAR_PAGE, pageUrl: location.href }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message })); return true;
      case messages.content.TOGGLE_TRANSLATIONS:
        state.hidden = !state.hidden; document.documentElement.classList.toggle("abt-hide-translations", state.hidden); sendResponse({ ok: true, hidden: state.hidden }); return false;
      case messages.content.CLEAR_TRANSLATIONS: clearTranslations(); sendResponse({ ok: true }); return false;
      case messages.content.STATUS:
        sendResponse({ ok: true, running: state.manualRunning || state.autoDrainRunning, hidden: state.hidden, auto: state.auto, count: document.querySelectorAll(`.${constants.TRANSLATION_CLASS}`).length }); return false;
      default: return false;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.appearance || changes.siteProfiles) appearance.refresh().catch(() => {});
    if (changes.youtubeSubtitleMode) subtitleController.setMode(changes.youtubeSubtitleMode.newValue).catch(() => {});
    if (changes.youtubeSubtitleSize) subtitleController.setSize(changes.youtubeSubtitleSize.newValue).catch(() => {});
    if (changes.autoSites) {
      const enabled = Array.isArray(changes.autoSites.newValue) && changes.autoSites.newValue.includes(getSiteScope(location.href));
      if (enabled && !state.auto) enableAutoMode({ announce: false }).catch(() => {});
      if (!enabled && state.auto) disableAutoMode({ announce: false });
    }
    if ((changes.apiKey || changes.openAICompatible) && state.auto) { state.autoBackoffUntil = 0; if (state.pending.size) scheduleAutoDrain(120); }
    const translationProfileChanged = changes.siteProfiles ? siteProfileAffectsTranslation(changes.siteProfiles) : false;
    if (state.auto && (changes.provider || changes.model || changes.prompt || changes.targetLanguage || changes.openAICompatible || translationProfileChanged || changes.glossary || changes.siteGlossaries)) {
      state.autoBackoffUntil = 0; clearTranslations(); state.currentPageIdentity = getPageIdentity(location.href); rescanAutoPage();
    }
  });

  function siteProfileAffectsTranslation(change) {
    const origin = getSiteScope(location.href); const before = change?.oldValue?.[origin] || {}; const after = change?.newValue?.[origin] || {};
    return ["provider", "model", "prompt", "targetLanguage", "preset"].some((field) => String(before?.[field] ?? "") !== String(after?.[field] ?? ""));
  }

  appearance.start();
  quickControl.start();
  startSelectionTranslation();
  maybeStartAutoMode();
  subtitleController.start().catch(() => {});
  document.addEventListener("yt-navigate-finish", () => subtitleController.refreshRoute().catch(() => {}));
  window.addEventListener("popstate", () => subtitleController.refreshRoute().catch(() => {}));
})();
