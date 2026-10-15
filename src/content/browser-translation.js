(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.browserTranslationContract || app.modules.browserTranslation) return;
  const { BROWSER_ENGINE, browserLanguage, chooseDetectedLanguage, scriptLanguage, detectionSample, translationParts,
    BROWSER_TRANSLATION_ACTIONS: actions } = app.modules.browserTranslationContract;
  const resources = new Map(), detections = new Map();
  const IDLE_MS = 120000, PREPARE_MS = 180000, CANCEL_DRAIN_MS = 1500;
  let generation = 0;
  const error = (code, cause) => Object.assign(new Error(code), { code, cause, i18nKey: `content.basic.${code}` });
  const pairKey = pair => `translator:${pair.sourceLanguage}:${pair.targetLanguage}`;
  const safeDestroy = instance => { try { instance?.destroy?.(); } catch {} };
  function assertLive(signal, expected) {
    if (signal?.aborted || expected !== generation) throw error("CANCELLED");
  }
  function normalizeError(cause) {
    if (typeof cause?.code === "string") return cause;
    if (cause?.name === "AbortError") return error("CANCELLED", cause);
    if (cause?.name === "NotAllowedError") return error("BROWSER_PREPARE", cause);
    if (cause?.name === "QuotaExceededError") return error("BROWSER_TOO_LONG", cause);
    return error("BROWSER_UNAVAILABLE", cause);
  }
  function wait(promise, signal, timeoutMs = 0) {
    return new Promise((resolve, reject) => {
      let done = false, timer;
      const finish = (callback, value) => {
        if (done) return; done = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", aborted); callback(value);
      };
      const aborted = () => finish(reject, error("CANCELLED"));
      // Always consume late settlements, including an already-aborted caller.
      Promise.resolve(promise).then(value => finish(resolve, value), cause => finish(reject, cause));
      if (signal?.aborted) return aborted();
      signal?.addEventListener("abort", aborted, { once: true });
      if (timeoutMs) { timer = setTimeout(() => finish(reject, error("BROWSER_TIMEOUT")), timeoutMs); timer.unref?.(); }
    });
  }
  function retire(entry) {
    if (entry.removed) return;
    entry.removed = true; clearTimeout(entry.timer);
    if (resources.get(entry.key) === entry) resources.delete(entry.key);
    entry.controller.abort(); safeDestroy(entry.instance);
  }
  function release(entry, owner) {
    entry.owners.delete(owner);
    if (entry.removed || entry.owners.size) return;
    if (!entry.instance || entry.invalid) return retire(entry);
    entry.lastUsed = Date.now();
    entry.timer = setTimeout(() => retire(entry), IDLE_MS); entry.timer.unref?.();
  }
  function report(entry, loaded) {
    if (typeof loaded !== "number" || !Number.isFinite(loaded) || loaded < 0 || loaded > 1 || entry.removed) return;
    entry.loaded = Math.max(entry.loaded || 0, loaded);
    for (const owner of entry.owners) if (!owner.signal?.aborted) { try { owner.progress?.(entry.loaded); } catch {} }
  }
  function acquire(kind, pair, { signal, progress } = {}) {
    if (signal?.aborted) return Promise.reject(error("CANCELLED"));
    const id = kind === "detector" ? "detector" : pairKey(pair);
    let entry = resources.get(id);
    if (entry?.invalid) { if (entry.owners.size) return Promise.reject(error("BROWSER_BUSY")); retire(entry); entry = null; }
    if (!entry) {
      const api = kind === "detector" ? globalThis.LanguageDetector : globalThis.Translator;
      if (typeof api?.create !== "function") return Promise.reject(error("BROWSER_UNAVAILABLE"));
      const peers = [...resources.values()].filter(item => item.kind === kind);
      if (peers.length >= (kind === "detector" ? 1 : 2)) {
        const idle = peers.filter(item => !item.owners.size).sort((a, b) => a.lastUsed - b.lastUsed)[0];
        if (!idle) return Promise.reject(error("BROWSER_BUSY"));
        retire(idle);
      }
      entry = { key: id, kind, controller: new AbortController(), owners: new Set(), instance: null,
        tail: Promise.resolve(), loaded: 0, removed: false, invalid: false, lastUsed: Date.now(), timer: undefined, promise: null };
      resources.set(id, entry);
    }
    clearTimeout(entry.timer);
    const owned = entry, owner = { signal, progress };
    owned.owners.add(owner);
    if (!owned.promise) {
      const api = kind === "detector" ? globalThis.LanguageDetector : globalThis.Translator;
      try {
        // Start synchronously in the click stack. Instance lifetime is NOT the caller's lifetime.
        const pending = api.create({ ...(kind === "translator" ? pair : {}), signal: owned.controller.signal,
          monitor(monitor) { monitor.addEventListener("downloadprogress", event => report(owned, event.loaded)); } });
        owned.promise = Promise.resolve(pending).then(instance => {
          if (owned.removed) { safeDestroy(instance); throw error("CANCELLED"); }
          owned.instance = instance; return instance;
        }, cause => { retire(owned); throw normalizeError(cause); });
      } catch (cause) { retire(owned); owned.promise = Promise.reject(normalizeError(cause)); }
    }
    return wait(owned.promise, signal, PREPARE_MS).then(instance => ({ entry: owned, instance, release: () => release(owned, owner) }), cause => {
      release(owned, owner); throw normalizeError(cause);
    });
  }
  function use(kind, pair, operation, options = {}) {
    const expected = generation;
    const job = acquire(kind, pair, options).then(async lease => {
      const { entry, instance } = lease;
      let unlock, drain;
      const previous = entry.tail;
      const slot = new Promise(resolve => { unlock = resolve; });
      entry.tail = previous.then(() => slot);
      const aborted = () => { drain = setTimeout(() => retire(entry), CANCEL_DRAIN_MS); drain.unref?.(); };
      try {
        await wait(wait(previous, entry.controller.signal), options.signal);
        assertLive(options.signal, expected);
        if (entry.removed || entry.invalid) throw error("BROWSER_PREPARE");
        options.signal?.addEventListener("abort", aborted, { once: true });
        // Keep the serial slot until the native operation settles or its instance is retired.
        const result = await wait(operation(instance), entry.controller.signal);
        assertLive(options.signal, expected); return result;
      } catch (cause) {
        if (!options.signal?.aborted && cause?.name !== "QuotaExceededError" && cause?.code !== "BROWSER_TOO_LONG") entry.invalid = true;
        throw normalizeError(cause);
      } finally {
        clearTimeout(drain); options.signal?.removeEventListener("abort", aborted);
        unlock(); lease.release();
      }
    });
    return wait(job, options.signal);
  }
  async function capability(pair) {
    if (!globalThis.isSecureContext) return "insecure";
    if (typeof globalThis.Translator?.availability !== "function") return "unsupported";
    const policy = globalThis.document?.permissionsPolicy || globalThis.document?.featurePolicy;
    if (policy?.features?.().includes("translator") && !policy.allowsFeature("translator")) return "policy-denied";
    try { return await globalThis.Translator.availability(pair); } catch { return "unavailable"; }
  }
  function prepare(pair, options = {}) {
    return acquire("translator", pair, options).then(lease => {
      lease.release(); return { engine: BROWSER_ENGINE, ...pair, state: "ready" };
    });
  }
  function prepareDetector(options = {}) {
    return acquire("detector", null, options).then(lease => { lease.release(); });
  }
  async function detectorCapability() {
    if (resources.get("detector")?.instance && !resources.get("detector").invalid) return "available";
    if (typeof globalThis.LanguageDetector?.create !== "function") return "unsupported";
    try { return await globalThis.LanguageDetector.availability(); } catch { return "unavailable"; }
  }
  async function detectDecision(text, { signal, protectedIds = [], cacheOnly = false } = {}) {
    const expected = generation, sample = detectionSample(text, protectedIds);
    assertLive(signal, expected);
    if (!/\p{L}/u.test(sample)) return { language: "", source: "empty", scriptKnown: true };
    if (detections.has(sample)) return detections.get(sample);
    const availability = await wait(detectorCapability(), signal);
    assertLive(signal, expected);
    if (availability === "available" && (!cacheOnly || resources.get("detector")?.instance)) {
      try {
        const values = await use("detector", null, instance => instance.detect(sample, { signal }), { signal });
        assertLive(signal, expected);
        const result = chooseDetectedLanguage(values, sample);
        if (result.language) {
          detections.set(sample, result);
          if (detections.size > 256) detections.delete(detections.keys().next().value);
          return result;
        }
      } catch (cause) {
        assertLive(signal, expected);
        if (cause?.code === "CANCELLED") throw cause;
      }
    }
    const language = scriptLanguage(sample);
    return { language, source: language ? "script" : "unknown", scriptKnown: Boolean(language),
      reason: availability === "downloadable" || availability === "downloading" ? "prepare-detector" : "uncertain" };
  }
  async function detect(text, _hint = "", options = {}) {
    return (await detectDecision(text, options)).language;
  }
  async function execute({ pair, segments, signal }) {
    const expected = generation;
    assertLive(signal, expected);
    // Validate the complete batch before any model call; do not feed code or sentinels to the model.
    const prepared = segments.map(segment => ({ id: segment.id, parts: translationParts(segment.text, segment.protectedIds || []) }));
    if (pair.sourceLanguage === pair.targetLanguage) return { engine: BROWSER_ENGINE, ...pair, translations: segments.map(({ id, text }) => ({ id, text })) };
    if (!ready(pair)) throw error("BROWSER_PREPARE");
    return use("translator", pair, async instance => {
      const translations = [];
      for (const segment of prepared) {
        let text = "";
        for (const part of segment.parts) {
          assertLive(signal, expected);
          if (part.protected || !part.text.trim()) { text += part.text; continue; }
          const value = await instance.translate(part.text.trim(), { signal });
          assertLive(signal, expected);
          if (typeof value !== "string" || !value.trim()) throw error("BROWSER_RESULT");
          text += part.text.match(/^\s*/)[0] + value + part.text.match(/\s*$/)[0];
        }
        translations.push({ id: segment.id, text });
      }
      return { translations, engine: BROWSER_ENGINE, ...pair };
    }, { signal });
  }
  function ready(pair) { const item = resources.get(pairKey(pair)); return Boolean(item?.instance && !item.invalid && !item.removed); }
  function dispose() {
    generation++; for (const entry of resources.values()) retire(entry); resources.clear(); detections.clear();
  }
  function dispatch(action, input) {
    if (action === actions.CAPABILITY) return capability(input);
    if (action === actions.PREPARE) return prepare(input.pair, input);
    if (action === actions.EXECUTE) return execute(input);
    if (action === actions.CANCEL) return dispose();
    throw error("BROWSER_UNAVAILABLE");
  }
  app.modules.browserTranslation = { capability, prepare, prepareDetector, detectorCapability, detect, detectDecision, execute, ready, dispose, dispatch, error };
})();
