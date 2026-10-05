(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.youtubeSubtitleSource || !app?.modules.subtitlePipeline || !app?.modules.subtitleRenderer || app.modules.subtitleController) return;

  const { messages, sendRuntimeMessage } = app.modules.runtime;
  const i18n = app.modules.contentI18n;
  const t = (key) => i18n.t(key);
  const { createYouTubeSubtitleSource, PLAYER_SELECTORS } = app.modules.youtubeSubtitleSource;
  const { createSubtitlePipeline } = app.modules.subtitlePipeline;
  const { createSubtitleRenderer, MODES, SIZES } = app.modules.subtitleRenderer;

  function isYouTubePage() { return /(^|\.)youtube\.com$/i.test(location.hostname) && /^\/(?:watch|shorts\/)/.test(location.pathname); }

  function createController({
    isSupportedPage = isYouTubePage,
    sourceFactory = createYouTubeSubtitleSource,
    pipelineFactory = createSubtitlePipeline,
    rendererFactory = createSubtitleRenderer,
    pipelineOptions = {}
  } = {}) {
    let source = null, pipeline = null, started = false, mediaId = "", mode = "bilingual", size = "standard", presetContext = null;
    const renderer = rendererFactory({
      onModeChange: (value) => setMode(value).catch(() => {}),
      onSizeChange: (value) => setSize(value).catch(() => {}),
      onPresetChange: (value) => setPreset(value).catch(() => renderer.setStatusKey("content.subtitle.presetUpdateFailed", "error"))
    });

    function findPlayer() { for (const selector of PLAYER_SELECTORS) { const node = document.querySelector(selector); if (node) return node; } return null; }

    function createPipeline() {
      return pipelineFactory({
        ...pipelineOptions,
        onTranslation: consumeTranslation,
        onState: consumeState
      });
    }

    async function loadSettings() {
      const values = await chrome.storage.local.get(["youtubeSubtitleMode", "youtubeSubtitleSize"]);
      mode = MODES.includes(values.youtubeSubtitleMode) ? values.youtubeSubtitleMode : "bilingual";
      size = SIZES.includes(values.youtubeSubtitleSize) ? values.youtubeSubtitleSize : "standard";
      renderer.setMode(mode); renderer.setSize(size);
      await refreshPreset();
    }

    async function refreshPreset({ retranslate = false } = {}) {
      const response = await sendRuntimeMessage({
        type: messages.background.EFFECTIVE_CONTEXT,
        pageUrl: location.href
      });
      if (!response?.ok) throw new Error(t("content.subtitle.configReadFailed"));
      presetContext = response.context || {};
      renderer.setPresetContext(presetContext);
      if (retranslate && started && mode !== "off") {
        renderer.renderTranslation("");
        await resetPipeline();
        source?.refresh("preset-change", true);
      }
      return presetContext;
    }

    async function resetPipeline() {
      await pipeline?.stop();
      pipeline = createPipeline();
    }

    function consumeSnapshot(snapshot) {
      const player = findPlayer(); if (player) renderer.mount(player);
      if (snapshot.mediaId !== mediaId) { mediaId = snapshot.mediaId; renderer.clear(); }
      const original = (snapshot.cues || []).map((cue) => cue.text).filter(Boolean).join(" ");
      renderer.renderOriginal(original);
      if (snapshot.cues?.length) renderer.setStatus("");
      else renderer.setStatusKey("content.subtitle.captionsUnavailable", "muted");
      if (mode !== "off") pipeline?.ingest(snapshot).catch(() => renderer.setStatusKey("content.subtitle.translationFailed", "error"));
    }

    function consumeTranslation({ unit, translation }) {
      if (unit.mediaId !== mediaId) return;
      renderer.renderTranslation(translation); renderer.setStatus("");
    }

    function consumeState(state) {
      if (state.blockedByError) renderer.setStatusKey("content.subtitle.translationUnavailable", "error");
    }

    async function start() {
      if (started || !isSupportedPage()) return false;
      started = true;
      try {
        await loadSettings();
        renderer.mount(findPlayer());
        pipeline = createPipeline();
        source = sourceFactory({ onSnapshot: consumeSnapshot, subtitleMode: mode });
        await source.start();
        return true;
      } catch (error) {
        started = false;
        renderer.setStatusKey("content.subtitle.controlsUnavailable", "error");
        throw error;
      }
    }

    async function stop() {
      if (!started) return;
      started = false; source?.stop(); await pipeline?.stop(); source = pipeline = null; mediaId = ""; renderer.unmount();
    }

    async function refreshRoute() {
      if (isSupportedPage()) {
        if (!started) return start();
        await refreshPreset();
        source?.refresh("controller-route", true); renderer.mount(findPlayer()); return true;
      }
      await stop(); return false;
    }

    async function setMode(next, { persist = true } = {}) {
      mode = renderer.setMode(next);
      if (persist) await chrome.storage.local.set({ youtubeSubtitleMode: mode });
      source?.setMode?.(mode);
      if (mode === "off") renderer.setStatus(""); else source?.refresh("mode-change", true);
      return mode;
    }

    async function setSize(next, { persist = true } = {}) {
      size = renderer.setSize(next);
      if (persist) await chrome.storage.local.set({ youtubeSubtitleSize: size });
      return size;
    }

    async function setPreset(next) {
      const response = await sendRuntimeMessage({
        type: messages.background.TEMP_PRESET_SET,
        pageUrl: location.href,
        preset: next
      });
      if (!response?.ok) throw new Error(t("content.subtitle.presetUpdateFailed"));
      presetContext = response.context || {};
      renderer.setPresetContext(presetContext);
      if (started && mode !== "off") {
        renderer.renderTranslation("");
        await resetPipeline();
        source?.refresh("preset-change", true);
      }
      return presetContext;
    }

    return {
      start,
      stop,
      refreshRoute,
      refreshPreset,
      setMode,
      setSize,
      setPreset,
      getState: () => ({ started, mode, size, mediaId, presetId: presetContext?.presetId || "", presetSource: presetContext?.presetSource || "none" })
    };
  }

  app.modules.subtitleControllerFactory = { createController };
  app.modules.subtitleController = createController();
})();
