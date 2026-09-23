(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiTokens || app.modules.subtitleRenderer) return;

  const MODES = Object.freeze(["bilingual", "original", "off"]);
  const SIZES = Object.freeze(["small", "standard", "large"]);
  const SIZE_PX = Object.freeze({ small: 15, standard: 18, large: 22 });

  function createSubtitleRenderer({ document: doc = document } = {}) {
    let player = null;
    let host = null;
    let shadow = null;
    let originalEl = null;
    let translatedEl = null;
    let statusEl = null;
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
        .hidden{display:none!important}
      `;
      const wrap = doc.createElement("div");
      wrap.className = "wrap";
      originalEl = doc.createElement("div"); originalEl.className = "line original";
      translatedEl = doc.createElement("div"); translatedEl.className = "line translated";
      statusEl = doc.createElement("div"); statusEl.className = "line status hidden";
      wrap.append(originalEl, translatedEl, statusEl);
      shadow.append(style, wrap);
      player.appendChild(host);
      applyState();
      return true;
    }

    function applyState() {
      if (!host) return;
      host.style.setProperty("--tf-subtitle-size", `${SIZE_PX[size] || SIZE_PX.standard}px`);
      const off = mode === "off";
      originalEl?.classList.toggle("hidden", off || !originalEl.textContent);
      translatedEl?.classList.toggle("hidden", off || mode === "original" || !translatedEl.textContent);
    }

    function renderOriginal(text = "") {
      if (!originalEl) return;
      originalEl.textContent = String(text).trim();
      applyState();
    }

    function renderTranslation(text = "") {
      if (!translatedEl) return;
      translatedEl.textContent = String(text).trim();
      applyState();
    }

    function setStatus(text = "", kind = "info") {
      if (!statusEl) return;
      statusEl.textContent = String(text).trim();
      statusEl.dataset.kind = kind;
      statusEl.classList.toggle("hidden", !statusEl.textContent || mode === "off");
    }

    function clear({ keepStatus = false } = {}) {
      if (originalEl) originalEl.textContent = "";
      if (translatedEl) translatedEl.textContent = "";
      if (!keepStatus && statusEl) statusEl.textContent = "";
      applyState();
    }

    function setMode(value) {
      mode = MODES.includes(value) ? value : "bilingual";
      applyState();
      return mode;
    }

    function setSize(value) {
      size = SIZES.includes(value) ? value : "standard";
      applyState();
      return size;
    }

    function unmount() {
      host?.remove();
      player = host = shadow = originalEl = translatedEl = statusEl = null;
    }

    return { mount, unmount, clear, renderOriginal, renderTranslation, setStatus, setMode, setSize, getMode: () => mode, getSize: () => size };
  }

  app.modules.subtitleRenderer = { MODES, SIZES, createSubtitleRenderer };
})();
