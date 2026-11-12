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
    OUTPUT_LIMIT: "content.page.outputLimit", MODEL_REFUSAL: "content.page.modelRefusal", INCOMPLETE_RESPONSE: "content.page.incompleteResponse",
    NETWORK: "content.page.networkError", MT_NETWORK: "content.page.networkError", TIMEOUT: "content.page.timeoutError",
    RATE_LIMIT: "content.page.rateLimited", AUTH: "content.page.authError", CONFIG: "content.page.configError",
    PERMISSION: "content.page.permissionError", HOST_BUSY: "content.page.providerBusy", CONFIG_SNAPSHOT_BUSY: "content.page.providerBusy",
    CONFIG_SNAPSHOT_EXPIRED: "content.page.configExpired" };
  const responseError = (response, fallback) => {
    const key = Object.hasOwn(errorKeys, response?.errorCode) ? errorKeys[response.errorCode] : fallback;
    return Object.assign(new Error(t(key)), { code: response?.errorCode || "", i18nKey: key });
  };
  const tasks = app.modules.tasks;
  const { collectUnitsAsync, isUnitCurrent, hasTranslation, getTranslationNode, extractSourceSegment, insertTranslation, clearTranslations } = app.modules.dom;
  const { buildEntries, groupEntriesByText, makeBatches, makeBatchesHeadFirst, prioritizeVisibleGroups } = app.modules.batch;
  // One provider round trip per batch, run three at a time: a long page stops
  // paying its wall time once per batch while staying under typical rate limits.
  const BATCH_CONCURRENCY = 6;
  const HEAD_BATCH_ITEMS = 4;
  const groupKey = group => JSON.stringify([group.text, group.rich === true, group.protectedIds || []]);

  async function processPage({ cacheOnly, taskId = "", silent = false, startup = false }) {
    let progressTimer = null;
    const stopProgressTicker = () => { if (progressTimer) { clearInterval(progressTimer); progressTimer = null; } };
    if (!startup && state.startupRestorePromise) {
      try { await state.startupRestorePromise; } catch {}
    }
    if (state.manualRunning || state.autoDrainRunning) return resultMessage("content.page.processing");
    state.manualRunning = true;
    let task = null, monitor = null;

    try {
      await app.modules.pageScope?.load();
      clearTranslations();
      if (!cacheOnly) task = tasks.createTask({ id: taskId, surface: "page", pageUrl: location.href, total: 0 });
      const scanIdentity = getPageIdentity(location.href), scanScope = state.pageScope;
      const assertScanActive = () => {
        if (task) tasks.assertActive(task);
        if (getPageIdentity(location.href) !== scanIdentity || state.pageScope !== scanScope) throw Object.assign(new Error("Page changed"), { code: "CANCELLED" });
      };
      monitor = app.modules.pageObserver?.track?.();
      const scan = async () => {
        const found = await collectUnitsAsync({assertActive:assertScanActive,onRoot:monitor?.observeRoot});
        const report = found.coverage;
        if (report && (!report.scanComplete || report.unaccountedCharacters || report.duplicateCharacters || report.unexpectedCharacters))
          throw Object.assign(new Error(t('content.page.coverageIncomplete')),{code:'PAGE_COVERAGE'});
        return found;
      };
      let currentUnits = await scan(), coverage = currentUnits.coverage;
      let entries = buildEntries(currentUnits), total = entries.length;
      if (task) task.total = entries.length;
      if (!entries.length) {
        if (task) tasks.completeTask(task, { done: 0 });
        return { ...resultMessage("content.page.noEnglish"), count: 0, cacheHits: 0, apiTranslated: 0, coverage };
      }


      const groups = prioritizeVisibleGroups(groupEntriesByText(entries), {
        viewportHeight: globalThis.visualViewport?.height || globalThis.innerHeight || 0
      });
      const completedGroups = new Map();
      const attempted = new Set(), skipped = new Set();
      const retainTranslation = (group, translation, engine, metadata, cached) =>
        completedGroups.set(groupKey(group), { group, translation, engine, metadata, cached });
      let batches = makeBatchesHeadFirst(groups, HEAD_BATCH_ITEMS);
      let cacheHits = 0;
      let apiTranslated = 0;
      let missing = 0;
      let cacheWarning = "";
      let done = 0;
      let configSnapshotId = "";
      const pageUrl = location.href;

      if (!silent && cacheOnly) {
        showToast(t("content.page.restoreChecking", { count: entries.length }), "info");
      }

      const startedAt = Date.now();
      let batchIndex = 0;
      let batchesDone = 0;
      const showProgress = () => {
        if (silent || cacheOnly) return;
        const shown = Math.min(total, done);
        const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
        const message = batches.length > 1
          ? t("content.page.translatingProgressDetail", {
              done: shown, total,
              batch: Math.max(1, batchIndex), batches: batches.length, elapsed
            })
          : cacheHits
            ? t("content.page.translatingProgressHits", { done: shown, total, hits: cacheHits })
            : t("content.page.translatingProgress", { done: shown, total });
        showToast(message, "info", { persistent: true, taskId: task?.id });
      };
      if (!silent && !cacheOnly) {
        showProgress();
        progressTimer = setInterval(showProgress, 1000);
      }

      const runBatch = async batch => {
        tasks.assertActive(task || { state: "queued" });
        for (const group of batch) attempted.add(groupKey(group));
        const result = await processGroupBatch(batch, {
          cacheOnly,
          pageUrl,
          auto: false,
          task,
          configSnapshotId,
          onTranslation: retainTranslation,
          onSkip: group => skipped.add(groupKey(group))
        });
        configSnapshotId = result.configSnapshotId || configSnapshotId;
        cacheHits += result.cacheHits;
        apiTranslated += result.apiTranslated;
        missing += result.missing;
        if (result.cacheWarning) cacheWarning = result.cacheWarning;
        done += result.processed;
        batchesDone += 1;
        batchIndex = Math.min(batches.length, batchesDone + 1);
        if (task) {
          tasks.updateProgress(task, {
            done: Math.min(total, done),total,
            cacheHits,
            apiTranslated
          });
        }
        showProgress();
      };

      for (let round = 0; round < 12; round++) {
        if (batches.length) {
          await runBatch(batches[0]);
          let failure = null, cursor = 1;
          const worker = async () => {
            while (!failure && cursor < batches.length) {
              const batch = batches[cursor++];
              try { await runBatch(batch); } catch(error) { failure ||= error; }
            }
          };
          await Promise.all(Array.from({length:Math.min(BATCH_CONCURRENCY,batches.length-1)},worker));
          if(failure)throw failure;
        }
        if(cacheOnly)break;
        const revision = monitor?.revision();
        currentUnits = await scan();coverage = currentUnits.coverage;
        for(const group of groupEntriesByText(buildEntries(currentUnits))) {
          const record=completedGroups.get(groupKey(group));
          if(record) {insertGroupTranslation(group,record.translation,record.engine,record.metadata);record.group.elements.push(...group.elements);}
        }
        ({cacheHits,apiTranslated}=countCurrentResults(completedGroups));
        const remaining=groupEntriesByText(buildEntries(currentUnits));
        const omitted=remaining.filter(group=>skipped.has(groupKey(group))).reduce((sum,group)=>sum+group.elements.length,0);
        const pending=remaining.filter(group=>!attempted.has(groupKey(group)));
        missing=remaining.reduce((sum,group)=>sum+group.elements.length,0)-omitted;
        total=cacheHits+apiTranslated+missing+omitted;
        coverage={...coverage,rendered:cacheHits+apiTranslated,missing,providerSkipped:omitted};
        tasks.updateProgress(task,{total,done:cacheHits+apiTranslated+omitted,cacheHits,apiTranslated,coverage});
        // Let queued framework reactions run, then drain observations. This is a
        // checkpoint, not a timing guess that the page has permanently settled.
        await new Promise(resolve=>setTimeout(resolve,0));assertScanActive();
        if(!pending.length && revision===monitor?.revision() && currentUnits.every(isUnitCurrent))break;
        if(round===11)throw Object.assign(new Error(t('content.page.changing')),{code:'PAGE_CHANGED'});
        batches=makeBatchesHeadFirst(pending,HEAD_BATCH_ITEMS);batchesDone=0;done=cacheHits+apiTranslated;
      }

      if (!cacheOnly && apiTranslated > 0 && !cacheWarning) {
        sendRuntimeMessage({ type: messages.background.CACHE_PRUNE }).catch(() => {});
      }

      stopProgressTicker();
      const count = cacheHits + apiTranslated;
      if (cacheOnly) {
        const key = cacheWarning ? "content.page.cacheLookupFailed"
          : cacheHits ? "content.page.restoreSummary" : "content.page.noCache";
        const args = cacheHits ? { hits: cacheHits, missing } : {};
        const message = t(key, args);
        if (!silent) showToast(message, cacheWarning ? "error" : cacheHits ? "success" : "info");
        return { count, cacheHits, apiTranslated: 0, missing, coverage, message, messageKey: key, messageArgs: args,
          ...(cacheWarning ? { cacheWarning } : {}) };
      }

      const key = cacheWarning ? "content.page.cacheNotSaved"
        : missing ? "content.page.completeMissing" : "content.page.complete";
      const args = cacheWarning ? {} : missing ? { hits: cacheHits, translated: apiTranslated, missing } : { hits: cacheHits, translated: apiTranslated };
      const message = t(key, args) + ' ' + t('content.page.scopeSummary',{scope:t(scanScope==='all'?'options.pageScope.all':'options.pageScope.content')});
      const finalProgress = {done:total-missing,total,coverage,cacheHits,apiTranslated};
      if (missing) {
        tasks.updateProgress(task,finalProgress);
        tasks.failTask(task, Object.assign(new Error(message), { code: "MT_RESPONSE" }));
      } else {tasks.completeTask(task,finalProgress);app.modules.auto?.resumeAutoTranslation?.();}
      // Hand the page over to restore-only healing so a later re-render cannot
      // silently drop everything we just inserted.
      if (!cacheOnly && !startup && (cacheHits + apiTranslated) > 0) app.modules.auto?.healAfterManualTranslate?.();
      if (!silent) showToast(message, cacheWarning || missing ? "error" : "success", { taskId: task?.id });
      return {
        count,
        cacheHits,
        apiTranslated,
        missing,
        coverage,
        ...(cacheWarning ? { cacheWarning } : {}),
        message,
        messageKey: key,
        messageArgs: args,
        task: tasks.getTaskStatus(task)
      };
    } catch (error) {
      if (error?.code === "PAGE_SCAN_LIMIT") error.message = t("content.page.scanLimit");
      stopProgressTicker();
      if (error?.code === "ENGINE_SWITCH") {
        if (task) tasks.failTask(task, error);
        state.manualRunning = false;
        return processPage({ cacheOnly, silent });
      }
      if (task) tasks.failTask(task, error);
      if (tasks.isCancelledError(error)) {
        if (!silent) showToast(t("content.page.cancelled"), "info", { taskId: task?.id });
        return {
          cancelled: true,
          ...resultMessage("content.page.cancelledShort"),
          task: tasks.getTaskStatus(task)
        };
      }
      throw error;
    } finally {
      stopProgressTicker();
      monitor?.stop();
      state.manualRunning = false;
      if ((state.auto || state.cacheRestore) && state.pending.size) app.modules.auto?.scheduleAutoDrain(120);
    }
  }

  async function processGroupBatch(groups, { cacheOnly, pageUrl, auto, task = null, configSnapshotId: existingSnapshotId = "", onTranslation, onSkip }) {
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
      if (skippedIds.has(group.id)) { onSkip?.(group); continue; }
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

  function countCurrentResults(completedGroups) {
    let cacheHits = 0, apiTranslated = 0;
    for (const record of completedGroups.values()) {
      record.group.elements=[...new Set(record.group.elements)].filter(el=>isUnitCurrent(el)&&hasTranslation(el));
      if(record.cached)cacheHits+=record.group.elements.length;else apiTranslated+=record.group.elements.length;
    }
    return {cacheHits,apiTranslated};
  }

  function insertGroupTranslation(group, translation, engine = "", metadata = {}) {
    let inserted = 0;
    for (const el of group.elements) {
      if (!isUnitCurrent(el)) continue;
      const currentText = extractSourceSegment(el).text;
      if (normalizeSourceText(currentText) !== group.normalizedText) {
        if (state.auto || state.cacheRestore) app.modules.auto?.invalidateAndObserve(el);
        continue;
      }
      if (!hasTranslation(el) && insertTranslation(el, translation, engine)) {
        inserted += 1;
        if (engine === "machine-translation" && metadata?.providerId) {
          const node = getTranslationNode(el);
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
