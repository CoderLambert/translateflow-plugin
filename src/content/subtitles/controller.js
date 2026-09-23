(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.youtubeSubtitleSource || !app?.modules.subtitlePipeline || !app?.modules.subtitleRenderer || app.modules.subtitleController) return;

  const { createYouTubeSubtitleSource, PLAYER_SELECTORS } = app.modules.youtubeSubtitleSource;
  const { createSubtitlePipeline } = app.modules.subtitlePipeline;
  const { createSubtitleRenderer, MODES, SIZES } = app.modules.subtitleRenderer;

  function isYouTubePage() { return /(^|\.)youtube\.com$/i.test(location.hostname) && /^\/(?:watch|shorts\/)/.test(location.pathname); }

  function createController() {
    let source = null, pipeline = null, started = false, mediaId = "", mode = "bilingual", size = "standard";
    const renderer = createSubtitleRenderer({
      onModeChange: (value) => setMode(value).catch(() => {}),
      onSizeChange: (value) => setSize(value).catch(() => {})
    });

    function findPlayer() { for (const selector of PLAYER_SELECTORS) { const node = document.querySelector(selector); if (node) return node; } return null; }

    async function loadSettings() {
      const values = await chrome.storage.local.get(["youtubeSubtitleMode", "youtubeSubtitleSize"]);
      mode = MODES.includes(values.youtubeSubtitleMode) ? values.youtubeSubtitleMode : "bilingual";
      size = SIZES.includes(values.youtubeSubtitleSize) ? values.youtubeSubtitleSize : "standard";
      renderer.setMode(mode); renderer.setSize(size);
    }

    function consumeSnapshot(snapshot) {
      const player = findPlayer(); if (player) renderer.mount(player);
      if (snapshot.mediaId !== mediaId) { mediaId = snapshot.mediaId; renderer.clear(); }
      const original = (snapshot.cues || []).map((cue) => cue.text).filter(Boolean).join(" ");
      renderer.renderOriginal(original);
      renderer.setStatus(snapshot.cues?.length ? "" : "Captions unavailable", "muted");
      if (mode !== "off") pipeline?.ingest(snapshot).catch((error) => renderer.setStatus(error.message || "Subtitle translation failed", "error"));
    }

    function consumeTranslation({ unit, translation }) {
      if (unit.mediaId !== mediaId) return;
      renderer.renderTranslation(translation); renderer.setStatus("");
    }

    function consumeState(state) {
      if (state.blockedByError) renderer.setStatus("Translation unavailable — original captions remain visible", "error");
    }

    async function start() {
      if (started || !isYouTubePage()) return false;
      started = true; await loadSettings(); renderer.mount(findPlayer());
      pipeline = createSubtitlePipeline({ onTranslation: consumeTranslation, onState: consumeState });
      source = createYouTubeSubtitleSource({ onSnapshot: consumeSnapshot }); source.start(); return true;
    }

    async function stop() {
      if (!started) return; started = false; source?.stop(); await pipeline?.stop(); source = pipeline = null; mediaId = ""; renderer.unmount();
    }

    async function refreshRoute() {
      if (isYouTubePage()) { if (!started) return start(); source?.refresh("controller-route", true); renderer.mount(findPlayer()); return true; }
      await stop(); return false;
    }

    async function setMode(next, { persist = true } = {}) {
      mode = renderer.setMode(next);
      if (persist) await chrome.storage.local.set({ youtubeSubtitleMode: mode });
      if (mode === "off") renderer.setStatus(""); else source?.refresh("mode-change", true);
      return mode;
    }

    async function setSize(next, { persist = true } = {}) {
      size = renderer.setSize(next);
      if (persist) await chrome.storage.local.set({ youtubeSubtitleSize: size });
      return size;
    }

    return { start, stop, refreshRoute, setMode, setSize, getState: () => ({ started, mode, size, mediaId }) };
  }

  app.modules.subtitleController = createController();
})();
