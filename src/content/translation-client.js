(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.browserTranslation || app.modules.translationClient) return;
  const { BROWSER_ENGINE, browserLanguage, buildSubtitleCacheSource } = app.modules.browserTranslationContract;
  const engine = app.modules.browserTranslation, view = app.modules.browserTranslationView;
  const messages = app.modules.runtime.messages.background;
  const snapshots = new Map(), requests = new Map();
  let forceBrowser = false, sourceOverride = "", route = location.href;
  const t = (key, args) => app.modules.contentI18n.t(`content.basic.${key}`, args);
  function assertCurrent(controller, pageUrl) {
    if (!controller || controller.signal.aborted || location.href !== pageUrl) throw engine.error("CANCELLED");
  }
  async function checkedSettings(payload, raw) {
    const result = await raw({ type: messages.TRANSLATION_ENGINE_SETTINGS, pageUrl: payload.pageUrl, forceBrowser });
    if (!result?.ok) throw Object.assign(engine.error("AI_CONFIG"), { code: result?.errorCode || "CONFIG" });
    if (result.engine === BROWSER_ENGINE && !result.enabled) {
      if (payload.cacheOnly) return { ok: true, engine: BROWSER_ENGINE, enabled: false };
      await view.prompt({ signal: payload.signal, title: "disabled", message: t("disabledHelp"), action: { label: "enable" } });
      // Use trusted extension Settings to persist the preference; opening a page
      // does not silently change it or initialize a model.
      await raw({ type: messages.OPEN_OPTIONS, hash: "#general" });
      throw engine.error("BROWSER_DISABLED");
    }
    return result;
  }
  async function lookup(payload, raw) {
    if (payload.configSnapshotId) return raw(payload);
    const requestId = payload.requestId || crypto.randomUUID();
    const existing = requests.get(requestId), controller = existing || new AbortController(); requests.set(requestId, controller); controller.basic = true;
    try {
      const settings = await checkedSettings({ ...payload, signal: controller.signal }, raw);
      assertCurrent(controller, payload.pageUrl);
      if (!settings?.ok || settings.engine !== BROWSER_ENGINE) { controller.basic = false; return raw(payload); }
      if (payload.cacheOnly && !settings.enabled) return { ok: true, hits: [] };
      const targetLanguage = browserLanguage(settings.targetLanguage);
      if (!targetLanguage && payload.cacheOnly) return { ok: true, hits: [] };
      if (!targetLanguage) { await view.prompt({ signal: controller.signal, title: "language", message: t("targetUnsupported") }); throw engine.error("BROWSER_LANGUAGE"); }
      let sourceLanguage = browserLanguage(payload.sourceLanguageHint) || sourceOverride || browserLanguage(settings.sourceLanguage) ||
        await engine.detect(payload.detectionText || payload.segments?.map(item => item.text).join(" "), payload.sourceLanguageHint || (payload.languageSource === "selection" ? "" : document.documentElement.lang));
      assertCurrent(controller, payload.pageUrl);
      if (!sourceLanguage && payload.cacheOnly) return { ok: true, hits: [] };
      if (!sourceLanguage) {
        const pair = await view.prompt({ signal: controller.signal, title: "language", message: t("detectOrChoose"), pair: { sourceLanguage, targetLanguage }, detectText: payload.detectionText || payload.segments?.[0]?.text });
        sourceLanguage = pair.sourceLanguage;
        sourceOverride = sourceLanguage;
      }
      assertCurrent(controller, payload.pageUrl);
      const response = await raw({ ...payload, browserTranslation: { forceBrowser, sourceLanguage } });
      if (response?.ok && response.engine === BROWSER_ENGINE) {
        snapshots.set(response.configSnapshotId, { sourceLanguage: response.sourceLanguage, targetLanguage: response.targetLanguage });
        if (snapshots.size > 256) snapshots.delete(snapshots.keys().next().value);
      }
      return response;
    } finally { if (!existing && requests.get(requestId) === controller) requests.delete(requestId); }
  }
  async function translate(payload, raw) {
    const pair = snapshots.get(payload.configSnapshotId);
    const existing = requests.get(payload.requestId), controller = existing || new AbortController(); requests.set(payload.requestId, controller); controller.basic = Boolean(pair);
    try {
      if (!pair) {
        const response = await raw(payload);
        assertCurrent(controller, payload.pageUrl);
        if (response?.ok || response?.errorCode === "CANCELLED") return response;
        // AI failure is visible and never starts an implicit fallback request.
        await view.prompt({ signal: controller.signal, title: "aiFailed", message: t("aiFailedHelp"), action: { label: "useBasic" } });
        forceBrowser = true;
        throw engine.error("ENGINE_SWITCH");
      }
      const settings = await raw({ type: messages.TRANSLATION_ENGINE_SETTINGS, pageUrl: payload.pageUrl, forceBrowser: true });
      assertCurrent(controller, payload.pageUrl);
      if (!settings?.enabled) throw engine.error("BROWSER_DISABLED");
      if (pair.sourceLanguage === pair.targetLanguage) {
        const selected = await view.prompt({ signal: controller.signal, title: "sameLanguage", message: t("sameLanguageHelp"), pair });
        if (selected.sourceLanguage !== pair.sourceLanguage) { sourceOverride = selected.sourceLanguage; throw engine.error("ENGINE_SWITCH"); }
        throw engine.error("BROWSER_LANGUAGE");
      }
      if (!engine.ready(pair)) {
        const availability = await engine.capability(pair);
        assertCurrent(controller, payload.pageUrl);
        if (["unsupported", "insecure", "unavailable", "policy-denied"].includes(availability)) {
          const selected = await view.prompt({ signal: controller.signal, title: availability, message: t(`${availability}Help`), ...(availability === "unavailable" ? { pair } : {}) });
          if (selected?.sourceLanguage && selected.sourceLanguage !== pair.sourceLanguage) { sourceOverride = selected.sourceLanguage; throw engine.error("ENGINE_SWITCH"); }
          throw engine.error("BROWSER_UNAVAILABLE");
        }
        const selected = await view.prompt({ signal: controller.signal, title: "prepare", pair, allowPrepare: true, detectText: payload.segments?.[0]?.text });
        if (selected.sourceLanguage !== pair.sourceLanguage) {
          sourceOverride = selected.sourceLanguage;
          throw engine.error("ENGINE_SWITCH"); // New task and cache identity.
        }
      }
      assertCurrent(controller, payload.pageUrl);
      const result = await engine.execute({ pair, segments: payload.segments, signal: controller.signal });
      assertCurrent(controller, payload.pageUrl);
      return { ok: true, ...result };
    } finally { if (!existing && requests.get(payload.requestId) === controller) requests.delete(payload.requestId); }
  }
  async function subtitles(payload, raw) {
    const settings = await checkedSettings({ ...payload, signal: requests.get(payload.requestId)?.signal }, raw);
    if (!settings?.ok) return settings;
    assertCurrent(requests.get(payload.requestId), payload.pageUrl);
    if (settings.engine !== BROWSER_ENGINE) {
      const result = await raw(payload);
      if (result?.ok) return result;
      const controller = requests.get(payload.requestId);
      try { await view.prompt({ signal: controller.signal, title: "aiFailed", message: t("aiFailedHelp"), action: { label: "useBasic" } }); forceBrowser = true; throw engine.error("ENGINE_SWITCH"); }
      finally { /* The outer request owns cancellation until completion. */ }
    }
    requests.get(payload.requestId).basic = true;
    const units = payload.units || [];
    const response = await lookup({ type: messages.CACHE_LOOKUP, requestId: payload.requestId, pageUrl: payload.pageUrl,
      sourceLanguageHint: units[0]?.track?.language, detectionText: units.map(unit => unit.text).join(" "),
      segments: units.map(unit => ({ id: unit.id, text: buildSubtitleCacheSource(unit) })) }, raw);
    if (!response?.ok) return response;
    const hits = new Map((response.hits || []).map(hit => [hit.id, hit.text]));
    const missing = units.filter(unit => !hits.has(unit.id));
    let result = { ok: true, translations: [] };
    if (missing.length) result = await translate({ type: messages.TRANSLATE_BATCH, requestId: payload.requestId, pageUrl: payload.pageUrl,
      configSnapshotId: response.configSnapshotId, segments: missing.map(unit => ({ id: unit.id, text: unit.text })) }, raw);
    if (!result?.ok) return result;
    // The pipeline checks its own task/generation too, before rendering.
    assertCurrent(requests.get(payload.requestId), payload.pageUrl);
    const stored = await raw({ type: messages.CACHE_STORE, pageUrl: payload.pageUrl, pageTitle: payload.pageTitle,
      configSnapshotId: response.configSnapshotId, items: missing.map(unit => ({ sourceText: buildSubtitleCacheSource(unit), translation: result.translations.find(item => item.id === unit.id)?.text })).filter(item => item.translation) });
    if (!stored?.ok) return stored;
    return { ok: true, engine: BROWSER_ENGINE, translations: [...response.hits.map(hit => ({ ...hit, cacheHit: true })), ...result.translations], cacheHits: hits.size, apiTranslated: result.translations.length };
  }
  async function send(payload, raw) {
    if (location.href !== route) { dispose(); route = location.href; forceBrowser = false; sourceOverride = ""; }
    if (payload.type === messages.CANCEL_TRANSLATION) { requests.get(payload.requestId)?.abort(); }
    if (payload.type === messages.CACHE_LOOKUP) return lookup(payload, raw);
    if (payload.type === messages.TRANSLATE_BATCH) return translate(payload, raw);
    if (payload.type === messages.SUBTITLE_TRANSLATE_BATCH) {
      const controller = new AbortController(); requests.set(payload.requestId, controller);
      try { return await subtitles(payload, raw); }
      finally { if (requests.get(payload.requestId) === controller) requests.delete(payload.requestId); }
    }
    return raw(payload);
  }
  function dispose({ basicOnly = false } = {}) {
    for (const [id, controller] of requests) if (!basicOnly || controller.basic) { controller.abort(); requests.delete(id); }
    engine.dispose(); view.close(); if (!basicOnly) snapshots.clear();
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === messages.PUBLIC_SETTINGS_CHANGED && ["defaultService", "providerConnections", "aiServiceConfigured", "apiKey"].some(key => message.changes?.[key])) forceBrowser = false;
    if (message?.changes?.browserSourceLanguage) sourceOverride = "";
    if (message?.type === messages.PUBLIC_SETTINGS_CHANGED && message.changes?.browserTranslationEnabled?.newValue === false) { forceBrowser = false; dispose({ basicOnly: true }); }
  });
  window.addEventListener("pagehide", dispose);
  window.addEventListener("popstate", dispose);
  window.addEventListener("hashchange", dispose);
  window.navigation?.addEventListener("navigate", dispose);
  async function requireAi(pageUrl) {
    const result = await app.modules.runtime.sendRuntimeMessage({ type: messages.TRANSLATION_ENGINE_SETTINGS, pageUrl });
    if (result?.engine !== BROWSER_ENGINE) return true;
    await app.modules.runtime.sendRuntimeMessage({ type: messages.OPEN_OPTIONS, hash: "#provider" }); return false;
  }
  app.modules.translationClient = { send, dispose, requireAi };
})();
