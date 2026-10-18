(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.contentI18n
    || !app?.modules.tasks
    || !app?.modules.dom
    || !app?.modules.batch
    || !app?.modules.processor
    || app.modules.auto
  ) return;

  const { constants, messages, state, getPageIdentity, getSiteScope, sendRuntimeMessage, showToast } = app.modules.runtime;
  const t = (key, args) => app.modules.contentI18n.t(key, args);
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
  const { processPage, processGroupBatch } = app.modules.processor;
  const { TRANSLATION_CLASS, TRANSLATED_ATTR, CANDIDATE_SELECTOR, AUTO_DEBOUNCE_MS, AUTO_ROOT_MARGIN } = constants;
  let contextInvalidated = false;

  function stopForInvalidContext(error) {
    if (error?.code !== "EXTENSION_CONTEXT_INVALIDATED" && !/extension context invalidated/iu.test(String(error?.message || error || ""))) return false;
    if (!contextInvalidated) {
      contextInvalidated = true;
      state.auto = state.cacheRestore = false;
      state.autoBackoffUntil = 0;
      stopIncrementalObservers();
      showToast(t("content.ai.extensionReloaded"), "error");
    }
    return true;
  }

  function isIncrementalActive() {
    return state.auto || state.cacheRestore;
  }

  async function maybeStartPersistentModes() {
    if (contextInvalidated) return;
    try {
      const origin = getSiteScope(location.href);
      const response = await sendRuntimeMessage({ type: messages.background.PUBLIC_SETTINGS_GET });
      const {
        cacheRestoreSites = [],
        autoSites = []
      } = response?.settings || {};

      const autoEnabled = Array.isArray(autoSites) && autoSites.includes(origin);
      const restoreEnabled = Array.isArray(cacheRestoreSites) && cacheRestoreSites.includes(origin);

      if (restoreEnabled) {
        await enableCacheRestoreMode({
          announce: false,
          initialRestore: !autoEnabled
        });
      }

      if (autoEnabled) {
        await enableAutoMode({ announce: false });
      }
    } catch (error) { stopForInvalidContext(error); }
  }

  async function maybeStartAutoMode() {
    if (contextInvalidated) return;
    try {
      const response = await sendRuntimeMessage({ type: messages.background.PUBLIC_SETTINGS_GET });
      const { autoSites = [] } = response?.settings || {};
      if (Array.isArray(autoSites) && autoSites.includes(getSiteScope(location.href))) {
        await enableAutoMode({ announce: false });
      }
    } catch (error) { stopForInvalidContext(error); }
  }

  async function enableCacheRestoreMode({ announce = false, initialRestore = true } = {}) {
    if (contextInvalidated) return;
    const wasEnabled = state.cacheRestore;
    state.cacheRestore = true;
    state.currentPageIdentity = getPageIdentity(location.href);

    if (!wasEnabled && initialRestore && !state.auto) {
      const restorePromise = processPage({
        cacheOnly: true,
        silent: true,
        startup: true
      }).catch(error => { stopForInvalidContext(error); return null; });

      state.startupRestorePromise = restorePromise;
      try {
        await restorePromise;
      } finally {
        if (state.startupRestorePromise === restorePromise) {
          state.startupRestorePromise = null;
        }
      }
    }

    if (contextInvalidated) return;
    ensureAutoObservers();
    rescanAutoPage();
    if (announce) showToast(t("content.page.cacheRestoreEnabled"), "success");
  }

  function disableCacheRestoreMode({ announce = false } = {}) {
    state.cacheRestore = false;
    if (state.auto) {
      state.pending.clear();
      rescanAutoPage();
    } else {
      stopIncrementalObservers();
    }
    if (announce) showToast(t("content.page.cacheRestoreDisabled"), "info");
  }

  async function enableAutoMode({ announce = false } = {}) {
    if (contextInvalidated || state.auto) return;
    if (state.startupRestorePromise) {
      try { await state.startupRestorePromise; } catch {}
    }

    if (contextInvalidated) return;
    state.auto = true;
    state.currentPageIdentity = getPageIdentity(location.href);
    ensureAutoObservers();
    rescanAutoPage();
    if (announce) showToast(t("content.page.autoEnabled"), "success");
  }

  function disableAutoMode({ announce = false } = {}) {
    state.auto = false;
    state.autoBackoffUntil = 0;

    if (state.cacheRestore) {
      state.pending.clear();
      rescanAutoPage();
    } else {
      stopIncrementalObservers();
    }

    if (announce) showToast(t("content.page.autoDisabled"), "info");
  }

  function stopIncrementalObservers() {
    state.pending.clear();
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
    state.intersectionObserver?.disconnect();
    state.mutationObserver?.disconnect();
    state.intersectionObserver = null;
    state.mutationObserver = null;
  }

  function ensureAutoObservers() {
    if (!isIncrementalActive()) return;

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
    if (!isIncrementalActive()) return;
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
    if (!isIncrementalActive()) return;
    ensureAutoObservers();
    for (const el of collectElements()) observeAutoCandidate(el);
  }

  function observeAutoCandidate(el) {
    if (!isIncrementalActive() || !document.contains(el) || !isCandidateElement(el)) return;
    if (el.hasAttribute(TRANSLATED_ATTR)) return;
    state.intersectionObserver?.observe(el);
  }

  function invalidateAndObserve(el) {
    removeTranslationFromElement(el);
    observeAutoCandidate(el);
  }

  function enqueueAutoElement(el) {
    if (!isIncrementalActive() || !document.contains(el) || !isCandidateElement(el)) return;
    if (el.hasAttribute(TRANSLATED_ATTR)) return;
    const text = extractSourceText(el);
    if (!shouldTranslate(text)) return;
    state.pending.add(el);
    scheduleAutoDrain();
  }

  function scheduleAutoDrain(delay = AUTO_DEBOUNCE_MS) {
    if (!isIncrementalActive()) return;
    clearTimeout(state.autoTimer);
    const backoffDelay = state.auto
      ? Math.max(0, state.autoBackoffUntil - Date.now())
      : 0;

    state.autoTimer = setTimeout(() => {
      state.autoTimer = null;
      drainAutoQueue().catch(handleAutoError);
    }, Math.max(delay, backoffDelay));
  }

  async function drainAutoQueue() {
    if (!isIncrementalActive()) return;
    if (state.manualRunning || state.autoDrainRunning) {
      scheduleAutoDrain(350);
      return;
    }

    state.autoDrainRunning = true;
    const pageUrl = location.href;
    const pageIdentity = getPageIdentity(pageUrl);

    try {
      while (isIncrementalActive() && state.pending.size) {
        if (getPageIdentity(location.href) !== pageIdentity) break;

        const elements = [...state.pending].slice(0, 72);
        for (const el of elements) state.pending.delete(el);
        const entries = buildEntries(elements);
        if (!entries.length) continue;

        const groups = groupEntriesByText(entries);
        const batches = makeBatches(groups);
        try {
          for (const batch of batches) {
            if (!isIncrementalActive() || getPageIdentity(location.href) !== pageIdentity) break;

            const allowProvider = state.auto;
            const task = allowProvider
              ? tasks.createTask({
                  surface: "auto",
                  pageUrl,
                  total: batch.reduce((sum, group) => sum + group.elements.length, 0)
                })
              : null;

            try {
              const result = await processGroupBatch(batch, {
                cacheOnly: !allowProvider,
                pageUrl,
                auto: allowProvider,
                task
              });

              if (task) {
                tasks.completeTask(task, {
                  done: task.total,
                  cacheHits: result.cacheHits,
                  apiTranslated: result.apiTranslated
                });
              }
              if (result.cacheWarning && Date.now() - state.lastAutoErrorAt > 5000) {
                // Incremental auto and cache-only restore are silent on success,
                // but must surface persistent-storage failures without spamming.
                showToast(t(allowProvider ? "content.page.cacheNotSaved" : "content.page.cacheLookupFailed"), "error");
                state.lastAutoErrorAt = Date.now();
              }
            } catch (error) {
              if (task) tasks.failTask(task, error);
              throw error;
            } finally {
              if (task) tasks.releaseTask(task);
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
      if (isIncrementalActive() && state.pending.size) scheduleAutoDrain(120);
    }
  }

  function handleAutoError(error) {
    if (stopForInvalidContext(error)) return;
    const now = Date.now();
    const message = error?.message || String(error);

    if (state.auto) {
      const code = error?.code || "";
      const longBackoff = ["CONFIG", "AUTH", "PERMISSION"].includes(code) || /API Key/i.test(message);
      state.autoBackoffUntil = now + (longBackoff ? 5 * 60 * 1000 : 15 * 1000);

      if (now - state.lastAutoErrorAt > 5000) {
        showToast(t("content.page.autoPaused", { message }), "error");
        state.lastAutoErrorAt = now;
      }
    }

    if (isIncrementalActive() && state.pending.size) scheduleAutoDrain(state.auto ? 1000 : 750);
  }

  app.modules.auto = {
    maybeStartPersistentModes,
    maybeStartAutoMode,
    enableCacheRestoreMode,
    disableCacheRestoreMode,
    enableAutoMode,
    disableAutoMode,
    rescanAutoPage,
    invalidateAndObserve,
    scheduleAutoDrain
  };
})();
