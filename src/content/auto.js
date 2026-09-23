(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.tasks
    || !app?.modules.dom
    || !app?.modules.batch
    || !app?.modules.processor
    || app.modules.auto
  ) return;

  const { constants, state, getPageIdentity, showToast } = app.modules.runtime;
  const tasks = app.modules.tasks;
  const {
    collectElements,
    isCandidateElement,
    extractSourceText,
    shouldTranslate,
    isTranslationNode,
    removeTranslationFromElement,
    clearTranslations
  } = app.modules.dom;
  const { buildEntries, groupEntriesByText, makeBatches } = app.modules.batch;
  const { processGroupBatch } = app.modules.processor;
  const { TRANSLATION_CLASS, TRANSLATED_ATTR, CANDIDATE_SELECTOR, AUTO_DEBOUNCE_MS, AUTO_ROOT_MARGIN } = constants;

  async function maybeStartAutoMode() {
    try {
      const { autoSites = [] } = await chrome.storage.local.get(["autoSites"]);
      if (Array.isArray(autoSites) && autoSites.includes(app.modules.runtime.getSiteScope(location.href))) {
        await enableAutoMode({ announce: false });
      }
    } catch {}
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
    if (isTranslationNode(node)) return;

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
    state.autoTimer = setTimeout(() => {
      state.autoTimer = null;
      drainAutoQueue().catch(handleAutoError);
    }, Math.max(delay, backoffDelay));
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

            const task = tasks.createTask({
              surface: "auto",
              pageUrl,
              total: batch.reduce((sum, group) => sum + group.elements.length, 0)
            });
            try {
              const result = await processGroupBatch(batch, {
                cacheOnly: false,
                pageUrl,
                auto: true,
                task
              });
              tasks.completeTask(task, {
                done: task.total,
                cacheHits: result.cacheHits,
                apiTranslated: result.apiTranslated
              });
            } catch (error) {
              tasks.failTask(task, error);
              throw error;
            } finally {
              tasks.releaseTask(task);
            }
          }
        } catch (error) {
          for (const entry of entries) {
            if (document.contains(entry.el) && !entry.el.hasAttribute(TRANSLATED_ATTR)) {
              state.pending.add(entry.el);
            }
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
    const message = error?.message || String(error);
    const code = error?.code || "";
    const longBackoff = ["CONFIG", "AUTH", "PERMISSION"].includes(code) || /API Key/i.test(message);
    state.autoBackoffUntil = now + (longBackoff ? 5 * 60 * 1000 : 15 * 1000);

    if (now - state.lastAutoErrorAt > 5000) {
      showToast(`自动翻译暂停：${message}`, "error");
      state.lastAutoErrorAt = now;
    }
    if (state.auto && state.pending.size) scheduleAutoDrain(1000);
  }

  app.modules.auto = {
    maybeStartAutoMode,
    enableAutoMode,
    disableAutoMode,
    rescanAutoPage,
    invalidateAndObserve,
    scheduleAutoDrain
  };
})();
