(() => {
  if (window.__AI_BILINGUAL_TRANSLATOR_LOADED__) return;
  window.__AI_BILINGUAL_TRANSLATOR_LOADED__ = true;

  const TRANSLATION_CLASS = "abt-translation";
  const TRANSLATED_ATTR = "data-abt-translated";
  const CANDIDATE_SELECTOR = "p, blockquote, dd, dt, figcaption, h1, h2, h3, h4, h5, h6, li";
  const BATCH_MAX_CHARS = 7000;
  const BATCH_MAX_ITEMS = 18;
  const MIN_TEXT_LENGTH = 12;
  const AUTO_DEBOUNCE_MS = 180;
  const AUTO_ROOT_MARGIN = "900px 0px 1200px 0px";
  const TRACKING_PARAMS = new Set([
    "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid",
    "igshid", "yclid", "_hsenc", "_hsmi", "vero_conv", "vero_id"
  ]);

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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "ABT_TRANSLATE_PAGE") {
      processPage({ cacheOnly: false })
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "ABT_RESTORE_CACHE") {
      processPage({ cacheOnly: true })
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "ABT_ENABLE_AUTO") {
      enableAutoMode({ announce: true })
        .then(() => sendResponse({ ok: true, auto: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "ABT_DISABLE_AUTO") {
      disableAutoMode({ announce: true });
      sendResponse({ ok: true, auto: false });
      return;
    }

    if (message?.type === "ABT_CACHE_STATUS") {
      sendRuntimeMessage({ type: "CACHE_PAGE_STATUS", pageUrl: location.href })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "ABT_CLEAR_PAGE_CACHE") {
      sendRuntimeMessage({ type: "CACHE_CLEAR_PAGE", pageUrl: location.href })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "ABT_TOGGLE_TRANSLATIONS") {
      state.hidden = !state.hidden;
      document.documentElement.classList.toggle("abt-hide-translations", state.hidden);
      sendResponse({ ok: true, hidden: state.hidden });
      return;
    }

    if (message?.type === "ABT_CLEAR_TRANSLATIONS") {
      clearTranslations();
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "ABT_STATUS") {
      sendResponse({
        ok: true,
        running: state.manualRunning || state.autoDrainRunning,
        hidden: state.hidden,
        auto: state.auto,
        count: document.querySelectorAll(`.${TRANSLATION_CLASS}`).length
      });
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.autoSites) {
      const enabled = Array.isArray(changes.autoSites.newValue)
        && changes.autoSites.newValue.includes(getSiteScope(location.href));
      if (enabled && !state.auto) enableAutoMode({ announce: false }).catch(() => {});
      if (!enabled && state.auto) disableAutoMode({ announce: false });
    }

    if (changes.apiKey && state.auto) {
      state.autoBackoffUntil = 0;
      if (state.pending.size) scheduleAutoDrain(120);
    }

    if (state.auto && (changes.model || changes.prompt || changes.targetLanguage)) {
      state.autoBackoffUntil = 0;
      clearTranslations();
      state.currentPageIdentity = getPageIdentity(location.href);
      rescanAutoPage();
    }
  });

  maybeStartAutoMode();

  async function maybeStartAutoMode() {
    try {
      const { autoSites = [] } = await chrome.storage.local.get(["autoSites"]);
      if (Array.isArray(autoSites) && autoSites.includes(getSiteScope(location.href))) {
        await enableAutoMode({ announce: false });
      }
    } catch {
      // Manual translation remains available even if auto-site state cannot be read.
    }
  }

  async function enableAutoMode({ announce = false } = {}) {
    if (state.auto) return;
    state.auto = true;
    state.currentPageIdentity = getPageIdentity(location.href);
    ensureAutoObservers();
    rescanAutoPage();
    if (announce) showToast("已开启此站自动增量翻译：缓存优先，缺失内容才调用 API。", "success");
  }

  function disableAutoMode({ announce = false } = {}) {
    state.auto = false;
    state.pending.clear();
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
    state.intersectionObserver?.disconnect();
    state.mutationObserver?.disconnect();
    state.intersectionObserver = null;
    state.mutationObserver = null;
    if (announce) showToast("已关闭此站自动增量翻译。", "info");
  }

  function ensureAutoObservers() {
    if (!state.intersectionObserver) {
      state.intersectionObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          state.intersectionObserver?.unobserve(entry.target);
          enqueueAutoElement(entry.target);
        }
      }, { root: null, rootMargin: AUTO_ROOT_MARGIN, threshold: 0.01 });
    }

    if (!state.mutationObserver) {
      state.mutationObserver = new MutationObserver(handleMutations);
      state.mutationObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true
      });
    }
  }

  function handleMutations(records) {
    if (!state.auto) return;
    checkPageIdentityChange();

    for (const record of records) {
      if (record.type === "characterData") {
        const parent = record.target.parentElement;
        if (!parent || parent.closest(`.${TRANSLATION_CLASS}`)) continue;
        const candidate = parent.closest(CANDIDATE_SELECTOR);
        if (candidate && isCandidateElement(candidate)) invalidateAndObserve(candidate);
        continue;
      }

      if (record.type !== "childList" || record.addedNodes.length === 0) continue;
      const sourceAdded = [...record.addedNodes].some((node) => !isTranslationNode(node));
      if (!sourceAdded) continue;

      if (record.target instanceof Element && record.target.matches(CANDIDATE_SELECTOR)) {
        if (isCandidateElement(record.target)) invalidateAndObserve(record.target);
      }

      for (const node of record.addedNodes) {
        if (isTranslationNode(node)) continue;
        scanAddedNode(node);
      }
    }
  }

  function scanAddedNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const candidate = node.parentElement?.closest(CANDIDATE_SELECTOR);
      if (candidate && isCandidateElement(candidate)) invalidateAndObserve(candidate);
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.closest(`.${TRANSLATION_CLASS}`)) return;

    if (node.matches(CANDIDATE_SELECTOR) && isCandidateElement(node)) observeAutoCandidate(node);
    for (const el of node.querySelectorAll(CANDIDATE_SELECTOR)) {
      if (isCandidateElement(el)) observeAutoCandidate(el);
    }
  }

  function checkPageIdentityChange() {
    const nextIdentity = getPageIdentity(location.href);
    if (nextIdentity === state.currentPageIdentity) return;
    state.currentPageIdentity = nextIdentity;
    state.pending.clear();
    clearTranslations();
    queueMicrotask(() => rescanAutoPage());
  }

  function rescanAutoPage() {
    if (!state.auto) return;
    ensureAutoObservers();
    for (const el of collectElements()) observeAutoCandidate(el);
  }

  function observeAutoCandidate(el) {
    if (!state.auto || !document.contains(el) || !isCandidateElement(el)) return;
    if (el.hasAttribute(TRANSLATED_ATTR)) return;
    state.intersectionObserver?.observe(el);
  }

  function invalidateAndObserve(el) {
    removeTranslationFromElement(el);
    observeAutoCandidate(el);
  }

  function enqueueAutoElement(el) {
    if (!state.auto || !document.contains(el) || !isCandidateElement(el)) return;
    if (el.hasAttribute(TRANSLATED_ATTR)) return;
    const text = extractSourceText(el);
    if (!shouldTranslate(text)) return;
    state.pending.add(el);
    scheduleAutoDrain();
  }

  function scheduleAutoDrain(delay = AUTO_DEBOUNCE_MS) {
    if (!state.auto) return;
    clearTimeout(state.autoTimer);
    const backoffDelay = Math.max(0, state.autoBackoffUntil - Date.now());
    const effectiveDelay = Math.max(delay, backoffDelay);
    state.autoTimer = setTimeout(() => {
      state.autoTimer = null;
      drainAutoQueue().catch((error) => handleAutoError(error));
    }, effectiveDelay);
  }

  async function drainAutoQueue() {
    if (!state.auto) return;
    if (state.manualRunning || state.autoDrainRunning) {
      scheduleAutoDrain(350);
      return;
    }

    state.autoDrainRunning = true;
    const pageUrl = location.href;
    const pageIdentity = getPageIdentity(pageUrl);

    try {
      while (state.auto && state.pending.size) {
        if (getPageIdentity(location.href) !== pageIdentity) break;

        const elements = [...state.pending].slice(0, 72);
        for (const el of elements) state.pending.delete(el);
        const entries = buildEntries(elements);
        if (!entries.length) continue;

        const groups = groupEntriesByText(entries);
        const batches = makeBatches(groups);
        try {
          for (const batch of batches) {
            if (!state.auto || getPageIdentity(location.href) !== pageIdentity) break;
            await processGroupBatch(batch, { cacheOnly: false, pageUrl, auto: true });
          }
        } catch (error) {
          for (const entry of entries) {
            if (document.contains(entry.el) && !entry.el.hasAttribute(TRANSLATED_ATTR)) state.pending.add(entry.el);
          }
          throw error;
        }
      }
    } finally {
      state.autoDrainRunning = false;
      if (state.auto && state.pending.size) scheduleAutoDrain(120);
    }
  }

  function handleAutoError(error) {
    const now = Date.now();
    const message = error.message || String(error);
    state.autoBackoffUntil = now + (/API Key/i.test(message) ? 5 * 60 * 1000 : 15 * 1000);
    if (now - state.lastAutoErrorAt > 5000) {
      showToast(`自动翻译暂停：${message}`, "error");
      state.lastAutoErrorAt = now;
    }
    if (state.auto && state.pending.size) scheduleAutoDrain(1000);
  }

  async function processPage({ cacheOnly }) {
    if (state.manualRunning || state.autoDrainRunning) return { message: "正在处理中…" };
    state.manualRunning = true;

    try {
      clearTranslations();
      const entries = buildEntries(collectElements());
      if (!entries.length) {
        return { message: "当前页面没有发现适合翻译的英文正文。", count: 0, cacheHits: 0, apiTranslated: 0 };
      }

      const groups = groupEntriesByText(entries);
      const batches = makeBatches(groups);
      let cacheHits = 0;
      let apiTranslated = 0;
      let missing = 0;
      const pageUrl = location.href;

      showToast(
        cacheOnly ? `正在恢复本页缓存（${entries.length} 个段落）…` : `发现 ${entries.length} 个英文段落，正在检查缓存…`,
        "info"
      );

      for (let i = 0; i < batches.length; i++) {
        if (!cacheOnly) showToast(`处理内容 ${i + 1}/${batches.length}…`, "info");
        const result = await processGroupBatch(batches[i], { cacheOnly, pageUrl, auto: false });
        cacheHits += result.cacheHits;
        apiTranslated += result.apiTranslated;
        missing += result.missing;
      }

      if (!cacheOnly && apiTranslated > 0) {
        sendRuntimeMessage({ type: "CACHE_PRUNE" }).catch(() => {});
      }

      const count = cacheHits + apiTranslated;
      if (cacheOnly) {
        const message = cacheHits
          ? `已恢复 ${cacheHits} 个缓存段落；${missing} 个段落暂无缓存。`
          : "当前网页内容没有可恢复的缓存。";
        showToast(message, cacheHits ? "success" : "info");
        return { count, cacheHits, apiTranslated: 0, missing, message };
      }

      const message = `完成：缓存命中 ${cacheHits}，API 新翻译 ${apiTranslated}${missing ? `，未返回 ${missing}` : ""}。`;
      showToast(message, "success");
      return { count, cacheHits, apiTranslated, missing, message };
    } finally {
      state.manualRunning = false;
      if (state.auto && state.pending.size) scheduleAutoDrain(120);
    }
  }

  async function processGroupBatch(groups, { cacheOnly, pageUrl, auto }) {
    const expectedPageIdentity = getPageIdentity(pageUrl);
    const pageTitle = document.title;
    const lookup = await sendRuntimeMessage({
      type: "CACHE_LOOKUP",
      pageUrl,
      segments: groups.map(({ id, text }) => ({ id, text }))
    });
    if (!lookup?.ok) throw new Error(lookup?.error || "缓存查询失败");

    const cachedMap = new Map((lookup.hits || []).map((item) => [String(item.id), item.text]));
    const uncached = [];
    let cacheHits = 0;
    let apiTranslated = 0;
    let missing = 0;

    for (const group of groups) {
      const translation = cachedMap.get(group.id);
      if (translation) {
        if (getPageIdentity(location.href) === expectedPageIdentity) {
          cacheHits += insertGroupTranslation(group, translation);
        }
      } else {
        uncached.push(group);
      }
    }

    if (cacheOnly || uncached.length === 0) {
      missing = cacheOnly ? uncached.reduce((sum, group) => sum + group.elements.length, 0) : 0;
      return { cacheHits, apiTranslated, missing };
    }

    const response = await sendRuntimeMessage({
      type: "TRANSLATE_BATCH",
      segments: uncached.map(({ id, text }) => ({ id, text }))
    });
    if (!response?.ok) throw new Error(response?.error || "翻译失败");

    const translatedMap = new Map((response.translations || []).map((item) => [String(item.id), item.text]));
    const toStore = [];
    for (const group of uncached) {
      const translation = translatedMap.get(group.id);
      if (!translation) {
        missing += group.elements.length;
        continue;
      }

      let inserted = 0;
      if (getPageIdentity(location.href) === expectedPageIdentity) {
        inserted = insertGroupTranslation(group, translation);
        apiTranslated += inserted;
      }
      toStore.push({ sourceText: group.text, translation });
    }

    if (toStore.length) {
      const stored = await sendRuntimeMessage({
        type: "CACHE_STORE",
        pageUrl,
        pageTitle,
        items: toStore
      });
      if (!stored?.ok) throw new Error(stored?.error || "缓存写入失败");
      if (auto && Date.now() - state.lastAutoPruneAt > 5 * 60 * 1000) {
        state.lastAutoPruneAt = Date.now();
        sendRuntimeMessage({ type: "CACHE_PRUNE" }).catch(() => {});
      }
    }

    return { cacheHits, apiTranslated, missing };
  }

  function insertGroupTranslation(group, translation) {
    let inserted = 0;
    for (const el of group.elements) {
      if (!document.contains(el)) continue;
      const currentText = extractSourceText(el);
      if (normalizeSourceText(currentText) !== group.normalizedText) {
        if (state.auto) invalidateAndObserve(el);
        continue;
      }
      if (insertTranslation(el, translation)) inserted += 1;
    }
    return inserted;
  }

  function buildEntries(elements) {
    const entries = [];
    let nextId = 1;
    for (const el of elements) {
      if (!document.contains(el) || el.hasAttribute(TRANSLATED_ATTR)) continue;
      const text = extractSourceText(el);
      if (!shouldTranslate(text)) continue;
      entries.push({ id: String(nextId++), el, text, normalizedText: normalizeSourceText(text) });
    }
    return entries;
  }

  function groupEntriesByText(entries) {
    const byText = new Map();
    for (const entry of entries) {
      let group = byText.get(entry.normalizedText);
      if (!group) {
        group = {
          id: String(byText.size + 1),
          text: entry.text,
          normalizedText: entry.normalizedText,
          elements: []
        };
        byText.set(entry.normalizedText, group);
      }
      group.elements.push(entry.el);
    }
    return [...byText.values()];
  }

  function collectElements() {
    const root = document.querySelector("main, [role='main']") || document.body;
    if (!root) return [];
    return Array.from(root.querySelectorAll(CANDIDATE_SELECTOR)).filter(isCandidateElement);
  }

  function isCandidateElement(el) {
    if (!(el instanceof Element) || !isVisible(el)) return false;
    if (el.matches(`.${TRANSLATION_CLASS}`) || el.closest(`.${TRANSLATION_CLASS}`)) return false;
    if (el.closest("pre, code, script, style, textarea, input, select, option, button, nav, footer, header, [contenteditable='true']")) return false;
    if (el.tagName === "LI" && el.querySelector(":scope > ul, :scope > ol, p, blockquote")) return false;
    if (el.tagName === "BLOCKQUOTE" && el.querySelector("p, li")) return false;
    if (el.children.length > 18) return false;
    return true;
  }

  function isVisible(el) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function extractSourceText(el) {
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`.${TRANSLATION_CLASS}, script, style, code, pre, textarea`)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while ((node = walker.nextNode())) parts.push(node.nodeValue || "");
    return cleanText(parts.join(" "));
  }

  function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeSourceText(text) {
    return cleanText(text);
  }

  function shouldTranslate(text) {
    if (!text || text.length < MIN_TEXT_LENGTH || text.length > 5000) return false;
    if (/^(https?:\/\/|www\.)/i.test(text)) return false;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const letters = latin + cjk;
    if (letters < 6) return false;
    return latin / letters >= 0.58;
  }

  function makeBatches(groups) {
    const batches = [];
    let current = [];
    let chars = 0;
    for (const group of groups) {
      const nextChars = chars + group.text.length;
      if (current.length && (current.length >= BATCH_MAX_ITEMS || nextChars > BATCH_MAX_CHARS)) {
        batches.push(current);
        current = [];
        chars = 0;
      }
      current.push(group);
      chars += group.text.length;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  function insertTranslation(el, translation) {
    if (!translation || el.hasAttribute(TRANSLATED_ATTR)) return false;
    const node = document.createElement("span");
    node.className = TRANSLATION_CLASS;
    node.setAttribute("aria-hidden", "false");
    node.textContent = translation;
    el.appendChild(node);
    el.setAttribute(TRANSLATED_ATTR, "1");
    return true;
  }

  function removeTranslationFromElement(el) {
    for (const child of [...el.children]) {
      if (child.classList?.contains(TRANSLATION_CLASS)) child.remove();
    }
    el.removeAttribute(TRANSLATED_ATTR);
  }

  function clearTranslations() {
    document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((node) => node.remove());
    document.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach((el) => el.removeAttribute(TRANSLATED_ATTR));
    document.documentElement.classList.remove("abt-hide-translations");
    state.hidden = false;
  }

  function isTranslationNode(node) {
    if (!(node instanceof Element)) return false;
    return node.matches(`.${TRANSLATION_CLASS}`) || Boolean(node.closest(`.${TRANSLATION_CLASS}`));
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
    return /^#(?:!\/|\/)/.test(hash || "");
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(response);
      });
    });
  }

  function showToast(message, kind = "info") {
    let toast = document.getElementById("abt-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "abt-toast";
      document.documentElement.appendChild(toast);
    }
    toast.dataset.kind = kind;
    toast.textContent = message;
    toast.classList.add("abt-toast-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("abt-toast-visible"), 3200);
  }
})();
