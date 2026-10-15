(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.browserTranslation || app.modules.browserTranslationView) return;
  const { LANGUAGE_NAMES } = app.modules.browserTranslationContract;
  const engine = app.modules.browserTranslation;
  const t = (key, args) => app.modules.contentI18n.t(`content.basic.${key}`, args);
  const { button, surface } = app.modules.uiPrimitives;
  let closeActive = null;
  function prompt({ signal, title, message = "", pair = null, detectText = "", allowPrepare = false, action = null }) {
    closeActive?.();
    return new Promise((resolve, reject) => {
      const lifetime = new AbortController();
      const previous = app.modules.uiHost.getShadowRoot().activeElement || document.activeElement;
      const panel = surface({ role: "dialog" });
      panel.dataset.basicTranslation = "prompt";
      panel.setAttribute("aria-label", t(title)); panel.setAttribute("aria-modal", "false");
      panel.style.cssText = "position:fixed;right:16px;bottom:24px;width:min(380px,calc(100vw - 32px));max-height:80vh;overflow:auto;padding:20px;display:grid;gap:12px;pointer-events:auto;background:var(--tf-bg-card);font-family:var(--tf-font-family);line-height:1.5";
      const heading = document.createElement("strong"); heading.textContent = t(title);
      const status = document.createElement("p"); status.setAttribute("role", "status"); status.textContent = message || t("help");
      const progress = document.createElement("progress"); progress.max = 1; progress.value = 0; progress.hidden = true;
      progress.setAttribute("aria-label", t("preparing"));
      const options = button({ text: t("configure") });
      options.onclick = () => { void app.modules.runtime.sendRuntimeMessage({ type: app.modules.runtime.messages.background.OPEN_OPTIONS, hash: "#general" }); };
      const cancel = button({ text: t("cancel") });
      let settled = false;
      const finish = (value, failure = null) => {
        if (settled) return; settled = true;
        signal?.removeEventListener("abort", abort); window.removeEventListener("keydown", keydown, true);
        if (failure) lifetime.abort();
        panel.remove(); if (closeActive === abort) closeActive = null;
        if (previous?.isConnected) previous.focus?.({ preventScroll: true });
        if (failure) reject(failure); else resolve(value);
      };
      const abort = () => finish(null, engine.error("CANCELLED"));
      const keydown = event => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); abort(); } };
      cancel.onclick = abort;
      signal?.addEventListener("abort", abort, { once: true });
      window.addEventListener("keydown", keydown, true); closeActive = abort;
      panel.append(heading, status);
      const updateProgress = loaded => { progress.hidden = false; progress.value = Math.max(0, Math.min(1, Number(loaded) || 0)); };
      if (pair) {
        const label = document.createElement("label"); label.textContent = t("source"); label.style.cssText = "display:grid;gap:6px";
        const select = document.createElement("select"); select.className = "tf-ui-select"; select.style.maxWidth = "100%"; select.setAttribute("aria-label", t("source"));
        const empty = document.createElement("option"); empty.value = ""; empty.textContent = t("chooseSource"); select.append(empty);
        for (const [code, name] of Object.entries(LANGUAGE_NAMES)) { const option = document.createElement("option"); option.value = code; option.textContent = name; select.append(option); }
        select.value = pair.sourceLanguage || ""; label.append(select); panel.append(label);
        const target = document.createElement("p"); target.textContent = `${t("target")}: ${LANGUAGE_NAMES[pair.targetLanguage] || pair.targetLanguage}`; panel.append(target);
        const prepare = button({ text: t("prepare") });
        const start = async event => {
          if (!event.isTrusted || !select.value) return;
          const selected = { ...pair, sourceLanguage: select.value };
          if (!allowPrepare) { finish(selected); return; }
          prepare.disabled = true; select.disabled = true; status.textContent = t("preparing");
          // create() is invoked immediately inside this trusted click handler.
          try { await engine.prepare(selected, { signal: lifetime.signal, progress: updateProgress }); finish(selected); }
          catch (error) { if (signal?.aborted || error.code === "CANCELLED") return abort(); status.textContent = t("prepareFailed"); prepare.disabled = false; select.disabled = false; prepare.textContent = t("retry"); }
        };
        prepare.addEventListener("click", start);
        if (!allowPrepare) prepare.textContent = t("continue");
        panel.append(prepare);
        if (detectText && globalThis.LanguageDetector) {
          const detect = button({ text: t("detect") });
          detect.onclick = async event => {
            if (!event.isTrusted) return;
            detect.disabled = true;
            try {
              await engine.prepareDetector({ signal: lifetime.signal, progress: updateProgress });
              select.value = await engine.detect(detectText);
              status.textContent = t(select.value ? "correctSource" : "chooseSource");
            } catch { status.textContent = t("detectFailed"); }
            finally { detect.disabled = false; }
          };
          panel.append(detect);
        }
      }
      if (action) {
        const primary = button({ text: t(action.label) });
        primary.onclick = event => { if (event.isTrusted) finish(true); };
        panel.append(primary);
      }
      panel.append(progress, options, cancel); app.modules.uiHost.getLayer("basic-translation").append(panel);
      if (signal?.aborted) abort(); else cancel.focus({ preventScroll: true });
    });
  }
  app.modules.browserTranslationView = { prompt, close: () => closeActive?.() };
})();
