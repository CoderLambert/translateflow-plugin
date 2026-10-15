(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.browserTranslation || app.modules.browserTranslationView) return;
  const { LANGUAGE_NAMES, detectionSample } = app.modules.browserTranslationContract;
  const engine = app.modules.browserTranslation;
  const t = (key, args) => app.modules.contentI18n.t(`content.basic.${key}`, args);
  const { button, surface } = app.modules.uiPrimitives;
  let closeActive = null;
  function languageName(code) {
    try {
      const locale = app.modules.contentI18n.get?.().locale?.replace("_", "-") || "zh-CN";
      return new Intl.DisplayNames([locale], { type: "language" }).of(code === "zh" ? "zh-Hans" : code);
    } catch { return LANGUAGE_NAMES[code] || code; }
  }
  function prompt({ signal, title, message = "", pair = null, detectText = "", verifyText = "", allowPrepare = false, action = null }) {
    closeActive?.();
    return new Promise((resolve, reject) => {
      const lifetime = new AbortController();
      const previous = app.modules.uiHost.getShadowRoot().activeElement || document.activeElement;
      const panel = surface({ role: "dialog" });
      panel.dataset.basicTranslation = "prompt";
      panel.setAttribute("aria-label", t(title)); panel.setAttribute("aria-modal", "false");
      panel.style.cssText = "position:fixed;right:16px;bottom:24px;width:min(380px,calc(100vw - 32px));max-height:80vh;overflow:auto;padding:20px;display:grid;gap:12px;pointer-events:auto;background:var(--tf-bg-card);font-family:var(--tf-font-family);line-height:1.5";
      const heading = document.createElement("strong"); heading.textContent = t(title);
      const status = document.createElement("p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.textContent = message || t("help");
      const progress = document.createElement("progress"); progress.max = 1; progress.hidden = true; progress.setAttribute("aria-label", t("preparing"));
      const options = button({ text: t("configure") });
      options.onclick = () => { void app.modules.runtime.sendRuntimeMessage({ type: app.modules.runtime.messages.background.OPEN_OPTIONS, hash: "#general" }); };
      const cancel = button({ text: t("cancel") });
      let settled = false, busy = false, revision = 0, lastLoaded = 0, primary = null;
      const live = current => !settled && !lifetime.signal.aborted && current === revision;
      const finish = (value, failure = null) => {
        if (settled) return; settled = true; revision++;
        signal?.removeEventListener("abort", abort); window.removeEventListener("keydown", keydown, true);
        lifetime.abort(); panel.remove(); if (closeActive === abort) closeActive = null;
        if (previous?.isConnected) previous.focus?.({ preventScroll: true });
        if (failure) reject(failure); else resolve(value);
      };
      const abort = () => finish(null, engine.error("CANCELLED"));
      const keydown = event => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); abort(); } };
      cancel.onclick = abort;
      signal?.addEventListener("abort", abort, { once: true });
      window.addEventListener("keydown", keydown, true); closeActive = abort;
      panel.append(heading, status);
      const updateProgress = loaded => {
        if (settled || typeof loaded !== "number" || !Number.isFinite(loaded) || loaded < 0 || loaded > 1) return;
        lastLoaded = Math.max(lastLoaded, loaded); progress.hidden = false; progress.value = lastLoaded;
      };
      if (pair) {
        const summary = document.createElement("p");
        summary.textContent = `${pair.sourceLanguage ? languageName(pair.sourceLanguage) : t("automatic")} → ${languageName(pair.targetLanguage)}`;
        panel.append(summary);
        if (detectText) {
          const sample = document.createElement("p"); sample.className = "hint";
          sample.textContent = detectionSample(detectText).slice(0, 180); panel.append(sample);
        }
        const details = document.createElement("details"), label = document.createElement("label"), detailTitle = document.createElement("summary");
        detailTitle.textContent = t(pair.sourceLanguage ? "changeSource" : "manualSource"); details.append(detailTitle);
        label.textContent = t("source"); label.style.cssText = "display:grid;gap:6px";
        const select = document.createElement("select"); select.className = "tf-ui-select"; select.style.maxWidth = "100%"; select.setAttribute("aria-label", t("source"));
        const empty = document.createElement("option"); empty.value = ""; empty.textContent = t("chooseSource"); select.append(empty);
        for (const code of Object.keys(LANGUAGE_NAMES)) { const option = document.createElement("option"); option.value = code; option.textContent = languageName(code); select.append(option); }
        select.value = pair.sourceLanguage || ""; label.append(select); details.append(label); panel.append(details);
        const canDetect = Boolean(detectText && typeof globalThis.LanguageDetector?.create === "function");
        primary = button({ text: t(allowPrepare ? "prepareContinue" : !select.value && canDetect ? "detectContinue" : "continue") });
        const refresh = () => {
          primary.disabled = busy || (!select.value && !canDetect);
          primary.textContent = t(busy ? "preparing" : allowPrepare ? "prepareContinue" : !select.value && canDetect ? "detectContinue" : "continue");
        };
        select.onchange = refresh;
        if (!select.value && !canDetect) details.open = true;
        primary.onclick = async event => {
          if (!event.isTrusted || busy || settled) return;
          const current = ++revision; busy = true; select.disabled = true; refresh();
          status.textContent = t("preparing"); progress.hidden = false; progress.removeAttribute("value"); lastLoaded = 0;
          try {
            if (!select.value) {
              // The model creation begins in this click, not after a storage or messaging await.
              await engine.prepareDetector({ signal: lifetime.signal, progress: updateProgress });
              if (!live(current)) return;
              status.textContent = t("detecting");
              const decision = await engine.detectDecision(detectText, { signal: lifetime.signal });
              if (!live(current)) return;
              if (!decision.language || decision.language === "zh" && !decision.scriptKnown && pair.targetLanguage === "zh") {
                status.textContent = t("uncertain"); details.open = true; return;
              }
              finish({ ...pair, sourceLanguage: decision.language, automatic: true, decision }); return;
            }
            const selected = { ...pair, sourceLanguage: select.value, automatic: false };
            if (allowPrepare && selected.sourceLanguage !== selected.targetLanguage) await engine.prepare(selected, {
              signal: lifetime.signal, progress: updateProgress,
              verifyText: verifyText || detectionSample(detectText).slice(0, 160),
              onPhase: phase => { if (live(current) && phase === "verifying") status.textContent = t("verifying"); }
            });
            if (live(current)) finish(selected);
          } catch (cause) {
            if (!live(current)) return;
            if (cause?.code === "CANCELLED") return abort();
            status.textContent = t(["BROWSER_TIMEOUT", "BROWSER_BUSY", "BROWSER_TOO_LONG", "BROWSER_VERIFY_FAILED"].includes(cause?.code) ? cause.code : "prepareFailed");
          } finally {
            if (live(current)) { busy = false; select.disabled = false; progress.hidden = true; refresh(); }
          }
        };
        panel.append(primary); refresh();
      }
      if (action) {
        primary = button({ text: t(action.label) });
        primary.onclick = event => { if (event.isTrusted) finish(true); }; panel.append(primary);
      }
      panel.append(progress, options, cancel); app.modules.uiHost.getLayer("basic-translation").append(panel);
      if (signal?.aborted) abort(); else (primary?.disabled ? cancel : primary || cancel).focus({ preventScroll: true });
    });
  }
  app.modules.browserTranslationView = { prompt, close: () => closeActive?.() };
})();
