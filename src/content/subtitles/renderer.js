(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiTokens || app.modules.subtitleRenderer) return;

  const MODES = Object.freeze(["bilingual", "original", "off"]);
  const SIZES = Object.freeze(["small", "standard", "large"]);
  const SIZE_PX = Object.freeze({ small: 15, standard: 18, large: 22 });

  function createSubtitleRenderer({ document: doc = document, onModeChange, onSizeChange } = {}) {
    let player, host, shadow, originalEl, translatedEl, statusEl, modeSelect, sizeSelect;
    let mode = "bilingual";
    let size = "standard";

    function mount(nextPlayer) {
      if (!nextPlayer) return false;
      if (player === nextPlayer && host?.isConnected) return true;
      unmount();
      player = nextPlayer;
      host = doc.createElement("div");
      host.setAttribute("data-tf-extension-ui", "youtube-subtitles");
      host.style.cssText = "position:absolute;inset:0;z-index:2147483000;pointer-events:none;font-family:Arial,sans-serif;";
      shadow = host.attachShadow({ mode: "open" });
      const style = doc.createElement("style");
      style.textContent = `
        :host{all:initial}.wrap{position:absolute;left:8%;right:8%;bottom:11%;display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;text-align:center}
        .line{max-width:92%;padding:2px 8px;border-radius:4px;background:rgba(0,0,0,.72);color:#fff;text-shadow:0 1px 2px #000;line-height:1.35;white-space:pre-wrap}
        .original{font-size:16px}.translated{font-size:var(--tf-subtitle-size,18px);font-weight:500}.status{font-size:12px;opacity:.82}
        .controls{position:absolute;right:12px;bottom:58px;display:flex;gap:6px;pointer-events:auto;opacity:.35;transition:opacity .15s}.controls:hover,.controls:focus-within{opacity:1}
        select{appearance:auto;font:12px Arial,sans-serif;color:#fff;background:rgba(20,20,20,.88);border:1px solid rgba(255,255,255,.3);border-radius:6px;padding:4px 6px;outline:none}select:focus{border-color:#8ab4f8}.hidden{display:none!important}
      `;
      const wrap = doc.createElement("div"); wrap.className = "wrap";
      originalEl = doc.createElement("div"); originalEl.className = "line original";
      translatedEl = doc.createElement("div"); translatedEl.className = "line translated";
      statusEl = doc.createElement("div"); statusEl.className = "line status hidden";
      wrap.append(originalEl, translatedEl, statusEl);

      const controls = doc.createElement("div"); controls.className = "controls";
      modeSelect = makeSelect("TranslateFlow subtitle mode", [["bilingual","双语"],["original","原字幕"],["off","关闭"]]);
      sizeSelect = makeSelect("Translated subtitle size", [["small","小"],["standard","标准"],["large","大"]]);
      modeSelect.addEventListener("change", () => { setMode(modeSelect.value); onModeChange?.(mode); });
      sizeSelect.addEventListener("change", () => { setSize(sizeSelect.value); onSizeChange?.(size); });
      controls.append(modeSelect, sizeSelect);
      shadow.append(style, wrap, controls);
      player.appendChild(host);
      applyState();
      return true;
    }

    function makeSelect(label, options) {
      const select = doc.createElement("select"); select.setAttribute("aria-label", label);
      for (const [value, text] of options) { const option = doc.createElement("option"); option.value = value; option.textContent = text; select.appendChild(option); }
      return select;
    }

    function applyState() {
      if (!host) return;
      host.style.setProperty("--tf-subtitle-size", `${SIZE_PX[size] || SIZE_PX.standard}px`);
      if (modeSelect) modeSelect.value = mode;
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
    function unmount() { host?.remove(); player = host = shadow = originalEl = translatedEl = statusEl = modeSelect = sizeSelect = null; }

    return { mount, unmount, clear, renderOriginal, renderTranslation, setStatus, setMode, setSize, getMode: () => mode, getSize: () => size };
  }

  app.modules.subtitleRenderer = { MODES, SIZES, createSubtitleRenderer };
})();
