(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiTokens || !app?.modules.uiPrimitives || !app?.modules.contentI18n || app.modules.subtitleRenderer) return;

  const { select: createSelect } = app.modules.uiPrimitives;
  const locale = app.modules.contentI18n;
  const t = (key, args) => locale.t(key, args);
  const MODES = Object.freeze(["bilingual", "original", "off"]);
  const SIZES = Object.freeze(["small", "standard", "large"]);
  const SIZE_PX = Object.freeze({ small: 15, standard: 18, large: 22 });

  function createSubtitleRenderer({ document: doc = document, onModeChange, onSizeChange, onPresetChange } = {}) {
    let player, host, shadow, originalEl, translatedEl, statusEl, modeSelect, sizeSelect, presetSelect;
    let mode = "bilingual";
    let size = "standard";
    let presetValue = "inherit";
    let presetOptions = [];
    let entry = null, controls = null, controlsObserver = null;
    let panelOpen = false;

    function mount(nextPlayer) {
      if (!nextPlayer) return false;
      if (player === nextPlayer && host?.isConnected) { bindEntry(); return true; }
      unmount();
      player = nextPlayer;
      host = doc.createElement("div");
      host.setAttribute("data-tf-extension-ui", "youtube-subtitles");
      host.style.cssText = "position:absolute;inset:0;z-index:2147483000;pointer-events:none;";
      shadow = host.attachShadow({ mode: "open" });
      const style = doc.createElement("style");
      style.textContent = `:host{all:initial}
${app.modules.uiTokens.css}
.wrap{position:absolute;left:8%;right:8%;bottom:11%;display:flex;flex-direction:column;align-items:center;gap:var(--tf-space-1);pointer-events:none;text-align:center;font-family:var(--tf-font-family)}
.line{max-width:92%;padding:2px var(--tf-space-2);border-radius:var(--tf-radius-sm);background:rgba(0,0,0,.72);color:#fff;text-shadow:0 1px 2px #000;line-height:1.35;white-space:pre-wrap}
.original{font-size:16px}.translated{font-size:var(--tf-subtitle-size,18px);font-weight:500}.status{font-size:var(--tf-font-size-xs);opacity:.86}
.controls{position:absolute;right:var(--tf-space-3);bottom:58px;width:300px;max-width:calc(100% - 24px);padding:var(--tf-space-3);background:rgba(28,28,28,.97);border:1px solid rgba(255,255,255,.16);border-radius:var(--tf-radius-sm);box-shadow:var(--tf-shadow-lg);color:#fff;font-family:var(--tf-font-family);pointer-events:auto}
.controls-brand{display:block;font-size:var(--tf-font-size-sm);font-weight:600;padding-bottom:var(--tf-space-2);border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:var(--tf-space-2)}
.setting-row{display:flex;align-items:center;justify-content:space-between;gap:var(--tf-space-2);margin-top:var(--tf-space-2);font-size:var(--tf-font-size-xs)}
.controls .tf-ui-select{min-height:30px;width:170px;max-width:65%;padding:4px 24px 4px 7px;border-radius:6px;background:#353535;border:1px solid #555;color:#fff;box-shadow:none;font-size:var(--tf-font-size-xs)}
.controls option{background:#353535;color:#fff}
.hidden{display:none!important}`;
      const wrap = doc.createElement("div"); wrap.className = "wrap";
      originalEl = doc.createElement("div"); originalEl.className = "line original";
      translatedEl = doc.createElement("div"); translatedEl.className = "line translated";
      statusEl = doc.createElement("div"); statusEl.className = "line status hidden";
      wrap.append(originalEl, translatedEl, statusEl);

      controls = doc.createElement("div"); controls.className = "controls"; controls.hidden = true;
      controls.setAttribute("role", "dialog"); locale.bindAttribute(controls, "aria-label", "content.subtitle.openSettings");
      const brand = doc.createElement("span"); brand.className = "controls-brand"; brand.textContent = "TranslateFlow";
      modeSelect = createSelect({
        label: t("content.subtitle.modeAria"),
        value: mode,
        options: [["bilingual", "content.subtitle.bilingual"], ["original", "content.subtitle.original"], ["off", "content.subtitle.off"]]
          .map(([value, key]) => ({ value, label: t(key) })),
        className: "tf-subtitle-mode"
      });
      presetSelect = createSelect({
        label: t("content.subtitle.presetAria"),
        value: presetValue,
        options: buildPresetOptions(),
        className: "tf-subtitle-preset"
      });
      sizeSelect = createSelect({
        label: t("content.subtitle.sizeAria"),
        value: size,
        options: [["small", "content.subtitle.small"], ["standard", "content.subtitle.standard"], ["large", "content.subtitle.large"]]
          .map(([value, key]) => ({ value, label: t(key) })),
        className: "tf-subtitle-size"
      });
      modeSelect.addEventListener("change", () => { setMode(modeSelect.value); onModeChange?.(mode); });
      presetSelect.addEventListener("change", () => { presetValue = presetSelect.value; onPresetChange?.(presetValue); });
      sizeSelect.addEventListener("change", () => { setSize(sizeSelect.value); onSizeChange?.(size); });
      controls.append(brand);
      for (const [select, key] of [[modeSelect, "content.subtitle.modeLabel"], [presetSelect, "content.subtitle.presetAria"], [sizeSelect, "content.subtitle.sizeLabel"]]) {
        const row = doc.createElement("label"); row.className = "setting-row";
        const label = doc.createElement("span"); locale.bindText(label, key); row.append(label, select); controls.appendChild(row);
      }
      rebuildPresetSelect();
      shadow.append(style, wrap, controls);
      player.appendChild(host);
      entry = doc.createElement("button"); entry.type = "button"; entry.className = "ytp-button";
      entry.setAttribute("data-tf-subtitle-button", "true"); entry.setAttribute("data-tf-extension-ui", "youtube-subtitle-button");
      entry.setAttribute("aria-haspopup", "dialog"); entry.setAttribute("aria-expanded", "false");
      entry.textContent = "译";
      entry.style.cssText = "color:white;font:600 18px/1 sans-serif;width:48px;height:100%;min-height:32px;cursor:pointer;background:transparent;border:0;padding:0;pointer-events:auto;";
      locale.bindAttribute(entry, "aria-label", "content.subtitle.openSettings"); locale.bindAttribute(entry, "title", "content.subtitle.openSettings");
      entry.addEventListener("click", () => setPanelOpen(!panelOpen));
      bindEntry();
      const Observer = doc.defaultView?.MutationObserver;
      if (Observer) { controlsObserver = new Observer(bindEntry); controlsObserver.observe(player, { childList: true, subtree: true }); }
      doc.addEventListener("click", onOutsideClick, true); doc.addEventListener("keydown", onKeydown, true);
      doc.addEventListener("fullscreenchange", closePanel);
      bindControls();
      applyState();
      return true;
    }

    function bindEntry() {
      if (!entry || !player || !shadow) return;
      const bar = player.querySelector(".ytp-right-controls");
      const settings = bar?.querySelector(".ytp-settings-button"), target = settings?.parentElement || bar;
      for (const node of player.querySelectorAll("[data-tf-subtitle-button]")) if (node !== entry) node.remove();
      if (target) {
        entry.style.position = ""; entry.style.bottom = ""; entry.style.right = ""; entry.style.height = "100%";
        if (entry.parentNode !== target) target.insertBefore(entry, settings || target.firstChild);
      } else if (entry.parentNode !== shadow) {
        entry.style.position = "absolute"; entry.style.bottom = "8px"; entry.style.right = "12px"; entry.style.height = "32px";
        shadow.appendChild(entry);
      }
    }
    function setPanelOpen(value, restoreFocus = false) {
      panelOpen = Boolean(value); if (controls) controls.hidden = !panelOpen;
      entry?.setAttribute("aria-expanded", String(panelOpen));
      if (panelOpen) modeSelect?.focus({ preventScroll: true });
      else if (restoreFocus) entry?.focus({ preventScroll: true });
    }
    function closePanel() { setPanelOpen(false); }
    function onOutsideClick(event) {
      if (panelOpen && !event.composedPath().includes(host) && !event.composedPath().includes(entry)) closePanel();
    }
    function onKeydown(event) {
      if (!panelOpen || event.key !== "Escape") return;
      setPanelOpen(false, true);
      if (!doc.fullscreenElement) { event.preventDefault(); event.stopPropagation(); }
    }

    function buildPresetOptions() {
      return [
        { value: "inherit", key: "content.quick.inheritSite" },
        { value: "none", key: "content.quick.noPreset" },
        ...presetOptions.map((item) => ({
          value: item.id,
          label: item.description ? `${item.label} · ${item.description}` : item.label
        }))
      ];
    }

    function rebuildPresetSelect() {
      if (!presetSelect) return;
      presetSelect.replaceChildren();
      for (const entry of buildPresetOptions()) {
        const option = doc.createElement("option");
        option.value = String(entry.value);
        if (entry.key) locale.bindText(option, entry.key);
        else option.textContent = String(entry.label);
        presetSelect.appendChild(option);
      }
      presetSelect.value = presetValue;
      if (presetSelect.value !== presetValue) {
        presetValue = "inherit";
        presetSelect.value = presetValue;
      }
    }

    function setPresetContext(context = {}) {
      presetOptions = Array.isArray(context.availablePresets)
        ? context.availablePresets
            .filter((item) => item?.id && item?.label)
            .map((item) => ({ id: String(item.id), label: String(item.label), description: String(item.description || "") }))
        : [];
      presetValue = context.temporaryPresetActive
        ? (context.temporaryPresetId || "none")
        : (context.savedPresetId || "inherit");
      rebuildPresetSelect();
      return presetValue;
    }

    function applyState() {
      if (!host) return;
      host.style.setProperty("--tf-subtitle-size", `${SIZE_PX[size] || SIZE_PX.standard}px`);
      if (modeSelect) modeSelect.value = mode;
      if (presetSelect) presetSelect.value = presetValue;
      if (sizeSelect) { sizeSelect.value = size; sizeSelect.disabled = mode !== "bilingual"; }
      const off = mode === "off";
      originalEl?.classList.toggle("hidden", off || !originalEl.textContent);
      translatedEl?.classList.toggle("hidden", off || mode === "original" || !translatedEl.textContent);
      statusEl?.classList.toggle("hidden", off || !statusEl.textContent);
    }

    function bindControls() {
      locale.bindAttribute(modeSelect, "aria-label", "content.subtitle.modeAria");
      locale.bindAttribute(presetSelect, "aria-label", "content.subtitle.presetAria");
      locale.bindAttribute(sizeSelect, "aria-label", "content.subtitle.sizeAria");
      const modeKeys = ["content.subtitle.bilingual", "content.subtitle.original", "content.subtitle.off"];
      [...modeSelect.options].forEach((option, index) => locale.bindText(option, modeKeys[index]));
      const sizeKeys = ["content.subtitle.small", "content.subtitle.standard", "content.subtitle.large"];
      [...sizeSelect.options].forEach((option, index) => locale.bindText(option, sizeKeys[index]));
    }

    function renderOriginal(text = "", source = "") { if (originalEl) { host.dataset.tfSubtitleSource = source; locale.unbind(originalEl); originalEl.textContent = String(text).trim(); applyState(); } }
    function renderTranslation(text = "") { if (translatedEl) { locale.unbind(translatedEl); translatedEl.textContent = String(text).trim(); applyState(); } }
    function setStatus(text = "", kind = "info") { if (statusEl) { locale.unbind(statusEl); statusEl.textContent = String(text).trim(); statusEl.dataset.kind = kind; applyState(); } }
    function setStatusKey(key, kind = "info", args = {}) { if (statusEl) { locale.bindText(statusEl, key, args); statusEl.dataset.kind = kind; applyState(); } }
    function clear({ keepStatus = false } = {}) { if (originalEl) { locale.unbind(originalEl); originalEl.textContent = ""; } if (translatedEl) { locale.unbind(translatedEl); translatedEl.textContent = ""; } if (!keepStatus && statusEl) { locale.unbind(statusEl); statusEl.textContent = ""; } applyState(); }
    function setMode(value) { mode = MODES.includes(value) ? value : "bilingual"; applyState(); return mode; }
    function setSize(value) { size = SIZES.includes(value) ? value : "standard"; applyState(); return size; }
    function unmount() {
      controlsObserver?.disconnect(); controlsObserver = null;
      doc.removeEventListener("click", onOutsideClick, true); doc.removeEventListener("keydown", onKeydown, true);
      doc.removeEventListener("fullscreenchange", closePanel);
      locale.unbindTree(entry); entry?.remove(); entry = null; controls = null; panelOpen = false;
      locale.unbindTree(host); host?.remove(); player = host = shadow = originalEl = translatedEl = statusEl = modeSelect = sizeSelect = presetSelect = null;
    }

    return {
      mount,
      unmount,
      clear,
      renderOriginal,
      renderTranslation,
      setStatus,
      setStatusKey,
      setMode,
      setSize,
      setPresetContext,
      getMode: () => mode,
      getSize: () => size,
      getPresetValue: () => presetValue
    };
  }

  app.modules.subtitleRenderer = { MODES, SIZES, createSubtitleRenderer };
})();
