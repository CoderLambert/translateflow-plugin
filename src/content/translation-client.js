(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.browserTranslation || app.modules.translationClient) return;
  const { BROWSER_ENGINE, browserLanguage, buildSubtitleCacheSource, explicitSource, detectionSample } = app.modules.browserTranslationContract;
  const engine = app.modules.browserTranslation, view = app.modules.browserTranslationView;
  const messages = app.modules.runtime.messages.background;
  const plans = new Map(), requests = new Map(), corrections = new Map(), browserFallbacks = new Map(), cancelled = new Set();
  const PREFIX = "browser-plan:";
  let forceBrowser = false, route = location.href;
  const t = (key, args) => app.modules.contentI18n.t(`content.basic.${key}`, args);
  const isNativeId = id => typeof id === "string" && id.startsWith(PREFIX);
  function boundedSet(map, key, value) { map.set(key, value); if (map.size > 256) map.delete(map.keys().next().value); }
  function assertCurrent(controller, pageUrl, requestId) {
    if (!controller || controller.signal.aborted || location.href !== pageUrl || cancelled.has(requestId)) throw engine.error("CANCELLED");
  }
  function responseError(response) { return engine.error(response?.errorCode || "BROWSER_UNAVAILABLE"); }
  function browserEligible(payload) {
    return payload?.languageSource === "selection" && payload?.browserTranslationAllowed === true;
  }
  function correctionKey(payload, segment) {
    return payload.languageSource === "subtitle" ? `track:${payload.trackKey || ""}` : `${payload.languageSource || "page"}:${segment.contentText ?? segment.text}`;
  }
  async function checkedSettings(payload, raw, controller) {
    const eligible = browserEligible(payload) || controller.browserAllowed === true;
    const result = await raw({ type: messages.TRANSLATION_ENGINE_SETTINGS, pageUrl: payload.pageUrl,
      forceBrowser: eligible && forceBrowser, surface: eligible ? "selection-word" : (payload.languageSource || "page") });
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
    let decision = await engine.detectDecision(sample, { signal: controller.signal, cacheOnly: payload.cacheOnly });
    assertCurrent(controller, payload.pageUrl, payload.requestId);
    if (decision.source === "empty") return decision;
    const uncertainChinese = decision.language === "zh" && !decision.scriptKnown && browserLanguage(settings.targetLanguage) === "zh";
    if (!decision.language || uncertainChinese) {
      if (payload.cacheOnly) return { language: "", source: "unknown" };
      const selected = await view.prompt({ signal: controller.signal, title: decision.reason === "prepare-detector" ? "prepareDetection" : "language",
        message: t(decision.reason === "prepare-detector" ? "prepareDetectionHelp" : "uncertain"),
        pair: { sourceLanguage: "", targetLanguage: browserLanguage(settings.targetLanguage) }, detectText: sample });
      assertCurrent(controller, payload.pageUrl, payload.requestId);
      decision = selected.decision || { language: selected.sourceLanguage, source: "manual", scriptKnown: true };
      if (!selected.automatic) boundedSet(corrections, correctionKey(payload, segment), decision.language);
    }
    return decision;
  }
  async function groupLookup(group, payload, raw, controller) {
    const response = await raw({ type: messages.CACHE_LOOKUP, requestId: payload.requestId, pageUrl: payload.pageUrl,
      segments: group.members.map(item => ({ id: item.id, text: item.text })),
      browserTranslation: { forceBrowser: true, surface: "selection-word", sourceLanguage: group.pair.sourceLanguage } });
    assertCurrent(controller, payload.pageUrl, payload.requestId);
    if (!response?.ok) throw responseError(response);
    if (response.engine !== BROWSER_ENGINE || response.sourceLanguage !== group.pair.sourceLanguage || response.targetLanguage !== group.pair.targetLanguage) throw engine.error("CONFIG_SNAPSHOT_EXPIRED");
    group.snapshotId = response.configSnapshotId; group.readingResult = response.readingResult;
    return response;
  }
  async function lookup(payload, raw, controller) {
    if (payload.configSnapshotId && !isNativeId(payload.configSnapshotId)) return raw(payload);
    controller.browserAllowed = browserEligible(payload);
    const settings = await checkedSettings(payload, raw, controller);
    if (settings.engine !== BROWSER_ENGINE) {
      controller.basic = false;
      if (isNativeId(payload.configSnapshotId)) throw engine.error("ENGINE_SWITCH");
      if (settings.configured === false) {
        if (payload.cacheOnly) return { ok: true, hits: [], engine: "ai", skippedIds: [] };
        await view.prompt({ signal: controller.signal, title: "aiRequired", message: t("aiRequiredHelp"), action: { label: "configureAi" } });
        assertCurrent(controller, payload.pageUrl, payload.requestId);
        await raw({ type: messages.OPEN_OPTIONS, hash: "#provider" });
        throw engine.error("AI_REQUIRED");
      }
      const response = await raw(payload);
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
      if (!decision.language) continue; // A silent cache-only lookup never prompts or guesses.
      if (!groups.has(decision.language)) groups.set(decision.language, { pair: { sourceLanguage: decision.language, targetLanguage }, members: [], snapshotId: "", readingResult: null });
      groups.get(decision.language).members.push({ ...segment, decision, correctionKey: correctionKey(payload, segment) });
    }
    for (const group of groups.values()) hits.push(...(await groupLookup(group, payload, raw, controller)).hits);
    assertCurrent(controller, payload.pageUrl, payload.requestId);
    const id = PREFIX + crypto.randomUUID(), one = groups.size === 1 ? [...groups.values()][0] : null;
    // This content-only plan dispatches each language to its OWN existing background snapshot.
    // AI's request-wide immutable snapshot contract is unchanged.
    const plan = { id, pageUrl: payload.pageUrl, requestId: payload.requestId, groups: [...groups.values()], results: new Map(), cancelled: false, targetLanguage, skippedIds };
    boundedSet(plans, id, plan);
    return { ok: true, engine: BROWSER_ENGINE, configSnapshotId: id, hits, skippedIds,
      targetLanguage, sourceLanguage: one?.pair.sourceLanguage || (groups.size ? "" : targetLanguage), readingResult: one?.readingResult };
  }
  function requirePlan(payload, controller) {
    const plan = plans.get(payload.configSnapshotId);
    if (!plan || plan.pageUrl !== payload.pageUrl || plan.requestId !== payload.requestId) throw engine.error("CONFIG_SNAPSHOT_EXPIRED");
    assertCurrent(controller, plan.pageUrl, plan.requestId);
    if (plan.cancelled) throw engine.error("CANCELLED");
    return plan;
  }
  async function ensurePair(group, payload, controller) {
    const pair = group.pair;
    if (engine.ready(pair)) return;
    const availability = await engine.capability(pair);
    assertCurrent(controller, payload.pageUrl, payload.requestId);
    if (availability === "available") {
      // Warm an already-available model without making the user confirm every request.
      try { await engine.prepare(pair, { signal: controller.signal }); return; }
      catch (cause) { if (cause?.code !== "BROWSER_PREPARE") throw cause; }
    }
    if (["unsupported", "insecure", "unavailable", "policy-denied"].includes(availability)) {
      await view.prompt({ signal: controller.signal, title: availability, message: t(`${availability}Help`) }); throw engine.error("BROWSER_UNAVAILABLE");
    }
    const selected = await view.prompt({ signal: controller.signal, title: "prepare", pair, allowPrepare: true,
      detectText: group.members[0]?.detectionText || group.members[0]?.contentText || group.members[0]?.text });
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
      if (response?.ok || ["CANCELLED", "CONFIG_SNAPSHOT_EXPIRED"].includes(response?.errorCode)) return response;
      if (!controller.browserAllowed) return response;
      await view.prompt({ signal: controller.signal, title: "aiFailed", message: t("aiFailedHelp"), action: { label: "useBasic" } });
      assertCurrent(controller, payload.pageUrl, payload.requestId); forceBrowser = true; throw engine.error("ENGINE_SWITCH");
    }
    controller.basic = true;
    const plan = requirePlan(payload, controller);
    const settings = await raw({ type: messages.TRANSLATION_ENGINE_SETTINGS, pageUrl: payload.pageUrl, forceBrowser: true });
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
      const result = await engine.execute({ pair: group.pair, signal: controller.signal, segments: members.map(item => requested.get(item.id)) });
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
    const plan = requirePlan(payload, controller); let stored = 0;
    const wanted = new Map((payload.items || []).map(item => [item.sourceText, item.translation]));
    const knownSources = new Set(plan.groups.flatMap(group => group.members.map(item => item.text)));
    if ([...wanted.keys()].some(source => !knownSources.has(source))) throw engine.error("BROWSER_RESULT");
    for (const group of plan.groups) {
      const items = group.members.filter(item => wanted.has(item.text)).map(item => {
        if (plan.results.get(item.id) !== wanted.get(item.text)) throw engine.error("BROWSER_RESULT");
        return { sourceText: item.text, translation: wanted.get(item.text) };
      });
      if (!items.length) continue;
      assertCurrent(controller, payload.pageUrl, plan.requestId);
      let response = await raw({ ...payload, configSnapshotId: group.snapshotId, items });
      assertCurrent(controller, payload.pageUrl, plan.requestId);
      if (response?.errorCode === "CONFIG_SNAPSHOT_EXPIRED") {
        // A worker restart/download wait may discard its in-memory snapshot. Recover ONLY the pinned native pair, once.
        await groupLookup(group, { ...payload, requestId: plan.requestId }, raw, controller);
        response = await raw({ ...payload, configSnapshotId: group.snapshotId, items });
      }
      if (!response?.ok) throw responseError(response);
      assertCurrent(controller, payload.pageUrl, plan.requestId); stored += Number(response.stored || 0);
    }
    return { ok: true, stored };
  }
  async function subtitles(payload, raw, controller) {
    const settings = await checkedSettings(payload, raw, controller);
    if (settings.engine !== BROWSER_ENGINE && settings.configured === false) throw engine.error("AI_REQUIRED");
    if (settings.engine !== BROWSER_ENGINE) return translate(payload, raw, controller);
    controller.basic = true;
    const units = payload.units || [];
    const response = await lookup({ type: messages.CACHE_LOOKUP, requestId: payload.requestId, pageUrl: payload.pageUrl, languageSource: "subtitle",
      trackKey: `${units[0]?.mediaId || ""}:${units[0]?.track?.id || ""}:${units[0]?.track?.language || ""}`,
      segments: units.map(unit => ({ id: unit.id, text: buildSubtitleCacheSource(unit), contentText: unit.text, detectionText: unit.text, sourceLanguageHint: unit.track?.language })) }, raw, controller);
    const hits = new Map(response.hits.map(hit => [hit.id, hit.text])), missing = units.filter(unit => !hits.has(unit.id));
    let result = { ok: true, translations: [] };
    if (missing.length) {
      result = await translate({ type: messages.TRANSLATE_BATCH, requestId: payload.requestId, pageUrl: payload.pageUrl,
        configSnapshotId: response.configSnapshotId, segments: missing.map(unit => ({ id: unit.id, text: unit.text })) }, raw, controller);
      const saved = await store({ type: messages.CACHE_STORE, requestId: payload.requestId, pageUrl: payload.pageUrl, pageTitle: payload.pageTitle, configSnapshotId: response.configSnapshotId,
        items: missing.map(unit => ({ sourceText: buildSubtitleCacheSource(unit), translation: result.translations.find(item => item.id === unit.id)?.text })) }, raw, controller);
      if (!saved.ok) return saved;
    }
    return { ok: true, engine: BROWSER_ENGINE, translations: [...response.hits.map(hit => ({ ...hit, cacheHit: !hit.skipped })), ...result.translations], cacheHits: hits.size - response.skippedIds.length, apiTranslated: result.translations.length };
  }
  async function send(payload, raw) {
    if (location.href !== route) { dispose(); route = location.href; forceBrowser = false; }
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
    if (["defaultService", "providerConnections", "aiServiceConfigured", "apiKey"].some(key => message.changes?.[key])) forceBrowser = false;
    if (message.changes?.browserSourceLanguage || message.changes?.targetLanguage || message.changes?.browserTranslationEnabled?.newValue === false) dispose({ basicOnly: true });
  });
  window.addEventListener("pagehide", dispose); window.addEventListener("popstate", dispose);
  window.addEventListener("hashchange", dispose); window.navigation?.addEventListener("navigate", dispose);
  async function requireAi(pageUrl) {
    const result = await app.modules.runtime.sendRuntimeMessage({ type: messages.TRANSLATION_ENGINE_SETTINGS, pageUrl, surface: "selection-ai" });
    if (result?.ok && result.engine === "ai" && result.configured !== false) return true;
    await app.modules.runtime.sendRuntimeMessage({ type: messages.OPEN_OPTIONS, hash: "#provider" }); return false;
  }
  app.modules.translationClient = { send, dispose, requireAi };
})();
