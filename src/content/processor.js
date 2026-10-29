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
  const errorKeys = { MALFORMED_RESPONSE: "content.page.invalidResponse", MT_RESPONSE: "content.page.invalidResponse",
    NETWORK: "content.page.networkError", MT_NETWORK: "content.page.networkError", TIMEOUT: "content.page.timeoutError",
    RATE_LIMIT: "content.page.rateLimited", AUTH: "content.page.authError", CONFIG: "content.page.configError",
    PERMISSION: "content.page.permissionError", HOST_BUSY: "content.page.providerBusy", CONFIG_SNAPSHOT_BUSY: "content.page.providerBusy",
    CONFIG_SNAPSHOT_EXPIRED: "content.page.configExpired" };
  const responseError = (response, fallback) => {
    const key = Object.hasOwn(errorKeys, response?.errorCode) ? errorKeys[response.errorCode] : fallback;
    return Object.assign(new Error(t(key)), { code: response?.errorCode || "", i18nKey: key });
  };
  const tasks = app.modules.tasks;
  const { collectElements, extractSourceSegment, insertTranslation, clearTranslations } = app.modules.dom;
  const { buildEntries, groupEntriesByText, makeBatches } = app.modules.batch;
  const { TRANSLATED_ATTR } = constants;
  const groupKey = group => JSON.stringify([group.text, group.rich === true, group.protectedIds || []]);

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
      const completedGroups = new Map();
      const retainTranslation = (group, translation, engine, metadata, cached) =>
        completedGroups.set(groupKey(group), { group, translation, engine, metadata, cached });
      const batches = makeBatches(groups);
      let cacheHits = 0;
      let apiTranslated = 0;
      let missing = 0;
      let cacheWarning = "";
      let done = 0;
      let configSnapshotId = "";
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
          task,
          configSnapshotId,
          onTranslation: retainTranslation
        });
        configSnapshotId = result.configSnapshotId || configSnapshotId;
        cacheHits += result.cacheHits;
        apiTranslated += result.apiTranslated;
        missing += result.missing;
        if (result.cacheWarning) cacheWarning = result.cacheWarning;
        done += result.processed;
        if (task) {
          tasks.updateProgress(task, {
            done: Math.min(entries.length, done),
            cacheHits,
            apiTranslated
          });
        }
      }

      // Framework hydration can replace already-rendered paragraphs while later
      // batches are pending. Replay only this task's verified, exact-source
      // results once; no new requests, watchers, or stale-navigation writes.
      let pageChanged = false;
      if (!cacheOnly && entries.some(entry => !document.contains(entry.el))) {
        tasks.assertActive(task);
        if (getPageIdentity(location.href) !== getPageIdentity(pageUrl))
          throw Object.assign(new Error("Page changed"), { code: "CANCELLED" });
        const reconciled = reconcilePageResults(completedGroups, missing);
        ({ cacheHits, apiTranslated, missing } = reconciled);
        pageChanged = true;
      }

      if (!cacheOnly && apiTranslated > 0 && !cacheWarning) {
        sendRuntimeMessage({ type: messages.background.CACHE_PRUNE }).catch(() => {});
      }

      const count = cacheHits + apiTranslated;
      if (cacheOnly) {
        const key = cacheWarning ? "content.page.cacheLookupFailed"
          : cacheHits ? "content.page.restoreSummary" : "content.page.noCache";
        const args = cacheHits ? { hits: cacheHits, missing } : {};
        const message = t(key, args);
        if (!silent) showToast(message, cacheWarning ? "error" : cacheHits ? "success" : "info");
        return { count, cacheHits, apiTranslated: 0, missing, message, messageKey: key, messageArgs: args,
          ...(cacheWarning ? { cacheWarning } : {}) };
      }

      const key = cacheWarning ? "content.page.cacheNotSaved"
        : missing ? "content.page.completeMissing" : "content.page.complete";
      const args = cacheWarning ? {} : missing ? { hits: cacheHits, translated: apiTranslated, missing } : { hits: cacheHits, translated: apiTranslated };
      const message = t(key, args);
      tasks.completeTask(task, {
        done: entries.length,
        cacheHits,
        apiTranslated
      });
      if (missing) tasks.failTask(task, Object.assign(new Error(message), { code: pageChanged ? "PAGE_CHANGED" : "MT_RESPONSE" }));
      else app.modules.auto?.resumeAutoTranslation?.();
      // Hand the page over to restore-only healing so a later re-render cannot
      // silently drop everything we just inserted.
      if (!cacheOnly && !startup && (cacheHits + apiTranslated) > 0) app.modules.auto?.healAfterManualTranslate?.();
      if (!silent) showToast(message, cacheWarning || missing ? "error" : "success");
      return {
        count,
        cacheHits,
        apiTranslated,
        missing,
        ...(cacheWarning ? { cacheWarning } : {}),
        message,
        messageKey: key,
        messageArgs: args,
        task: tasks.getTaskStatus(task)
      };
    } catch (error) {
      if (error?.code === "ENGINE_SWITCH") {
        if (task) tasks.failTask(task, error);
        state.manualRunning = false;
        return processPage({ cacheOnly, silent });
      }
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

  async function processGroupBatch(groups, { cacheOnly, pageUrl, auto, task = null, configSnapshotId: existingSnapshotId = "", onTranslation }) {
    const expectedPageIdentity = getPageIdentity(pageUrl);
    const pageTitle = document.title;
    if (task) tasks.transition(task, "cache_lookup");

    const lookup = await sendRuntimeMessage({
      type: messages.background.CACHE_LOOKUP,
      requestId: task?.id,
      cacheOnly,
      pageUrl,
      languageSource: "page",
      configSnapshotId: existingSnapshotId,
      segments: groups.map(({ id, text, protectedIds = [], rich }) => ({ id, text, protectedIds, format: rich ? "tf-markers" : "plain" }))
    });
    if (task) tasks.assertActive(task);
    if (!lookup?.ok) throw responseError(lookup, "content.page.cacheLookupFailed");
    const configSnapshotId = String(lookup.configSnapshotId || "");
    const cacheWriteTokens = new Map((lookup.writeTokens || []).map(item => [String(item.id), item.token]));

    const cachedMap = new Map((lookup.hits || []).map((item) => [String(item.id), item.text]));
    const skippedIds = new Set(lookup.skippedIds || []);
    const uncached = [];
    let cacheHits = 0;
    let apiTranslated = 0;
    let missing = 0;
    let cacheWarning = String(lookup.cacheWarning || "");

    for (const group of groups) {
      if (skippedIds.has(group.id)) continue;
      const translation = cachedMap.get(group.id);
      if (translation) {
        if (getPageIdentity(location.href) === expectedPageIdentity) {
          const metadata = lookup.hits.find(item => String(item.id) === String(group.id));
          onTranslation?.(group, translation, lookup.engine, metadata, true);
          cacheHits += insertGroupTranslation(group, translation, lookup.engine, metadata);
        }
      } else {
        uncached.push(group);
      }
    }

    const processed = groups.reduce((sum, group) => sum + group.elements.length, 0);
    if (cacheOnly || uncached.length === 0) {
      missing = cacheOnly ? uncached.reduce((sum, group) => sum + group.elements.length, 0) : 0;
      return { cacheHits, apiTranslated, missing, processed, configSnapshotId,
        ...(cacheWarning ? { cacheWarning } : {}) };
    }

    if (task) tasks.transition(task, "translating");
    const response = await sendRuntimeMessage({
      type: messages.background.TRANSLATE_BATCH,
      requestId: task?.id || crypto.randomUUID(),
      pageUrl,
      configSnapshotId,
      segments: uncached.map(({ id, text, protectedIds = [], rich }) => ({ id, text, protectedIds, format: rich ? "tf-markers" : "plain" }))
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
        const metadata = response.translations.find(item => String(item.id) === String(group.id));
        onTranslation?.(group, translation, response.engine, metadata, false);
        apiTranslated += insertGroupTranslation(group, translation, response.engine, metadata);
      }
      toStore.push({ sourceText: group.text, translation, protectedIds: group.protectedIds || [],
        format: group.rich ? "tf-markers" : "plain", cacheToken: cacheWriteTokens.get(String(group.id)), routeRef: response.translations.find(item => String(item.id) === String(group.id))?.routeRef });
    }

    if (getPageIdentity(location.href) !== expectedPageIdentity) throw Object.assign(new Error("Page changed"), { code: "CANCELLED" });
    if (toStore.length && !cacheWarning) {
      if (task) {
        tasks.assertActive(task);
        tasks.transition(task, "storing");
      }

      const stored = await sendRuntimeMessage({
        type: messages.background.CACHE_STORE,
        pageUrl,
        pageTitle,
        configSnapshotId,
        items: toStore
      });
      if (task) tasks.assertActive(task);
      if (!stored?.ok && !app.modules.runtime.isCachePersistenceError?.(stored)) {
        throw responseError(stored, "content.page.cacheStoreFailed");
      }
      const saved = stored?.ok ? Number(stored.stored || 0) : 0;
      cacheWarning = stored?.ok
        ? (stored.cacheWarning || (saved < toStore.length ? "CACHE_NOT_SAVED" : ""))
        : stored.errorCode;

      if (auto && Date.now() - state.lastAutoPruneAt > 5 * 60 * 1000 && !cacheWarning) {
        state.lastAutoPruneAt = Date.now();
        sendRuntimeMessage({ type: messages.background.CACHE_PRUNE }).catch(() => {});
      }
    }

    return { cacheHits, apiTranslated, missing, processed, configSnapshotId,
      ...(cacheWarning ? { cacheWarning } : {}) };
  }

  function reconcilePageResults(completedGroups, missing) {
    let cacheHits = 0, apiTranslated = 0, expected = 0;
    const count = (record, size) => { if (record.cached) cacheHits += size; else apiTranslated += size; };
    for (const record of completedGroups.values()) {
      expected += record.group.elements.length;
      count(record, record.group.elements.filter(el => document.contains(el) && el.hasAttribute(TRANSLATED_ATTR)
        && extractSourceSegment(el).text === record.group.text).length);
    }
    for (const group of groupEntriesByText(buildEntries(collectElements()))) {
      const record = completedGroups.get(groupKey(group));
      if (record) count(record, insertGroupTranslation(group, record.translation, record.engine, record.metadata));
    }
    return { cacheHits, apiTranslated, missing: missing + Math.max(0, expected - cacheHits - apiTranslated) };
  }

  function insertGroupTranslation(group, translation, engine = "", metadata = {}) {
    let inserted = 0;
    for (const el of group.elements) {
      if (!document.contains(el)) continue;
      const currentText = extractSourceSegment(el).text;
      if (normalizeSourceText(currentText) !== group.normalizedText) {
        if (state.auto || state.cacheRestore) app.modules.auto?.invalidateAndObserve(el);
        continue;
      }
      if (!el.hasAttribute(TRANSLATED_ATTR) && insertTranslation(el, translation, engine)) {
        inserted += 1;
        if (engine === "machine-translation" && metadata?.providerId) {
          const node = el.querySelector(":scope > .abt-translation");
          if (!node) continue;
          node.dataset.providerId = metadata.providerId;
          node.title = metadata.providerLabel || metadata.providerId;
        }
      }
    }
    return inserted;
  }

  app.modules.processor = { processPage, processGroupBatch };
})();
