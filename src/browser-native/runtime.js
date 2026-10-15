// Shared by the isolated Content adapter and Options. No storage, HTTP or UI.
import { BROWSER_ENGINE, browserLanguage } from "../shared/browser-translation.js";
import { chooseDetectedLanguage, combineLanguageEvidence, scriptLanguage, detectionSample, translationParts } from "../shared/browser-language.js";

export function createBrowserNativeRuntime(environment = globalThis, limits = {}) {
  // Window timer methods require their Window receiver. Calling an unbound
  // method through this adapter throws Illegal invocation in real Chromium.
  const timers = { set: limits.setTimeout || globalThis.setTimeout.bind(globalThis),
    clear: limits.clearTimeout || globalThis.clearTimeout.bind(globalThis) };
  const now = limits.now || Date.now;
  const budget = { preparation: 180000, operation: 30000, capacity: 30000, drain: 1500,
    idle: Number(environment.navigator?.deviceMemory) < 4 ? 60000 : 120000, queue: 64, ...limits };
  const resources = new Map(), detections = new Map(), pending = [];
  let generation = 0, draining = false;
  const error = (code, cause) => Object.assign(new Error(code), { code, cause, i18nKey: `content.basic.${code}` });
  const safeDestroy = value => { try { value?.destroy?.(); } catch {} };
  const emit = (callback, value) => { try { callback?.(value); } catch {} };
  const safeNativeName = value => typeof value === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) && value !== "Error" ? value : "";
  const nativeErrorName = cause => safeNativeName(cause?.name);
  function normalizeError(cause) {
    const coded = typeof cause?.code === "string" && /^(?:BROWSER_[A-Z_]+|CANCELLED|CONFIG_[A-Z_]+)$/.test(cause.code);
    const name = coded ? safeNativeName(cause.nativeName) || nativeErrorName(cause.cause) : nativeErrorName(cause);
    const code = coded ? cause.code : { AbortError: "CANCELLED", NotAllowedError: "BROWSER_PREPARE", InvalidStateError: "BROWSER_PREPARE",
      SecurityError: "BROWSER_POLICY", NotSupportedError: "BROWSER_MODEL_UNAVAILABLE", QuotaExceededError: "BROWSER_TOO_LONG",
      NetworkError: "BROWSER_NETWORK", DataError: "BROWSER_RESULT" }[cause?.name] || "BROWSER_UNAVAILABLE";
    const normalized = error(code, cause);
    if (name) normalized.nativeName = name;
    if (["detector", "translator"].includes(cause?.model)) normalized.model = cause.model;
    return normalized;
  }
  function assertLive(signal, expected = generation) {
    if (signal?.aborted || expected !== generation) throw error("CANCELLED");
  }
  function deadline(promise, signal, timeout = 0, timeoutCode = "BROWSER_TIMEOUT") {
    return new Promise((resolve, reject) => {
      let done = false, timer;
      const finish = (fn, value) => { if (done) return; done = true; timers.clear(timer); signal?.removeEventListener("abort", abort); fn(value); };
      const abort = () => finish(reject, error("CANCELLED"));
      // Attach handlers even to already cancelled operations: consume late failures.
      Promise.resolve(promise).then(value => finish(resolve, value), cause => finish(reject, cause));
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (timeout > 0) timer = timers.set(() => finish(reject, error(timeoutCode)), timeout);
    });
  }
  const pairKey = pair => `translator:${pair.sourceLanguage}:${pair.targetLanguage}`;
  function validPair(pair) {
    const sourceLanguage = browserLanguage(pair?.sourceLanguage), targetLanguage = browserLanguage(pair?.targetLanguage);
    if (!sourceLanguage || !targetLanguage) throw error("BROWSER_LANGUAGE");
    return { sourceLanguage, targetLanguage };
  }
  function retire(entry) {
    if (entry.removed) return;
    entry.removed = true; timers.clear(entry.idleTimer);
    if (resources.get(entry.key) === entry) resources.delete(entry.key);
    entry.controller.abort(); safeDestroy(entry.instance); pump();
  }
  function release(entry, owner) {
    if (!entry.owners.delete(owner) || entry.removed || entry.owners.size) return;
    if (!entry.instance || entry.invalid) return retire(entry);
    entry.lastUsed = now(); timers.clear(entry.idleTimer);
    entry.idleTimer = timers.set(() => retire(entry), budget.idle); entry.idleTimer?.unref?.();
    pump();
  }
  function apiFor(kind) {
    if (kind === "detector") return environment.LanguageDetector;
    return environment.Translator;
  }
  function progress(entry, value) {
    if (entry.removed || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return;
    entry.loaded = Math.max(entry.loaded, value);
    for (const owner of entry.owners) if (!owner.signal?.aborted) emit(owner.progress, entry.loaded);
  }
  function findSlot(kind, key) {
    const existing = resources.get(key);
    if (existing && !existing.invalid && !existing.removed) return { entry: existing };
    if (existing?.owners.size) return null;
    if (existing) retire(existing);
    const peers = [...resources.values()].filter(entry => entry.kind === kind);
    if (peers.length < (kind === "detector" ? 1 : 2)) return {};
    const idle = peers.filter(entry => !entry.owners.size).sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (!idle) return null;
    // Retire in the guarded pump/acquire critical section before starting creation.
    retire(idle); return {};
  }
  function attach(kind, pair, options, slot) {
    let entry = slot.entry;
    const key = kind === "detector" ? "detector" : pairKey(pair);
    if (!entry) {
      const api = apiFor(kind);
      if (typeof api?.create !== "function") return Promise.reject(error("BROWSER_UNAVAILABLE"));
      entry = { key, kind, controller: new AbortController(), owners: new Set(), instance: null, promise: null,
        tail: Promise.resolve(), lastUsed: now(), loaded: 0, invalid: false, removed: false, verified: false, idleTimer: undefined };
      resources.set(key, entry);
    }
    timers.clear(entry.idleTimer);
    const owner = { signal: options.signal, progress: options.progress };
    entry.owners.add(owner);
    if (!entry.promise) {
      try {
        // No await before create(): preserve transient activation of the real click.
        const started = apiFor(kind).create({ ...(pair || {}), signal: entry.controller.signal,
          monitor: monitor => monitor.addEventListener("downloadprogress", event => progress(entry, event.loaded)) });
        entry.promise = Promise.resolve(started).then(instance => {
          if (entry.removed) { safeDestroy(instance); throw error("CANCELLED"); }
          entry.instance = instance; return instance;
        }, cause => { retire(entry); throw normalizeError(cause); });
      } catch (cause) { retire(entry); entry.promise = Promise.reject(normalizeError(cause)); }
    } else if (entry.loaded) emit(options.progress, entry.loaded);
    const owned = entry;
    return deadline(owned.promise, options.signal, budget.preparation).then(instance => ({ entry: owned, instance,
      release: () => release(owned, owner) }), cause => { release(owned, owner); throw normalizeError(cause); });
  }
  function pump() {
    if (draining) return;
    draining = true;
    try {
      // FIFO for capacity contention; same-key requests can still share a creation.
      for (let i = 0; i < pending.length;) {
        const request = pending[i];
        if (request.options.signal?.aborted || request.generation !== generation) { request.remove(); request.reject(error("CANCELLED")); continue; }
        const slot = findSlot(request.kind, request.key);
        if (!slot) { i++; continue; }
        request.remove();
        attach(request.kind, request.pair, request.options, slot).then(request.resolve, request.reject);
      }
    } finally { draining = false; }
  }
  function acquire(kind, pair, options = {}) {
    try { assertLive(options.signal); } catch (cause) { return Promise.reject(cause); }
    const key = kind === "detector" ? "detector" : pairKey(pair);
    // Guard re-entrant eviction notification so a slot cannot be allocated twice.
    const outer = draining; draining = true;
    let slot;
    try { slot = findSlot(kind, key); if (slot) return attach(kind, pair, options, slot); }
    finally { draining = outer; }
    if (pending.length >= budget.queue) return Promise.reject(error("BROWSER_BUSY"));
    emit(options.onPhase, "waiting");
    return new Promise((resolve, reject) => {
      let timer;
      const request = { key, kind, pair, options, generation, resolve, reject, remove() {
        const index = pending.indexOf(request); if (index >= 0) pending.splice(index, 1);
        timers.clear(timer); options.signal?.removeEventListener("abort", abort);
      } };
      const abort = () => { request.remove(); reject(error("CANCELLED")); pump(); };
      pending.push(request); options.signal?.addEventListener("abort", abort, { once: true });
      timer = timers.set(() => { request.remove(); reject(error("BROWSER_QUEUE_TIMEOUT")); pump(); }, budget.capacity);
      if (options.signal?.aborted) abort();
    });
  }
  async function perform(lease, operation, options = {}) {
    const { entry, instance } = lease, expected = generation, previous = entry.tail;
    let unlock, drainTimer, active = false;
    const slot = new Promise(resolve => { unlock = resolve; });
    entry.tail = previous.catch(() => {}).then(() => slot);
    const abort = () => { if (active) drainTimer = timers.set(() => retire(entry), budget.drain); };
    try {
      await deadline(deadline(previous, entry.controller.signal), options.signal, budget.operation);
      assertLive(options.signal, expected);
      if (entry.removed || entry.invalid) throw error("BROWSER_PREPARE");
      active = true; options.signal?.addEventListener("abort", abort, { once: true });
      // Inference belongs to the lease, not to one caller's AbortController.
      const result = await deadline(operation(instance, entry.controller.signal), entry.controller.signal, budget.operation);
      assertLive(options.signal, expected); return result;
    } catch (cause) {
      if (!options.signal?.aborted && !["QuotaExceededError"].includes(cause?.name) && !["BROWSER_TOO_LONG", "CANCELLED"].includes(cause?.code)) entry.invalid = true;
      if (cause?.code === "BROWSER_TIMEOUT") retire(entry);
      throw normalizeError(cause);
    } finally {
      active = false; timers.clear(drainTimer); options.signal?.removeEventListener("abort", abort);
      unlock(); if (!options.keepLease) lease.release();
    }
  }
  function use(kind, pair, operation, options = {}) {
    const job = acquire(kind, pair, options).then(lease => perform(lease, operation, options));
    return deadline(job, options.signal);
  }
  async function availability(kind, pair) {
    if (environment.isSecureContext === false) return "insecure";
    const api = apiFor(kind);
    if (typeof api?.create !== "function") return "unsupported";
    const policy = environment.document?.permissionsPolicy || environment.document?.featurePolicy;
    const feature = kind === "detector" ? "language-detector" : "translator";
    if (policy?.features?.().includes(feature) && !policy.allowsFeature(feature)) return "policy-denied";
    if (typeof api.availability !== "function") return "unknown";
    try {
      const value = await deadline(api.availability(pair), undefined, budget.operation);
      return ["available", "downloadable", "downloading", "unavailable"].includes(value) ? value : "unknown";
    } catch (cause) {
      if (cause?.name === "SecurityError") return "policy-denied";
      return "unknown"; // A probe failure is not proof that create() cannot work.
    }
  }
  const capability = pair => availability("translator", validPair(pair));
  const detectorCapability = () => resources.get("detector")?.instance && !resources.get("detector").invalid ? Promise.resolve("available") : availability("detector");
  async function infer(instance, text, signal) {
    let result;
    if (typeof instance.translate === "function") result = await instance.translate(text, { signal });
    else if (typeof instance.translateStreaming === "function") {
      const stream = instance.translateStreaming(text, { signal }), iterator = stream[Symbol.asyncIterator]();
      const stop = () => { try { Promise.resolve(iterator.return?.()).catch(() => {}); } catch {} };
      signal.addEventListener("abort", stop, { once: true });
      result = "";
      try {
        while (true) {
          const step = await deadline(iterator.next(), signal, budget.operation);
          if (step.done) break;
          if (typeof step.value !== "string" || result.length + step.value.length > 64000) throw error("BROWSER_RESULT");
          result += step.value;
        }
      } finally { signal.removeEventListener("abort", stop); stop(); }
    } else throw error("BROWSER_RESULT");
    if (typeof result !== "string" || !result.trim()) throw error("BROWSER_RESULT");
    return result;
  }
  function prepare(pairInput, options = {}) {
    let pair;
    try { pair = validPair(pairInput); } catch (cause) { return Promise.reject(cause); }
    if (pair.sourceLanguage === pair.targetLanguage) return Promise.resolve({ engine: BROWSER_ENGINE, ...pair, state: "ready", identity: true });
    const job = acquire("translator", pair, options).then(lease => {
      const sample = typeof options.verifyText === "string" ? options.verifyText.trim().slice(0, 160) : "";
      if (!sample || lease.entry.verified) { lease.release(); return { engine: BROWSER_ENGINE, ...pair, state: "ready", verified: lease.entry.verified }; }
      emit(options.onPhase, "verifying");
      return perform(lease, async (instance, signal) => {
        try { await infer(instance, sample, signal); } catch (cause) { if (cause.code === "BROWSER_RESULT") throw error("BROWSER_VERIFY_FAILED", cause); throw cause; }
        lease.entry.verified = true;
        return { engine: BROWSER_ENGINE, ...pair, state: "ready", verified: true };
      }, options);
    });
    return deadline(job, options.signal);
  }
  const prepareDetector = (options = {}) => acquire("detector", null, options).then(lease => { lease.release(); });
  async function detectDecision(text, { signal, protectedIds = [], cacheOnly = false } = {}) {
    const expected = generation, sample = detectionSample(text, protectedIds);
    assertLive(signal, expected);
    if (!/\p{L}/u.test(sample)) return { language: "", source: "empty", scriptKnown: true };
    if (detections.has(sample)) return detections.get(sample);
    const state = await deadline(detectorCapability(), signal);
    assertLive(signal, expected);
    if (state === "available" && (!cacheOnly || resources.get("detector")?.instance)) {
      try {
        const results = await use("detector", null, (instance, nativeSignal) => instance.detect(sample, { signal: nativeSignal }), { signal });
        assertLive(signal, expected);
        const decision = chooseDetectedLanguage(results, sample);
        if (decision.language) { detections.set(sample, decision); if (detections.size > 256) detections.delete(detections.keys().next().value); return decision; }
      } catch (cause) { assertLive(signal, expected); if (["CANCELLED", "BROWSER_TIMEOUT"].includes(cause.code)) throw cause; }
    }
    const language = scriptLanguage(sample);
    return { language, source: language ? "script" : "unknown", scriptKnown: Boolean(language),
      reason: ["downloadable", "downloading", "unknown"].includes(state) ? "prepare-detector" : "uncertain" };
  }
  async function detectSelection(text, context = "", options = {}) {
    const selected = await detectDecision(text, options);
    if (!context || context === text || selected.source === "empty") return selected;
    const nearby = await detectDecision(context, options);
    return combineLanguageEvidence(text, selected, nearby);
  }
  async function execute({ pair: pairInput, segments, signal }) {
    const pair = validPair(pairInput), expected = generation;
    assertLive(signal, expected);
    if (!Array.isArray(segments) || segments.length > 18) throw error("BROWSER_RESULT");
    const seen = new Set();
    const prepared = segments.map(segment => {
      if (!segment || !["string", "number"].includes(typeof segment.id) || seen.has(String(segment.id)) || typeof segment.text !== "string") throw error("BROWSER_RESULT");
      seen.add(String(segment.id));
      return { id: segment.id, parts: translationParts(segment.text, segment.protectedIds || []) };
    });
    if (pair.sourceLanguage === pair.targetLanguage) return { engine: BROWSER_ENGINE, ...pair, translations: segments.map(({ id, text }) => ({ id, text })) };
    if (!ready(pair)) throw error("BROWSER_PREPARE");
    return use("translator", pair, async (instance, nativeSignal) => {
      const translations = [];
      for (const segment of prepared) {
        let text = "";
        for (const part of segment.parts) {
          assertLive(signal, expected);
          if (part.protected || !part.text.trim()) { text += part.text; continue; }
          const result = await infer(instance, part.text.trim(), nativeSignal);
          assertLive(signal, expected);
          text += part.text.match(/^\s*/)[0] + result + part.text.match(/\s*$/)[0];
        }
        translations.push({ id: segment.id, text });
      }
      return { translations, engine: BROWSER_ENGINE, ...pair };
    }, { signal });
  }
  function prepareBundle(pairInput, sampleText, options = {}) {
    let pair;
    try { pair = validPair(pairInput); assertLive(options.signal); if (pair.sourceLanguage === pair.targetLanguage || typeof sampleText !== "string" || !sampleText.trim()) throw error("BROWSER_LANGUAGE"); }
    catch (cause) { return Promise.reject(cause); }
    const controller = new AbortController(), expected = generation;
    const relay = () => controller.abort();
    options.signal?.addEventListener("abort", relay, { once: true });
    const update = (model, phase, loaded, details = {}) => emit(options.onStatus, { model, phase, ...(loaded === undefined ? {} : { loaded }), ...details });
    const reportModelFailure = (model, cause) => {
      const normalized = normalizeError(cause);
      const phase = normalized.code === "CANCELLED" ? "cancelled" : "failed";
      update(model, phase, undefined, { errorCode: normalized.code, ...(normalized.nativeName ? { nativeName: normalized.nativeName } : {}) });
      return Object.assign(error(normalized.code, cause), { model, ...(normalized.nativeName ? { nativeName: normalized.nativeName } : {}) });
    };
    // Both creates start in the same click stack, before any promise is awaited.
    const detectorJob = acquire("detector", null, { signal: controller.signal, progress: loaded => update("detector", "downloading", loaded),
      onPhase: phase => update("detector", phase) });
    const translatorJob = acquire("translator", pair, { signal: controller.signal, progress: loaded => update("translator", "downloading", loaded),
      onPhase: phase => update("translator", phase) });
    let cleaned = false; const leases = [];
    const own = (model, job) => job.then(lease => { if (cleaned) lease.release(); else leases.push(lease); return lease; }, cause => {
      throw reportModelFailure(model, cause);
    });
    const first = own("detector", detectorJob), second = own("translator", translatorJob);
    const job = Promise.all([first, second]).then(async ([detector, translator]) => {
      assertLive(options.signal, expected);
      update("detector", "verifying"); update("translator", "verifying");
      const [decision, translatedText] = await Promise.all([
        perform(detector, async (instance, signal) => chooseDetectedLanguage(await instance.detect(sampleText, { signal }), sampleText), { signal: controller.signal, keepLease: true })
          .catch(cause => { throw reportModelFailure("detector", cause); }),
        perform(translator, (instance, signal) => infer(instance, sampleText, signal), { signal: controller.signal, keepLease: true })
          .catch(cause => { throw reportModelFailure("translator", cause); })
      ]);
      assertLive(options.signal, expected);
      if (decision.language !== pair.sourceLanguage) throw reportModelFailure("detector", error("BROWSER_DETECTION_MISMATCH"));
      translator.entry.verified = true; detector.entry.verified = true;
      update("detector", "ready"); update("translator", "ready");
      return { ...pair, detectedLanguage: decision.language, translatedText, verified: true };
    }).catch(cause => {
      controller.abort(); for (const lease of leases) lease.entry.invalid = true;
      throw normalizeError(cause);
    }).finally(() => {
      cleaned = true; options.signal?.removeEventListener("abort", relay);
      for (const lease of leases) { if (lease.entry.invalid && !lease.entry.owners.size) retire(lease.entry); else lease.release(); }
    });
    return deadline(job, options.signal);
  }
  function ready(pair) { const entry = resources.get(pairKey(pair)); return Boolean(entry?.instance && !entry.invalid && !entry.removed); }
  function dispose() {
    generation++;
    const outer = draining; draining = true;
    try {
      for (const request of [...pending]) { request.remove(); request.reject(error("CANCELLED")); }
      for (const entry of resources.values()) retire(entry);
      resources.clear(); detections.clear();
    } finally { draining = outer; }
  }
  return { capability, prepare, prepareDetector, prepareBundle, detectorCapability, detectDecision, detectSelection,
    detect: async (text, _hint = "", options = {}) => (await detectDecision(text, options)).language,
    execute, ready, dispose, error, normalizeError,
    status: () => ({ detectors: [...resources.values()].filter(entry => entry.kind === "detector").length,
      translators: [...resources.values()].filter(entry => entry.kind === "translator").length, waiting: pending.length }) };
}
