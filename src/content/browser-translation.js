(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.browserTranslationContract || app.modules.browserTranslation) return;
  const { browserLanguage, languageHintMatchesText, BROWSER_TRANSLATION_ACTIONS: actions } = app.modules.browserTranslationContract;
  const instances = new Map();
  let generation = 0;
  let detector = null;
  const error = code => Object.assign(new Error(code), { code, i18nKey: `content.basic.${code}` });
  const key = pair => `${pair.sourceLanguage}:${pair.targetLanguage}`;
  function assertLive(signal, expected) {
    if (signal?.aborted || expected !== generation) throw error("CANCELLED");
  }
  async function capability(pair) {
    if (!globalThis.isSecureContext) return "insecure";
    if (typeof globalThis.Translator?.availability !== "function") return "unsupported";
    const policy = globalThis.document?.permissionsPolicy || globalThis.document?.featurePolicy;
    if (policy?.features?.().includes("translator") && !policy.allowsFeature("translator")) return "policy-denied";
    try { return await globalThis.Translator.availability(pair); }
    catch { return "unavailable"; }
  }
  // This function calls create synchronously so its caller can preserve a real
  // click's transient activation. No background or MAIN-world bridge is used.
  function prepare(pair, { signal, progress = () => {} } = {}) {
    const expected = generation;
    if (signal?.aborted) return Promise.reject(error("CANCELLED"));
    const promise = globalThis.Translator.create({ ...pair, signal,
      monitor(monitor) { monitor.addEventListener("downloadprogress", event => progress(event.loaded)); }
    });
    return promise.then(instance => {
      if (signal?.aborted || expected !== generation) { instance.destroy(); throw error("CANCELLED"); }
      const previous = instances.get(key(pair));
      previous?.destroy(); instances.set(key(pair), instance);
      return { engine: "browser-translator", ...pair, state: "ready" };
    });
  }
  async function detect(text, hint = "") {
    const expected = generation;
    try {
    // Detect only with an already available model. Downloads need a view click.
    if (detector || (globalThis.LanguageDetector && await globalThis.LanguageDetector.availability() === "available")) {
      assertLive(null, expected);
      const candidate = detector || await globalThis.LanguageDetector.create();
      if (expected !== generation) { candidate.destroy(); throw error("CANCELLED"); }
      detector = candidate;
      const results = await detector.detect(String(text).replace(/⟦TF:[^⟧]*⟧/g, "").slice(0, 4000));
      assertLive(null, expected);
      const best = results[0];
      if (best?.confidence >= (String(text).trim().length < 12 ? 0.8 : 0.65)) return browserLanguage(best.detectedLanguage);
    }
    } catch { assertLive(null, expected); }
    assertLive(null, expected);
    return languageHintMatchesText(text, hint) ? browserLanguage(hint) : "";
  }
  function prepareDetector({ signal, progress = () => {} }) {
    const expected = generation;
    return globalThis.LanguageDetector.create({ signal, monitor(m) {
      m.addEventListener("downloadprogress", event => progress(event.loaded));
    } }).then(instance => {
      if (expected !== generation || signal.aborted) { instance.destroy(); throw error("CANCELLED"); }
      detector?.destroy(); detector = instance;
    });
  }
  async function execute({ pair, segments, signal }) {
    const expected = generation;
    const instance = instances.get(key(pair));
    if (!instance) throw error("BROWSER_PREPARE");
    const translations = [];
    for (const segment of segments) {
      assertLive(signal, expected);
      // Keep all internal markers out of the language model. code/kbd spans
      // are passed as protected ranges by the DOM owner and copied verbatim.
      const protectedIds = new Set(segment.protectedIds || []);
      const parts = String(segment.text).split(/(⟦TF:\d+:[SE]⟧)/g);
      const stack = [];
      let translated = "";
      for (const part of parts) {
        const marker = part.match(/^⟦TF:(\d+):([SE])⟧$/);
        if (marker) {
          if (marker[2] === "S") stack.push(Number(marker[1])); else stack.pop();
          translated += part; continue;
        }
        if (!part.trim() || stack.some(id => protectedIds.has(id)) || pair.sourceLanguage === pair.targetLanguage) translated += part;
        else {
          const leading = part.match(/^\s*/)[0], trailing = part.match(/\s*$/)[0];
          translated += leading + await instance.translate(part.trim(), { signal }) + trailing;
        }
        assertLive(signal, expected);
      }
      translations.push({ id: segment.id, text: translated });
    }
    return { translations, engine: "browser-translator", ...pair };
  }
  function dispose() {
    generation++;
    for (const instance of instances.values()) { try { instance.destroy(); } catch {} }
    instances.clear(); try { detector?.destroy(); } catch {} detector = null;
  }
  const ready = pair => instances.has(key(pair));
  function dispatch(action, input) {
    if (action === actions.CAPABILITY) return capability(input);
    if (action === actions.PREPARE) return prepare(input.pair, input);
    if (action === actions.EXECUTE) return execute(input);
    if (action === actions.CANCEL) return dispose();
    throw error("BROWSER_UNAVAILABLE");
  }
  app.modules.browserTranslation = { capability, prepare, prepareDetector, detect, execute, ready, dispose, dispatch, error };
})();
