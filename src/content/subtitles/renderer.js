(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiTokens || !app?.modules.uiPrimitives || app.modules.subtitleRenderer) return;

  const { select: createSelect } = app.modules.uiPrimitives;
  const MODES = Object.freeze(["bilingual", "original", "off"]);
  const SIZES = Object.freeze(["small", "standard", "large"]);
  const SIZE_PX = Object.freeze({ small: 15, standard: 18, large: 22 });

  function createSubtitleRenderer({ document: doc = document, onModeChange, onSizeChange, onPresetChange } = {}) {
    let player, host, shadow, originalEl, translatedEl, statusEl, modeSelect, sizeSelect, presetSelect;
    let mode = "bilingual";
    let size = "standard";
    let presetValue = "inherit";
    let presetOptions = [];

    function mount(nextPlayer) {
      if (!nextPlayer) return false;
      if (player === nextPlayer && host?.isConnected) return true;
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
.controls{position:absolute;right:var(--tf-space-3);bottom:58px;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--tf-space-1);max-width:min(520px,84%);pointer-events:auto;opacity:.42;transition:opacity .15s}
.controls:hover,.controls:focus-within{opacity:1}
.controls .tf-ui-select{min-height:28px;max-width:190px;padding:4px 24px 4px 7px;border-radius:var(--tf-radius-sm);box-shadow:var(--tf-shadow-sm);font-size:var(--tf-font-size-xs)}
.hidden{display:none!important}`;
      const wrap = doc.createElement("div"); wrap.className = "wrap";
      originalEl = doc.createElement("div"); originalEl.className = "line original";
      translatedEl = doc.createElement("div"); translatedEl.className = "line translated";
      statusEl = doc.createElement("div"); statusEl.className = "line status hidden";
      wrap.append(originalEl, translatedEl, statusEl);

      const controls = doc.createElement("div"); controls.className = "controls";
      modeSelect = createSelect({
        label: "TranslateFlow subtitle mode",
        value: mode,
        options: [["bilingual", "双语"], ["original", "原字幕"], ["off", "关闭"]].map(([value, label]) => ({ value, label })),
        className: "tf-subtitle-mode"
      });
      presetSelect = createSelect({
        label: "Translation preset",
        value: presetValue,
        options: buildPresetOptions(),
        className: "tf-subtitle-preset"
      });
      sizeSelect = createSelect({
        label: "Translated subtitle size",
        value: size,
        options: [["small", "小"], ["standard", "标准"], ["large", "大"]].map(([value, label]) => ({ value, label })),
        className: "tf-subtitle-size"
      });
      modeSelect.addEventListener("change", () => { setMode(modeSelect.value); onModeChange?.(mode); });
      presetSelect.addEventListener("change", () => { presetValue = presetSelect.value; onPresetChange?.(presetValue); });
      sizeSelect.addEventListener("change", () => { setSize(sizeSelect.value); onSizeChange?.(size); });
      controls.append(modeSelect, presetSelect, sizeSelect);
      shadow.append(style, wrap, controls);
      player.appendChild(host);
      applyState();
      return true;
    }

    function buildPresetOptions() {
      return [
        { value: "inherit", label: "继承本站设置" },
        { value: "none", label: "无 Preset / 默认 Prompt" },
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
        option.textContent = String(entry.label);
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

    function renderOriginal(text = "") { if (originalEl) { originalEl.textContent = String(text).trim(); applyState(); } }
    function renderTranslation(text = "") { if (translatedEl) { translatedEl.textContent = String(text).trim(); applyState(); } }
    function setStatus(text = "", kind = "info") { if (statusEl) { statusEl.textContent = String(text).trim(); statusEl.dataset.kind = kind; applyState(); } }
    function clear({ keepStatus = false } = {}) { if (originalEl) originalEl.textContent = ""; if (translatedEl) translatedEl.textContent = ""; if (!keepStatus && statusEl) statusEl.textContent = ""; applyState(); }
    function setMode(value) { mode = MODES.includes(value) ? value : "bilingual"; applyState(); return mode; }
    function setSize(value) { size = SIZES.includes(value) ? value : "standard"; applyState(); return size; }
    function unmount() { host?.remove(); player = host = shadow = originalEl = translatedEl = statusEl = modeSelect = sizeSelect = presetSelect = null; }

    return {
      mount,
      unmount,
      clear,
      renderOriginal,
      renderTranslation,
      setStatus,
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
