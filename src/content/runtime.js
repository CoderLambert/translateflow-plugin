(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
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
      CANCEL_TASK: "TF_CANCEL_TASK"
    }),
    background: Object.freeze({
      TRANSLATE_BATCH: "TRANSLATE_BATCH",
      CANCEL_TRANSLATION: "CANCEL_TRANSLATION",
      CACHE_LOOKUP: "CACHE_LOOKUP",
      CACHE_STORE: "CACHE_STORE",
      CACHE_PAGE_STATUS: "CACHE_PAGE_STATUS",
      CACHE_CLEAR_PAGE: "CACHE_CLEAR_PAGE",
      CACHE_PRUNE: "CACHE_PRUNE"
    })
  });

  const state = {
    manualRunning: false,
    auto: false,
    autoDrainRunning: false,
    hidden: false,
    pending: new Set(),
    intersectionObserver: null,
    mutationObserver: null,
    autoTimer: null,
    currentPageIdentity: getPageIdentity(location.href),
    lastAutoErrorAt: 0,
    autoBackoffUntil: 0,
    lastAutoPruneAt: 0
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
})();
