(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.browserTranslation || app.modules.translationClient) return;
  const { BROWSER_ENGINE, browserLanguage, buildSubtitleCacheSource, explicitSource, detectionSample } = app.modules.browserTranslationContract;
  const engine = app.modules.browserTranslation, view = app.modules.browserTranslationView;
  const messages = app.modules.runtime.messages.background;
  const plans = new Map(), requests = new Map(), corrections = new Map(), browserFallbacks = new Map(), cancelled = new Set();
  const PREFIX = "browser-plan:";
  let route = location.href;
  const surfaceFor = payload => payload.languageSource === "selection" ? ((payload.selectionKind === "word" || !payload.selectionKind && payload.browserTranslationAllowed === true) ? "selection-word" : "selection-text") : payload.languageSource || "page";
  const nativeFor = payload => surfaceFor(payload) === "selection-word" || surfaceFor(payload) === "subtitle" ? engine : engine.local || engine;
  const t = (key, args) => app.modules.contentI18n.t(`content.basic.${key}`, args);
  const isNativeId = id => typeof id === "string" && id.startsWith(PREFIX);
  function boundedSet(map, key, value) { map.set(key, value); if (map.size > 256) map.delete(map.keys().next().value); }
  function assertCurrent(controller, pageUrl, requestId) {
    if (!controller || controller.signal.aborted || location.href !== pageUrl || cancelled.has(requestId)) throw engine.error("CANCELLED");
  }
  function responseError(response) { return engine.error(response?.errorCode || "BROWSER_UNAVAILABLE"); }
  // The surrounding sentence is local language evidence, never an AI Provider input.
  function withoutNativeDetection(payload) { const { detectionText: _sample, ...request } = payload; return { ...request, browserTranslation: { surface: surfaceFor(payload), temporaryMethod: payload.temporaryMethod } }; }
  function browserEligible(payload) {
    if (["page", "subtitle"].includes(payload?.languageSource)) return true;
    return payload?.languageSource === "selection" && payload?.browserTranslationAllowed === true;
  }
  function correctionKey(payload, segment) {
    return payload.languageSource === "subtitle" ? `track:${payload.trackKey || ""}` : `${payload.languageSource || "page"}:${segment.contentText ?? segment.text}:${segment.detectionText ?? payload.detectionText ?? ""}`;
  }
  async function checkedSettings(payload, raw, controller) {
    const eligible = browserEligible(payload) || controller.browserAllowed === true;
    const surface = surfaceFor(payload);
    const result = await raw({ type: messages.TRANSLATION_ENGINE_SETTINGS, pageUrl: payload.pageUrl,
      temporaryMethod: payload.temporaryMethod, surface });
    assertCurrent(controller, payload.pageUrl, payload.requestId);
    if (!result?.ok) throw Object.assign(engine.error("AI_CONFIG"), { code: result?.errorCode || "CONFIG" });
    if (result.engine === BROWSER_ENGINE && !result.enabled && !payload.cacheOnly) {
      await view.prompt({ signal: controller.signal, title: "disabled", message: t("disabledHelp"), action: { label: "enable" } });
      assertCurrent(controller, payload.pageUrl, payload.requestId);
      await raw({ type: messages.OPEN_OPTIONS, hash: "#general" }); throw engine.error("BROWSER_DISABLED");
    }
    return result;
  }
  async function sourceFor(payload, segment, settings, controller) {
    const sample = segment.detectionText ?? payload.detectionText ?? detectionSample(segment.contentText ?? segment.text, segment.protectedIds);
    const explicit = explicitSource({ corrected: corrections.get(correctionKey(payload, segment)), configured: settings.sourceLanguage,
      trackLanguage: segment.sourceLanguageHint || payload.sourceLanguageHint, surface: payload.languageSource });
    if (explicit) return explicit;
    const sourceText = segment.contentText ?? segment.text;
    const detector = nativeFor(payload);
    let decision = await (detector.detectSelection ? detector.detectSelection(sourceText, sample, { signal: controller.signal, cacheOnly: payload.cacheOnly }) : detector.detectDecision(sample, { signal: controller.signal, cacheOnly: payload.cacheOnly }));
    assertCurrent(controller, payload.pageUrl, payload.requestId);
    if (decision.source === "empty") return decision;
    const uncertainChinese = decision.language === "zh" && !decision.scriptKnown && browserLanguage(settings.targetLanguage) === "zh";
    if (!decision.language || uncertainChinese) {
      if (payload.cacheOnly) return { language: "", source: "unknown" };
      const selected = await view.prompt({ signal: controller.signal, title: decision.reason === "prepare-detector" ? "prepareDetection" : "language",
        message: t(decision.reason === "prepare-detector" ? "prepareDetectionHelp" : "uncertain"),
        pair: { sourceLanguage: "", targetLanguage: browserLanguage(settings.targetLanguage) }, detectText: sample, sourceText });
      assertCurrent(controller, payload.pageUrl, payload.requestId);
      decision = selected.decision || { language: selected.sourceLanguage, source: "manual", scriptKnown: true };
      if (!selected.automatic) boundedSet(corrections, correctionKey(payload, segment), decision.language);
    }
    return decision;
  }
  async function groupLookup(group, payload, raw, controller) {
    const surface = surfaceFor(payload);
    const response = await raw({ type: messages.CACHE_LOOKUP, requestId: payload.requestId, pageUrl: payload.pageUrl,
      segments: group.members.map(item => ({ id: item.id, text: item.text, format: item.format || "plain", protectedIds: item.protectedIds || [] })),
      browserTranslation: { configRevision: group.configRevision, temporaryMethod: "browser-local", surface, sourceLanguage: group.pair.sourceLanguage } });
    assertCurrent(controller, payload.pageUrl, payload.requestId);
    if (!response?.ok) throw responseError(response);
    if (response.engine !== BROWSER_ENGINE || response.sourceLanguage !== group.pair.sourceLanguage || response.targetLanguage !== group.pair.targetLanguage) throw engine.error("CONFIG_SNAPSHOT_EXPIRED");
    group.configRevision = response.configRevision || group.configRevision;
    group.snapshotId = response.configSnapshotId; group.readingResult = response.readingResult;
    group.cacheWarning = response.cacheWarning || group.cacheWarning || "";
    // Keep the original read fence across a native-config snapshot refresh.
    // A cache clear during model preparation must not resurrect old results.
    if (!group.cacheTokens) group.cacheTokens = new Map((response.writeTokens || []).map(item => [String(item.id), item.token]));
    return response;
  }
  async function lookup(payload, raw, controller) {
    if (payload.configSnapshotId && !isNativeId(payload.configSnapshotId)) return raw(withoutNativeDetection(payload));
    controller.browserAllowed = browserEligible(payload);
    const settings = await checkedSettings(payload, raw, controller);
    if (settings.engine !== BROWSER_ENGINE) {
      controller.basic = false;
      if (settings.engine === "machine-translation") {
        controller.browserAllowed = false;
        const response = await raw(withoutNativeDetection(payload));
        assertCurrent(controller, payload.pageUrl, payload.requestId);
        return response;
      }
      if (isNativeId(payload.configSnapshotId)) throw engine.error("ENGINE_SWITCH");
      if (settings.configured === false) {
        if (payload.cacheOnly) return { ok: true, hits: [], engine: "ai", skippedIds: [] };
        await view.prompt({ signal: controller.signal, title: "aiRequired", message: t("aiRequiredHelp"), action: { label: "configureAi" } });
        assertCurrent(controller, payload.pageUrl, payload.requestId);
        await raw({ type: messages.OPEN_OPTIONS, hash: "#provider" });
        throw engine.error("AI_REQUIRED");
      }
      const response = await raw(withoutNativeDetection(payload));
      assertCurrent(controller, payload.pageUrl, payload.requestId);
      if (controller.browserAllowed && response?.ok && response.configSnapshotId) {
        boundedSet(browserFallbacks, String(response.configSnapshotId), payload.pageUrl);
      }
      return response;
    }
    controller.basic = true;
    if (!settings.enabled && payload.cacheOnly) return { ok: true, hits: [], engine: BROWSER_ENGINE };
    const targetLanguage = browserLanguage(settings.targetLanguage);
    if (!targetLanguage) {
      if (payload.cacheOnly) return { ok: true, hits: [], engine: BROWSER_ENGINE };
      await view.prompt({ signal: controller.signal, title: "language", message: t("targetUnsupported") }); throw engine.error("BROWSER_LANGUAGE");
    }
    const groups = new Map(), hits = [], skippedIds = [], ids = new Set();
    for (const segment of payload.segments || []) {
      if (ids.has(segment.id)) throw engine.error("BROWSER_RESULT"); ids.add(segment.id);
      const decision = await sourceFor(payload, segment, settings, controller);
      assertCurrent(controller, payload.pageUrl, payload.requestId);
      if (decision.source === "empty" || decision.language === targetLanguage && decision.scriptKnown) {
        hits.push({ id: segment.id, text: segment.contentText ?? segment.text, skipped: true }); skippedIds.push(segment.id); continue;
      }
      if (!decision.language) continue;
      if (!groups.has(decision.language)) groups.set(decision.language, { pair: { sourceLanguage: decision.language, targetLanguage }, members: [], snapshotId: "", readingResult: null });
      groups.get(decision.language).members.push({ ...segment, decision, correctionKey: correctionKey(payload, segment) });
    }
    for (const group of groups.values()) hits.push(...(await groupLookup(group, payload, raw, controller)).hits);
    assertCurrent(controller, payload.pageUrl, payload.requestId);
    const id = PREFIX + crypto.randomUUID(), one = groups.size === 1 ? [...groups.values()][0] : null;
    // This content-only plan dispatches each language to its own background snapshot.
    const plan = { id, pageUrl: payload.pageUrl, requestId: payload.requestId, surface: surfaceFor(payload),
      groups: [...groups.values()].map(group => ({ ...group, surface: surfaceFor(payload) })), results: new Map(), cancelled: false, targetLanguage, skippedIds };
    boundedSet(plans, id, plan);
    return { ok: true, engine: BROWSER_ENGINE, configSnapshotId: id, hits, skippedIds,
      writeTokens: [...groups.values()].flatMap(group => [...group.cacheTokens].map(([id, token]) => ({ id, token }))),
      targetLanguage, sourceLanguage: one?.pair.sourceLanguage || (groups.size ? "" : targetLanguage), readingResult: one?.readingResult,
      ...([...groups.values()].some(group => group.cacheWarning) ? { cacheWarning: [...groups.values()].find(group => group.cacheWarning).cacheWarning } : {}) };
  }
  function requirePlan(payload, controller) {
    const plan = plans.get(payload.configSnapshotId);
    if (!plan || plan.pageUrl !== payload.pageUrl || plan.requestId !== payload.requestId) throw engine.error("CONFIG_SNAPSHOT_EXPIRED");
    assertCurrent(controller, plan.pageUrl, plan.requestId);
    if (plan.cancelled) throw engine.error("CANCELLED");
    return plan;
  }
  async function ensurePair(group, payload, controller) {
    const pair = group.pair, engine = nativeFor({ ...payload, languageSource: payload.languageSource || group.surface, selectionKind: payload.selectionKind || (group.surface === "selection-word" ? "word" : "text") });
    const verifyText = group.members[0]?.contentText ?? group.members[0]?.text ?? "";
    if (engine.ready(pair)) return;
    const availability = await engine.capability(pair);
    assertCurrent(controller, payload.pageUrl, payload.requestId);
    if (availability === "available") {
      try { await engine.prepare(pair, { signal: controller.signal, verifyText }); return; }
      catch (cause) { if (!["BROWSER_PREPARE", "BROWSER_VERIFY_FAILED"].includes(cause?.code)) throw cause; }
    }
    if (["unsupported", "insecure", "unavailable", "policy-denied"].includes(availability)) {
      await view.prompt({ signal: controller.signal, title: availability, message: t(`${availability}Help`) }); throw engine.error("BROWSER_UNAVAILABLE");
    }
    const selected = await view.prompt({ signal: controller.signal, title: "prepare", pair, allowPrepare: true,
      verifyText, detectText: group.members[0]?.detectionText || verifyText });
    assertCurrent(controller, payload.pageUrl, payload.requestId);
    if (selected.sourceLanguage !== pair.sourceLanguage) {
      for (const item of group.members) boundedSet(corrections, item.correctionKey, selected.sourceLanguage);
      throw engine.error("ENGINE_SWITCH");
    }
  }
  async function translate(payload, raw, controller) {
    if (!isNativeId(payload.configSnapshotId)) {
      controller.basic = false;
      controller.browserAllowed = controller.browserAllowed || browserFallbacks.get(String(payload.configSnapshotId || "")) === payload.pageUrl;
      const response = await raw(payload); assertCurrent(controller, payload.pageUrl, payload.requestId);
      return response;
    }
    controller.basic = true;
    const plan = requirePlan(payload, controller);
    payload = { ...payload, languageSource: plan.surface.startsWith("selection-") ? "selection" : plan.surface, selectionKind: plan.surface === "selection-word" ? "word" : "text" };
    const engine = nativeFor(payload);
    const settings = await raw({ type: messages.TRANSLATION_ENGINE_SETTINGS, pageUrl: payload.pageUrl, temporaryMethod: "browser-local", surface: plan.surface });
    assertCurrent(controller, payload.pageUrl, plan.requestId);
    if (!settings?.ok) throw responseError(settings);
    if (!settings.enabled) throw engine.error("BROWSER_DISABLED");
    const requested = new Map((payload.segments || []).map(item => [item.id, item]));
    if (requested.size !== (payload.segments || []).length) throw engine.error("BROWSER_RESULT");
    const translations = [], matched = new Set();
    for (const group of plan.groups) {
      const members = group.members.filter(item => requested.has(item.id));
      if (!members.length) continue;
      for (const item of members) {
        matched.add(item.id);
        if (requested.get(item.id).text !== (item.contentText ?? item.text)) throw engine.error("CONFIG_SNAPSHOT_EXPIRED");
      }
      await ensurePair(group, payload, controller);
      assertCurrent(controller, payload.pageUrl, plan.requestId);
      const input = { pair: group.pair, signal: controller.signal, segments: members.map(item => requested.get(item.id)) };
      let result;
      try { result = await engine.execute(input); }
      catch (cause) {
        // Re-prepare only the same frozen pair after a lost shared host.
        if (!["BROWSER_PREPARE", "BROWSER_HOST_LOST"].includes(cause?.code)) throw cause;
        assertCurrent(controller, payload.pageUrl, plan.requestId);
        await ensurePair(group, payload, controller);
        result = await engine.execute(input);
      }
      assertCurrent(controller, payload.pageUrl, plan.requestId);
      const values = new Map((result.translations || []).map(item => [item.id, item.text]));
      if (values.size !== members.length || values.size !== result.translations?.length) throw engine.error("BROWSER_RESULT");
      for (const item of members) {
        const text = values.get(item.id);
        if (typeof text !== "string" || !text.trim()) throw engine.error("BROWSER_RESULT");
        plan.results.set(item.id, text); translations.push({ id: item.id, text });
      }
    }
    if (matched.size !== requested.size) throw engine.error("CONFIG_SNAPSHOT_EXPIRED");
    return { ok: true, engine: BROWSER_ENGINE, translations, sourceLanguage: plan.groups.length === 1 ? plan.groups[0].pair.sourceLanguage : "", targetLanguage: plan.targetLanguage,
      readingResult: plan.groups.length === 1 ? plan.groups[0].readingResult : undefined };
  }
  async function store(payload, raw, controller) {
    if (!isNativeId(payload.configSnapshotId)) return raw(payload);
    controller.basic = true;
    const plan = requirePlan(payload, controller); let stored = 0, cacheWarning = "";
    const wanted = new Map((payload.items || []).map(item => [item.sourceText, item.translation]));
    const knownSources = new Set(plan.groups.flatMap(group => group.members.map(item => item.text)));
    if ([...wanted.keys()].some(source => !knownSources.has(source))) throw engine.error("BROWSER_RESULT");
    for (const group of plan.groups) {
      const items = group.members.filter(item => wanted.has(item.text)).map(item => {
        if (plan.results.get(item.id) !== wanted.get(item.text)) throw engine.error("BROWSER_RESULT");
        return { sourceText: item.text, translation: wanted.get(item.text), format: item.format || "plain",
          protectedIds: item.protectedIds || [], cacheToken: group.cacheTokens.get(String(item.id)) };
      });
      if (!items.length) continue;
      if (group.cacheWarning) { cacheWarning = group.cacheWarning; continue; }
      assertCurrent(controller, payload.pageUrl, plan.requestId);
      let response = await raw({ ...payload, configSnapshotId: group.snapshotId, items });
      assertCurrent(controller, payload.pageUrl, plan.requestId);
      if (response?.errorCode === "CONFIG_SNAPSHOT_EXPIRED") {
        await groupLookup(group, { ...payload, requestId: plan.requestId }, raw, controller);
        response = await raw({ ...payload, configSnapshotId: group.snapshotId, items });
      }
      if (!response?.ok) {
        if (!app.modules.runtime.isCachePersistenceError?.(response)) throw responseError(response);
        // The browser model already produced valid text. Storage failure must
        // not invalidate the result, re-run the model or hide subtitle output.
        cacheWarning = response.errorCode;
        continue;
      }
      assertCurrent(controller, payload.pageUrl, plan.requestId);
      stored += Number(response.stored || 0);
      if (response.cacheWarning || Number(response.stored || 0) < items.length)
        cacheWarning = response.cacheWarning || "CACHE_NOT_SAVED";
    }
    return { ok: true, stored, ...(cacheWarning ? { cacheWarning } : {}) };
  }
  async function subtitles(payload, raw, controller) {
    const subtitlePayload = { ...payload, languageSource: "subtitle" };
    controller.browserAllowed = true;
    const settings = await checkedSettings(subtitlePayload, raw, controller);
    if (settings.engine !== BROWSER_ENGINE && settings.configured === false) throw engine.error("AI_REQUIRED");
    if (settings.engine !== BROWSER_ENGINE) return translate(subtitlePayload, raw, controller);
    controller.basic = true;
    const units = subtitlePayload.units || [];
    const response = await lookup({ type: messages.CACHE_LOOKUP, requestId: subtitlePayload.requestId, pageUrl: subtitlePayload.pageUrl, languageSource: "subtitle",
      trackKey: `${units[0]?.mediaId || ""}:${units[0]?.track?.id || ""}:${units[0]?.track?.language || ""}`,
      segments: units.map(unit => ({ id: unit.id, text: buildSubtitleCacheSource(unit), contentText: unit.text, detectionText: unit.text, sourceLanguageHint: unit.track?.language })) }, raw, controller);
    const hits = new Map(response.hits.map(hit => [hit.id, hit.text])), missing = units.filter(unit => !hits.has(unit.id));
    let result = { ok: true, translations: [] }, cacheWarning = response.cacheWarning || "";
    if (missing.length) {
      result = await translate({ type: messages.TRANSLATE_BATCH, requestId: subtitlePayload.requestId, pageUrl: subtitlePayload.pageUrl, languageSource: "subtitle",
        configSnapshotId: response.configSnapshotId, segments: missing.map(unit => ({ id: unit.id, text: unit.text })) }, raw, controller);
      const saved = await store({ type: messages.CACHE_STORE, requestId: subtitlePayload.requestId, pageUrl: subtitlePayload.pageUrl, pageTitle: subtitlePayload.pageTitle, configSnapshotId: response.configSnapshotId,
        items: missing.map(unit => ({ sourceText: buildSubtitleCacheSource(unit), translation: result.translations.find(item => item.id === unit.id)?.text })) }, raw, controller);
      if (!saved.ok) return saved;
      cacheWarning = saved.cacheWarning || cacheWarning;
    }
    return { ok: true, engine: BROWSER_ENGINE, translations: [...response.hits.map(hit => ({ ...hit, cacheHit: !hit.skipped })), ...result.translations], cacheHits: hits.size - response.skippedIds.length, apiTranslated: result.translations.length,
      ...(cacheWarning ? { cacheWarning } : {}) };
  }
  async function send(payload, raw) {
    if (location.href !== route) { dispose(); route = location.href; }
    if (payload.type === messages.CANCEL_TRANSLATION) {
      const id = payload.requestId; cancelled.add(id); if (cancelled.size > 256) cancelled.delete(cancelled.values().next().value);
      const local = requests.get(id); local?.abort();
      for (const plan of plans.values()) if (plan.requestId === id) plan.cancelled = true;
      const result = await raw(payload); return { ...result, cancelled: Boolean(local || result?.cancelled) };
    }
    if (![messages.CACHE_LOOKUP, messages.TRANSLATE_BATCH, messages.CACHE_STORE, messages.SUBTITLE_TRANSLATE_BATCH].includes(payload.type)) return raw(payload);
    const id = payload.requestId || plans.get(payload.configSnapshotId)?.requestId || crypto.randomUUID();
    const previous = requests.get(id), controller = previous || new AbortController(); requests.set(id, controller);
    try {
      assertCurrent(controller, payload.pageUrl, id);
      const input = { ...payload, requestId: id };
      if (payload.type === messages.CACHE_LOOKUP) return await lookup(input, raw, controller);
      if (payload.type === messages.TRANSLATE_BATCH) return await translate(input, raw, controller);
      if (payload.type === messages.CACHE_STORE) return await store(input, raw, controller);
      return await subtitles(input, raw, controller);
    } finally { if (!previous && requests.get(id) === controller) requests.delete(id); }
  }
  function dispose({ basicOnly = false } = {}) {
    for (const [id, controller] of requests) if (!basicOnly || controller.basic) { controller.abort(); requests.delete(id); }
    for (const plan of plans.values()) { cancelled.add(plan.requestId); plan.cancelled = true; }
    while (cancelled.size > 256) cancelled.delete(cancelled.values().next().value);
    plans.clear(); corrections.clear(); browserFallbacks.clear(); engine.dispose(); view.close();
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== messages.PUBLIC_SETTINGS_CHANGED) return;
    if (["translationPreferences", "defaultService", "providerConnections", "aiServiceConfigured", "apiKey"].some(key => message.changes?.[key])) dispose();
    if (message.changes?.machineTranslation || message.changes?.siteProfiles || message.changes?.targetLanguage) { dispose(); }
    if (message.changes?.browserSourceLanguage || message.changes?.targetLanguage || message.changes?.browserTranslationEnabled?.newValue === false) dispose({ basicOnly: true });
  });
  window.addEventListener("pagehide", dispose); window.addEventListener("popstate", dispose);
  window.addEventListener("hashchange", dispose);
  window.navigation?.addEventListener("navigate", event => {
    // Hydration and client routers can replace history state without leaving
    // this document or URL. Keep its active translations in that case.
    if (event.destination?.sameDocument && event.destination.url === location.href) return;
    dispose();
  });
  async function requireAi(pageUrl) {
    const result = await app.modules.runtime.sendRuntimeMessage({ type: messages.TRANSLATION_ENGINE_SETTINGS, pageUrl, surface: "selection-ai" });
    if (result?.ok && result.engine === "ai" && result.configured !== false) return true;
    await app.modules.runtime.sendRuntimeMessage({ type: messages.OPEN_OPTIONS, hash: "#provider" }); return false;
  }
  app.modules.translationClient = { send, dispose, requireAi };
})();
