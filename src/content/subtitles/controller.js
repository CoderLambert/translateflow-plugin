(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.youtubeSubtitleSource || !app?.modules.subtitlePipeline || !app?.modules.subtitleRenderer || app.modules.subtitleController) return;

  const { messages, sendRuntimeMessage } = app.modules.runtime;
  const t = (key) => app.modules.contentI18n.t(key);
  const { createYouTubeSubtitleSource, PLAYER_SELECTORS } = app.modules.youtubeSubtitleSource;
  const { createSubtitlePipeline, subtitleScopeKey } = app.modules.subtitlePipeline;
  const { createSubtitleRenderer, MODES, SIZES } = app.modules.subtitleRenderer;
  const { normalizeSnapshot } = app.modules.subtitleSource;

  function isYouTubePage() { return /(^|\.)youtube\.com$/i.test(location.hostname) && /^\/(?:watch|shorts\/)/.test(location.pathname); }

  function createController({
    isSupportedPage = isYouTubePage,
    sourceFactory = createYouTubeSubtitleSource,
    pipelineFactory = createSubtitlePipeline,
    rendererFactory = createSubtitleRenderer,
    pipelineOptions = {}
  } = {}) {
    let source = null, pipeline = null, started = false, mediaId = "", mode = "bilingual", size = "standard", presetContext = null;
    let lifecycle = 0, configRead = 0, pipelineVersion = 0;
    let current = null, frameKey = "", scopeKey = "", knownCues = false;
    const visibleResults = new Map();
    const renderer = rendererFactory({
      onModeChange: (value) => setMode(value).catch(() => {}),
      onSizeChange: (value) => setSize(value).catch(() => {}),
      onPresetChange: (value) => setPreset(value).catch(() => renderer.setStatusKey("content.subtitle.presetUpdateFailed", "error"))
    });

    function findPlayer() { for (const selector of PLAYER_SELECTORS) { const node = document.querySelector(selector); if (node) return node; } return null; }
    function alive(version) { return started && version === lifecycle; }
    function translates() { return mode !== "original" && mode !== "off"; }
    function clearFrame() { current = null; frameKey = ""; visibleResults.clear(); renderer.clear(); }

    function createPipeline() {
      const version = ++pipelineVersion;
      return pipelineFactory({
        ...pipelineOptions,
        onTranslation(value) { if (started && version === pipelineVersion) consumeTranslation(value); },
        onState(value) { if (started && version === pipelineVersion && translates()) consumeState(value); }
      });
    }

    async function loadSettings(version) {
      const response = await sendRuntimeMessage({ type: messages.background.PUBLIC_SETTINGS_GET });
      if (!alive(version)) return;
      const values = response?.settings || {};
      mode = MODES.includes(values.youtubeSubtitleMode) ? values.youtubeSubtitleMode : "bilingual";
      size = SIZES.includes(values.youtubeSubtitleSize) ? values.youtubeSubtitleSize : "standard";
      renderer.setMode(mode); renderer.setSize(size);
      await refreshPreset();
    }

    async function refreshPreset({ retranslate = false } = {}) {
      const version = lifecycle, read = ++configRead;
      const response = await sendRuntimeMessage({ type: messages.background.EFFECTIVE_CONTEXT, pageUrl: location.href, surface: "subtitle" });
      if (!alive(version) || read !== configRead) return presetContext;
      if (!response?.ok) throw new Error(t("content.subtitle.configReadFailed"));
      const nextContext = response.context || {};
      const changed = presetContext && JSON.stringify(presetContext) !== JSON.stringify(nextContext);
      presetContext = nextContext;
      renderer.setPresetContext(presetContext);
      if (retranslate || changed) {
        await resetPipeline();
        if (alive(version) && read === configRead && mode !== "off") source?.refresh("preset-change", true);
      }
      return presetContext;
    }

    function resetPipeline() {
      visibleResults.clear(); renderer.renderTranslation("");
      return pipeline?.reset();
    }

    async function invalidate({ retranslate = false } = {}) {
      const version = lifecycle;
      await resetPipeline();
      if (retranslate && alive(version)) await refreshPreset({ retranslate: true });
    }

    function paintTranslation() {
      const count = current?.cues?.length || 0;
      // Untimed DOM lines are translated together; timed overlapping cues retain their order.
      const combined = visibleResults.get("combined");
      const lines = Array.from({ length: count }, (_, index) => visibleResults.get(index)?.translation);
      renderer.renderTranslation(translates() ? (combined?.translation ?? (lines.every(Boolean) ? lines.join("\n") : "")) : "");
    }

    function matchesUntimed(unit, snapshot) {
      if (!snapshot.cues.length || !snapshot.cues.every(cue => cue.startTime === null && cue.endTime === null)) return false;
      const text = snapshot.cues.map(cue => cue.text).join(" ");
      // A rolling DOM caption may append words while an already translated
      // phrase remains visible. Never carry a phrase after it scrolls out.
      return snapshot.source === "youtube-dom" ? ` ${text} `.includes(` ${unit.text} `) : unit.text === text;
    }

    function consumeSnapshot(input) {
      if (!started) return;
      const snapshot = normalizeSnapshot(input), nextScope = subtitleScopeKey(snapshot);
      if (nextScope !== scopeKey) { scopeKey = nextScope; knownCues = false; clearFrame(); }
      const nextFrame = JSON.stringify([nextScope, snapshot.cues]);
      if (nextFrame !== frameKey || snapshot.seeking) {
        const combined = visibleResults.get("combined");
        frameKey = nextFrame; visibleResults.clear();
        if (!snapshot.seeking && combined && matchesUntimed(combined.unit, snapshot)) visibleResults.set("combined", combined);
        else renderer.renderTranslation("");
      }
      current = snapshot; mediaId = snapshot.mediaId;
      knownCues ||= snapshot.cues.length > 0;
      const player = findPlayer(); if (player) renderer.mount(player);
      if (mode === "off") { renderer.clear(); return; }
      renderer.renderOriginal(snapshot.cues.map((cue) => cue.text).filter(Boolean).join(" "), snapshot.source);
      if (snapshot.cues.length || knownCues) renderer.setStatus("");
      else renderer.setStatusKey("content.subtitle.captionsUnavailable", "muted");
      paintTranslation();
      if (translates()) {
        const version = pipelineVersion, requestedFrame = frameKey;
        pipeline?.ingest(snapshot).catch(() => {
          if (started && translates() && version === pipelineVersion && requestedFrame === frameKey)
            renderer.setStatusKey("content.subtitle.translationFailed", "error");
        });
      }
    }

    function consumeTranslation({ unit, translation, engine, cacheWarning }) {
      if (!started || !translates() || !current || subtitleScopeKey(unit) !== scopeKey) return;
      const video = findPlayer()?.querySelector?.("video");
      if (video?.seeking) return;
      const untimed = unit.cue?.startTime === null && unit.cue?.endTime === null;
      if (video && !untimed && (!Number.isFinite(video.currentTime)
        || (unit.cue.startTime !== null && video.currentTime < unit.cue.startTime)
        || (unit.cue.endTime !== null && video.currentTime >= unit.cue.endTime))) return;
      let index;
      if (untimed) {
        if (!matchesUntimed(unit, current)) return;
        const shown = visibleResults.get("combined");
        if (shown && shown.unit.text.length > unit.text.length && ` ${shown.unit.text} `.includes(` ${unit.text} `)) return;
        index = "combined";
      } else {
        index = current.cues.findIndex(cue => cue.id === unit.cue?.id && cue.text === unit.text
          && cue.startTime === unit.cue.startTime && cue.endTime === unit.cue.endTime);
        if (index < 0) return;
      }
      visibleResults.set(index, { unit, translation }); paintTranslation();
      if (cacheWarning) renderer.setStatusKey("content.subtitle.cacheNotSaved", "error");
      else renderer.setStatus(engine === "browser-translator" ? t("content.basic.sourceBadge") : "");
    }

    function consumeState(state) {
      if (state.blockedByError) renderer.setStatusKey(mode === "translated" ? "content.subtitle.translationOnlyUnavailable" : "content.subtitle.translationUnavailable", "error");
    }

    async function start() {
      if (started || !isSupportedPage()) return false;
      started = true;
      const version = ++lifecycle;
      try {
        await loadSettings(version);
        if (!alive(version)) return false;
        renderer.mount(findPlayer());
        pipeline = createPipeline();
        const ownSource = sourceFactory({
          onSnapshot(snapshot) { if (alive(version)) consumeSnapshot(snapshot); }, subtitleMode: mode
        });
        source = ownSource;
        await ownSource.start();
        if (!alive(version)) { ownSource.stop(); return false; }
        return true;
      } catch (error) {
        if (alive(version)) {
          await stop();
          renderer.setStatusKey("content.subtitle.controlsUnavailable", "error");
        }
        throw error;
      }
    }

    async function stop() {
      if (!started) return;
      started = false; lifecycle += 1; configRead += 1; pipelineVersion += 1;
      const previousSource = source, previousPipeline = pipeline;
      source = pipeline = null; mediaId = scopeKey = ""; knownCues = false;
      previousSource?.stop(); clearFrame(); renderer.unmount();
      await previousPipeline?.stop();
    }

    async function refreshRoute() {
      if (!isSupportedPage()) { await stop(); return false; }
      if (!started) return start();
      const version = lifecycle;
      await refreshPreset();
      if (!alive(version)) return false;
      source?.refresh("controller-route", true); renderer.mount(findPlayer()); return true;
    }

    async function setMode(next, { persist = true } = {}) {
      mode = renderer.setMode(next);
      const selected = mode;
      // Revoke work before storage/RPC waits; no page-wide or shared-engine cancellation.
      const cancelling = !translates() ? pipeline?.cancelPending() : undefined;
      if (!translates()) renderer.renderTranslation("");
      if (mode === "off") renderer.clear();
      source?.setMode?.(mode);
      if (started && mode !== "off") source?.refresh("mode-change", true);
      const saving = persist ? sendRuntimeMessage({ type: messages.background.PUBLIC_SETTINGS_SET,
        settings: { youtubeSubtitleMode: selected } }) : Promise.resolve({ ok: true });
      const [, saved] = await Promise.all([cancelling, saving]);
      if (!saved?.ok) throw new Error(t("content.subtitle.configReadFailed"));
      return selected;
    }

    async function setSize(next, { persist = true } = {}) {
      size = renderer.setSize(next);
      if (persist) await sendRuntimeMessage({ type: messages.background.PUBLIC_SETTINGS_SET, settings: { youtubeSubtitleSize: size } });
      return size;
    }

    async function setPreset(next) {
      const version = lifecycle, read = ++configRead;
      const response = await sendRuntimeMessage({ type: messages.background.TEMP_PRESET_SET, pageUrl: location.href, surface: "subtitle", preset: next });
      if (!alive(version) || read !== configRead) return presetContext;
      if (!response?.ok) throw new Error(t("content.subtitle.presetUpdateFailed"));
      presetContext = response.context || {};
      renderer.setPresetContext(presetContext);
      await resetPipeline();
      if (alive(version) && read === configRead && mode !== "off") source?.refresh("preset-change", true);
      return presetContext;
    }

    return {
      start, stop, refreshRoute, refreshPreset, invalidate, setMode, setSize, setPreset,
      getState: () => ({ started, mode, size, mediaId, presetId: presetContext?.presetId || "", presetSource: presetContext?.presetSource || "none" })
    };
  }

  app.modules.subtitleControllerFactory = { createController };
  app.modules.subtitleController = createController();
})();
