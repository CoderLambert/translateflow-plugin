(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (!app.modules.contentI18n) app.modules.contentI18n = createLegacyContentI18n();
  if (app.modules.runtime) return;

  const TRACKING_PARAMS = new Set([
    "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid",
    "igshid", "yclid", "_hsenc", "_hsmi", "vero_conv", "vero_id"
  ]);

  const constants = Object.freeze({
    TRANSLATION_CLASS: "abt-translation",
    TRANSLATED_ATTR: "data-abt-translated",
    EXTENSION_UI_ATTR: "data-tf-extension-ui",
    CANDIDATE_SELECTOR: "p, blockquote, dd, dt, figcaption, h1, h2, h3, h4, h5, h6, li",
    BATCH_MAX_CHARS: 7000,
    BATCH_MAX_ITEMS: 18,
    MIN_TEXT_LENGTH: 12,
    AUTO_DEBOUNCE_MS: 180,
    AUTO_ROOT_MARGIN: "900px 0px 1200px 0px"
  });

  const messages = Object.freeze({
    content: Object.freeze({
      TRANSLATE_PAGE: "ABT_TRANSLATE_PAGE",
      RESTORE_CACHE: "ABT_RESTORE_CACHE",
      ENABLE_AUTO: "ABT_ENABLE_AUTO",
      DISABLE_AUTO: "ABT_DISABLE_AUTO",
      CACHE_STATUS: "ABT_CACHE_STATUS",
      CLEAR_PAGE_CACHE: "ABT_CLEAR_PAGE_CACHE",
      TOGGLE_TRANSLATIONS: "ABT_TOGGLE_TRANSLATIONS",
      CLEAR_TRANSLATIONS: "ABT_CLEAR_TRANSLATIONS",
      STATUS: "ABT_STATUS",
      TASK_STATUS: "TF_TASK_STATUS",
      CANCEL_TASK: "TF_CANCEL_TASK",
      QUICK_CONTROL_SHOW: "TF_QUICK_CONTROL_SHOW",
      QUICK_CONTROL_TOGGLE: "TF_QUICK_CONTROL_TOGGLE"
    }),
    background: Object.freeze({
      TRANSLATE_BATCH: "TRANSLATE_BATCH",
      SUBTITLE_TRANSLATE_BATCH: "SUBTITLE_TRANSLATE_BATCH",
      CANCEL_TRANSLATION: "CANCEL_TRANSLATION",
      SELECTION_RESOLVE: "SELECTION_RESOLVE",
      SELECTION_EXPLAIN: "SELECTION_EXPLAIN",
      RICH_MDICT_VIEWER_LIST: "RICH_MDICT_VIEWER_LIST",
      RICH_MDICT_LOOKUP: "RICH_MDICT_LOOKUP",
      RICH_MDICT_LOOKUP_CANCEL: "RICH_MDICT_LOOKUP_CANCEL",
      RICH_MDD_RESOURCE: "RICH_MDD_RESOURCE",
      RICH_MDD_RESOURCE_READ_CANCEL: "RICH_MDD_RESOURCE_READ_CANCEL",
      RICH_MDD_RESOURCES_CHANGED: "RICH_MDD_RESOURCES_CHANGED",
      VOCABULARY_BOOK_ADD: "VOCABULARY_BOOK_ADD",
      VOCABULARY_BOOK_OPEN: "VOCABULARY_BOOK_OPEN",
      CACHE_LOOKUP: "CACHE_LOOKUP",
      CACHE_STORE: "CACHE_STORE",
      CACHE_PAGE_STATUS: "CACHE_PAGE_STATUS",
      CACHE_CLEAR_PAGE: "CACHE_CLEAR_PAGE",
      CACHE_PRUNE: "CACHE_PRUNE",
      QUICK_CONTROL_SITE_HIDE: "QUICK_CONTROL_SITE_HIDE",
      SITE_APPEARANCE_SAVE: "SITE_APPEARANCE_SAVE",
      OPEN_OPTIONS: "OPEN_OPTIONS",
      EFFECTIVE_CONTEXT: "EFFECTIVE_CONTEXT",
      TEMP_PRESET_SET: "TEMP_PRESET_SET",
      YOUTUBE_BRIDGE_INSTALL: "YOUTUBE_BRIDGE_INSTALL"
    })
  });

  const state = {
    manualRunning: false,
    auto: false,
    cacheRestore: false,
    autoDrainRunning: false,
    hidden: false,
    pending: new Set(),
    intersectionObserver: null,
    mutationObserver: null,
    autoTimer: null,
    currentPageIdentity: getPageIdentity(location.href),
    lastAutoErrorAt: 0,
    autoBackoffUntil: 0,
    lastAutoPruneAt: 0,
    startupRestorePromise: null
  };

  function cleanText(text) {
    return String(text ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeSourceText(text) {
    return cleanText(text);
  }

  function getSiteScope(rawUrl) {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.hostname}`;
  }

  function getPageIdentity(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (!/^https?:$/.test(url.protocol)) return rawUrl;
      if (!isRouteLikeHash(url.hash)) url.hash = "";
      for (const key of [...url.searchParams.keys()]) {
        const lower = key.toLowerCase();
        if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key);
      }
      url.searchParams.sort();
      return url.toString();
    } catch {
      return rawUrl;
    }
  }

  function isRouteLikeHash(hash) {
    return /^#(?:!\/|\/)/.test(hash ?? "");
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  function showToast(message, kind = "info") {
    if (app.modules.uiToast?.show) {
      app.modules.uiToast.show(message, kind);
      return;
    }

    // Compatibility fallback for the short bootstrap window before UI modules load.
    let toast = document.getElementById("abt-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "abt-toast";
      toast.setAttribute(constants.EXTENSION_UI_ATTR, "toast");
      document.documentElement.appendChild(toast);
    }
    toast.dataset.kind = kind;
    toast.textContent = message;
    toast.classList.add("abt-toast-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("abt-toast-visible"), 3200);
  }

  app.modules.runtime = {
    constants,
    messages,
    state,
    cleanText,
    normalizeSourceText,
    getSiteScope,
    getPageIdentity,
    sendRuntimeMessage,
    showToast
  };

  function createLegacyContentI18n() {
    const fallback = Object.freeze({
      "content.selection.updatedRefresh": "扩展已更新，请刷新网页后重新查询。",
      "content.selection.updatedRich": "扩展已更新，请刷新网页后查看详细词典释义。"
    });
    const snapshot = () => Object.freeze({ i18n: null, locale: "zh_CN", ready: true, error: false });
    const format = (key, args = {}) => String(fallback[key] || key).replace(/\{([a-z][a-zA-Z0-9]*)\}/g, (_match, name) => String(args[name] ?? ""));
    const bindText = (node, key, args = {}) => { if (node) node.textContent = format(key, args); return () => {}; };
    const bindAttribute = (node, attribute, key, args = {}) => { node?.setAttribute?.(attribute, format(key, args)); return () => {}; };
    return Object.freeze({
      legacyFallback: true,
      start: async () => snapshot(),
      dispose() {},
      subscribe(subscriber, { immediate = true } = {}) { if (immediate && typeof subscriber === "function") subscriber(snapshot()); return () => {}; },
      t: format,
      bindText,
      bindAttribute,
      unbind() {},
      unbindTree() {},
      get: snapshot,
      isReady: () => true
    });
  }
})();
