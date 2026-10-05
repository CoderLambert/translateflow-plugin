(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.contentI18n
    || !app?.modules.tasks
    || !app?.modules.dom
    || !app?.modules.batch
    || app.modules.processor
  ) return;

  const { constants, messages, state, getPageIdentity, normalizeSourceText, sendRuntimeMessage, showToast } = app.modules.runtime;
  const t = (key, args) => app.modules.contentI18n.t(key, args);
  const resultMessage = (key, args = {}) => ({ message: t(key, args), messageKey: key, messageArgs: args });
  const responseError = (response, key) => Object.assign(new Error(t(key)), { code: response?.errorCode || "", i18nKey: key });
  const tasks = app.modules.tasks;
  const { collectElements, extractSourceSegment, insertTranslation, clearTranslations } = app.modules.dom;
  const { buildEntries, groupEntriesByText, makeBatches } = app.modules.batch;
  const { TRANSLATED_ATTR } = constants;

  async function processPage({ cacheOnly, taskId = "", silent = false, startup = false }) {
    if (!startup && state.startupRestorePromise) {
      try { await state.startupRestorePromise; } catch {}
    }
    if (state.manualRunning || state.autoDrainRunning) return resultMessage("content.page.processing");
    state.manualRunning = true;
    let task = null;

    try {
      clearTranslations();
      const entries = buildEntries(collectElements());
      if (!entries.length) {
        return { ...resultMessage("content.page.noEnglish"), count: 0, cacheHits: 0, apiTranslated: 0 };
      }

      if (!cacheOnly) {
        task = tasks.createTask({
          id: taskId,
          surface: "page",
          pageUrl: location.href,
          total: entries.length
        });
      }

      const groups = groupEntriesByText(entries);
      const batches = makeBatches(groups);
      let cacheHits = 0;
      let apiTranslated = 0;
      let missing = 0;
      let done = 0;
      const pageUrl = location.href;

      if (!silent) {
        showToast(t(cacheOnly ? "content.page.restoreChecking" : "content.page.cacheChecking", { count: entries.length }), "info");
      }

      for (let i = 0; i < batches.length; i += 1) {
        tasks.assertActive(task || { state: "queued" });
        const result = await processGroupBatch(batches[i], {
          cacheOnly,
          pageUrl,
          auto: false,
          task
        });
        cacheHits += result.cacheHits;
        apiTranslated += result.apiTranslated;
        missing += result.missing;
        done += result.processed;
        if (task) {
          tasks.updateProgress(task, {
            done: Math.min(entries.length, done),
            cacheHits,
            apiTranslated
          });
        }
      }

      if (!cacheOnly && apiTranslated > 0) {
        sendRuntimeMessage({ type: messages.background.CACHE_PRUNE }).catch(() => {});
      }

      const count = cacheHits + apiTranslated;
      if (cacheOnly) {
        const key = cacheHits ? "content.page.restoreSummary" : "content.page.noCache";
        const args = cacheHits ? { hits: cacheHits, missing } : {};
        const message = t(key, args);
        if (!silent) showToast(message, cacheHits ? "success" : "info");
        return { count, cacheHits, apiTranslated: 0, missing, message, messageKey: key, messageArgs: args };
      }

      const key = missing ? "content.page.completeMissing" : "content.page.complete";
      const args = missing ? { hits: cacheHits, translated: apiTranslated, missing } : { hits: cacheHits, translated: apiTranslated };
      const message = t(key, args);
      tasks.completeTask(task, {
        done: entries.length,
        cacheHits,
        apiTranslated
      });
      if (!silent) showToast(message, "success");
      return {
        count,
        cacheHits,
        apiTranslated,
        missing,
        message,
        messageKey: key,
        messageArgs: args,
        task: tasks.getTaskStatus(task)
      };
    } catch (error) {
      if (task) tasks.failTask(task, error);
      if (tasks.isCancelledError(error)) {
        if (!silent) showToast(t("content.page.cancelled"), "info");
        return {
          cancelled: true,
          ...resultMessage("content.page.cancelledShort"),
          task: tasks.getTaskStatus(task)
        };
      }
      throw error;
    } finally {
      state.manualRunning = false;
      if ((state.auto || state.cacheRestore) && state.pending.size) app.modules.auto?.scheduleAutoDrain(120);
    }
  }

  async function processGroupBatch(groups, { cacheOnly, pageUrl, auto, task = null }) {
    const expectedPageIdentity = getPageIdentity(pageUrl);
    const pageTitle = document.title;
    if (task) tasks.transition(task, "cache_lookup");

    const lookup = await sendRuntimeMessage({
      type: messages.background.CACHE_LOOKUP,
      pageUrl,
      segments: groups.map(({ id, text }) => ({ id, text }))
    });
    if (task) tasks.assertActive(task);
    if (!lookup?.ok) throw responseError(lookup, "content.page.cacheLookupFailed");

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

    const processed = groups.reduce((sum, group) => sum + group.elements.length, 0);
    if (cacheOnly || uncached.length === 0) {
      missing = cacheOnly ? uncached.reduce((sum, group) => sum + group.elements.length, 0) : 0;
      return { cacheHits, apiTranslated, missing, processed };
    }

    if (task) tasks.transition(task, "translating");
    const response = await sendRuntimeMessage({
      type: messages.background.TRANSLATE_BATCH,
      requestId: task?.id || crypto.randomUUID(),
      pageUrl,
      segments: uncached.map(({ id, text }) => ({ id, text }))
    });
    if (task) tasks.assertActive(task);
    if (!response?.ok) throw responseError(response, "content.page.translationFailed");

    const translatedMap = new Map((response.translations || []).map((item) => [String(item.id), item.text]));
    const toStore = [];
    for (const group of uncached) {
      const translation = translatedMap.get(group.id);
      if (!translation) {
        missing += group.elements.length;
        continue;
      }

      if (getPageIdentity(location.href) === expectedPageIdentity) {
        apiTranslated += insertGroupTranslation(group, translation);
      }
      toStore.push({ sourceText: group.text, translation });
    }

    if (toStore.length) {
      if (task) {
        tasks.assertActive(task);
        tasks.transition(task, "storing");
      }

      const stored = await sendRuntimeMessage({
        type: messages.background.CACHE_STORE,
        pageUrl,
        pageTitle,
        items: toStore
      });
      if (task) tasks.assertActive(task);
      if (!stored?.ok) throw responseError(stored, "content.page.cacheStoreFailed");

      if (auto && Date.now() - state.lastAutoPruneAt > 5 * 60 * 1000) {
        state.lastAutoPruneAt = Date.now();
        sendRuntimeMessage({ type: messages.background.CACHE_PRUNE }).catch(() => {});
      }
    }

    return { cacheHits, apiTranslated, missing, processed };
  }

  function insertGroupTranslation(group, translation) {
    let inserted = 0;
    for (const el of group.elements) {
      if (!document.contains(el)) continue;
      const currentText = extractSourceSegment(el).text;
      if (normalizeSourceText(currentText) !== group.normalizedText) {
        if (state.auto || state.cacheRestore) app.modules.auto?.invalidateAndObserve(el);
        continue;
      }
      if (!el.hasAttribute(TRANSLATED_ATTR) && insertTranslation(el, translation)) inserted += 1;
    }
    return inserted;
  }

  app.modules.processor = { processPage, processGroupBatch };
})();
