(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.subtitleSource
    || !app.modules.textTrackSubtitleSource
    || !app.modules.youtubeBridgeProtocol
    || !app.modules.youtubeTimedtext
    || app.modules.youtubeSubtitleSource
  ) return;

  const { SOURCE_KINDS, cleanCueText, normalizeSnapshot, createSnapshotEmitter, createCueTimeline } = app.modules.subtitleSource;
  const { createTextTrackSource } = app.modules.textTrackSubtitleSource;
  const protocol = app.modules.youtubeBridgeProtocol;
  const runtime = app.modules.runtime;
  // An already registered legacy script list cannot load the new DOM helper until refresh.
  // Keep TextTrack/timedtext and the rest of Content available without hiding native captions.
  const { CAPTION_CONTAINER_SELECTORS, CAPTION_SEGMENT_SELECTORS, createCaptionDom } = app.modules.youtubeCaptionDom || {
    CAPTION_CONTAINER_SELECTORS: [], CAPTION_SEGMENT_SELECTORS: [],
    createCaptionDom: () => ({ readCues: () => [], suppress() {}, restore() {} })
  };

  const PLAYER_SELECTORS = Object.freeze(["#movie_player", ".html5-video-player"]);
  const VIDEO_SELECTORS = Object.freeze(["video.html5-main-video", "video"]);
  const NAVIGATION_EVENTS = Object.freeze(["yt-navigate-finish", "yt-page-data-updated"]);

  function parseYouTubeVideoId(rawUrl) {
    try {
      const url = new URL(rawUrl, "https://www.youtube.com/");
      const queryId = cleanCueText(url.searchParams.get("v"));
      if (queryId) return queryId;
      const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i);
      if (match?.[1]) return decodeURIComponent(match[1]);
      if (url.hostname === "youtu.be") return decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
      return "";
    } catch { return ""; }
  }

  function queryFirst(root, selectors) {
    for (const selector of selectors) {
      const node = root?.querySelector?.(selector);
      if (node) return node;
    }
    return null;
  }

  // The bridge belongs to the current source in this document. A late install
  // from a stopped source must not tear down a newer owner.
  const bridgeOwners = new WeakMap();

  function createYouTubeSubtitleSource({
    document: doc = globalThis.document,
    window: win = globalThis.window,
    onSnapshot,
    preferredLanguage = "",
    subtitleMode = "bilingual",
    installBridge = null
  } = {}) {
    if (!doc) throw new Error("YouTube subtitle source requires a document.");

    const emitter = createSnapshotEmitter(onSnapshot);
    const install = installBridge || (() => {
      const type = runtime?.messages?.background?.YOUTUBE_BRIDGE_INSTALL || "YOUTUBE_BRIDGE_INSTALL";
      return runtime?.sendRuntimeMessage ? runtime.sendRuntimeMessage({ type }) : Promise.resolve({ ok: true });
    });
    const ownerKey = win || doc;
    const owner = {};
    let activation = 0;
    let started = false;
    let mode = ["bilingual", "original", "off"].includes(subtitleMode) ? subtitleMode : "bilingual";
    let pageVideoId = "", mainGeneration = null, mainValid = false;
    let timeline = createCueTimeline();
    let mainTrack = null, mainReady = false;
    let playerRoot = null, videoElement = null;
    let textTrackSource = null, observer = null, cueTimer = null;
    const captionDom = createCaptionDom(doc);
    const restoreNativeCaptionLayer = captionDom.restore;
    const suppressNativeCaptionLayer = () => mode === "off" ? captionDom.restore() : captionDom.suppress(playerRoot);

    const onNavigation = () => refresh("spa-navigation", true);
    const onPopState = () => refresh("popstate", true);
    const onMutation = () => {
      if (!isActive()) return;
      if (mainAvailable() && playerRoot?.isConnected && videoElement?.isConnected
        && playerRoot.contains?.(videoElement)) {
        suppressNativeCaptionLayer();
        return;
      }
      refresh("dom-mutation");
    };
    const onVideoEvent = event => refresh(event?.type || "media-time");

    function isActive() { return started && mode !== "off"; }

    function currentVideoId() {
      const fromUrl = parseYouTubeVideoId(win?.location?.href || "");
      if (fromUrl) return fromUrl;
      return cleanCueText(videoElement?.currentSrc || videoElement?.src);
    }

    function resolveMediaId() {
      const id = pageVideoId || currentVideoId();
      return id.startsWith("youtube:") || id.startsWith("youtube-media:") ? id : id ? `youtube:${id}` : "youtube:unknown";
    }

    function resetMain() {
      mainGeneration = null;
      mainValid = false;
      timeline = createCueTimeline();
      mainTrack = null;
      mainReady = false;
      clearTimeout(cueTimer);
      cueTimer = null;
      emitter.reset();
      restoreNativeCaptionLayer();
    }

    function syncPageIdentity() {
      const next = currentVideoId();
      if (!next || next === pageVideoId) return false;
      pageVideoId = next;
      resetMain();
      return true;
    }

    function bindObserver(nextRoot) {
      if (playerRoot === nextRoot && observer) return false;
      observer?.disconnect?.();
      observer = null;
      const changed = playerRoot !== nextRoot;
      playerRoot = nextRoot;
      const Observer = win?.MutationObserver || globalThis.MutationObserver;
      if (!isActive() || !playerRoot || typeof Observer !== "function") return changed;
      observer = new Observer(onMutation);
      observer.observe(playerRoot, { childList: true, subtree: true, characterData: true });
      return changed;
    }

    function syncTextTrackSource() {
      if (!isActive() || !videoElement || mainAvailable()) {
        textTrackSource?.stop?.();
        textTrackSource = null;
        return;
      }
      if (textTrackSource) return;
      const candidate = createTextTrackSource({
        mediaElement: videoElement,
        preferredLanguage,
        mediaId: resolveMediaId,
        onSnapshot: (snapshot) => {
          if (!isActive() || candidate !== textTrackSource || mainAvailable()) return;
          if (snapshot.cues?.length) emitTextTrack(snapshot, "text-track-event");
          else refresh("text-track-empty");
        }
      });
      textTrackSource = candidate;
      candidate.start();
    }

    function bindVideo(nextVideo) {
      if (videoElement === nextVideo) { syncTextTrackSource(); return false; }
      textTrackSource?.stop?.();
      textTrackSource = null;
      for (const name of ["timeupdate", "seeking", "seeked", "play", "pause", "ratechange", "loadedmetadata", "emptied"]) {
        videoElement?.removeEventListener?.(name, onVideoEvent);
      }
      videoElement = nextVideo || null;
      if (videoElement) {
        for (const name of ["timeupdate", "seeking", "seeked", "play", "pause", "ratechange", "loadedmetadata", "emptied"]) {
          videoElement.addEventListener?.(name, onVideoEvent);
        }
      }
      syncTextTrackSource();
      return true;
    }

    function bindCurrentPlayer() {
      const nextRoot = queryFirst(doc, PLAYER_SELECTORS) || doc.documentElement || doc.body || null;
      const observerChanged = bindObserver(nextRoot);
      const videoChanged = bindVideo(queryFirst(nextRoot || doc, VIDEO_SELECTORS) || queryFirst(doc, VIDEO_SELECTORS));
      return observerChanged || videoChanged;
    }

    function validMainMessage(message) {
      return Boolean(mainReady && pageVideoId && message.videoId === pageVideoId
        && mainGeneration !== null && message.generation === mainGeneration);
    }

    function mainAvailable() { return mainValid && validMainMessage({ videoId: pageVideoId, generation: mainGeneration }); }

    function scheduleNextBoundary(time) {
      clearTimeout(cueTimer);
      cueTimer = null;
      if (!isActive() || !mainAvailable() || videoElement?.paused || videoElement?.seeking) return;
      const next = timeline.nextBoundary(time + 0.001);
      if (next === undefined) return;
      const rate = Math.max(0.1, Math.abs(Number(videoElement?.playbackRate) || 1));
      cueTimer = setTimeout(() => {
        cueTimer = null;
        if (isActive() && mainAvailable()) emitTimedtext("cue-boundary", true);
      }, Math.max(0, ((next - time) / rate) * 1000));
    }

    function emitTimedtext(reason = "timedtext", force = false) {
      const mediaTime = Number(videoElement?.currentTime);
      const time = Number.isFinite(mediaTime) && mediaTime >= 0 ? mediaTime : 0;
      const snapshot = emitter.emit({
        source: SOURCE_KINDS.YOUTUBE_TIMEDTEXT,
        reason,
        mediaId: resolveMediaId(),
        mediaTime: time,
        seeking: videoElement?.seeking === true,
        track: mainTrack,
        cues: timeline.activeAt(time),
        upcomingCues: timeline.upcomingAt(time)
      }, { force });
      scheduleNextBoundary(time);
      suppressNativeCaptionLayer();
      return snapshot;
    }

    function emitTextTrack(snapshot, reason = "text-track", force = false) {
      const next = emitter.emit({ ...snapshot, source: SOURCE_KINDS.TEXT_TRACK, reason, mediaId: resolveMediaId() }, { force });
      suppressNativeCaptionLayer();
      return next;
    }

    function emitDomSnapshot(reason = "dom-fallback", force = false) {
      const cues = captionDom.readCues();
      const snapshot = emitter.emit({
        source: SOURCE_KINDS.YOUTUBE_DOM,
        reason,
        mediaId: resolveMediaId(),
        mediaTime: videoElement?.currentTime,
        seeking: videoElement?.seeking === true,
        track: { kind: "captions", label: "YouTube caption DOM", language: "", mode: "showing" },
        cues
      }, { force });
      if (cues.length) suppressNativeCaptionLayer();
      else restoreNativeCaptionLayer();
      return snapshot;
    }

    function refresh(reason = "refresh", force = false) {
      if (!isActive()) return getSnapshot();
      syncPageIdentity();
      const bindingChanged = bindCurrentPlayer();
      if (mainAvailable()) return emitTimedtext(reason, force || bindingChanged);
      const textTrackSnapshot = textTrackSource?.getSnapshot?.();
      if (textTrackSnapshot?.cues?.length) return emitTextTrack(textTrackSnapshot, reason, force || bindingChanged);
      return emitDomSnapshot(reason, force || bindingChanged);
    }

    function postToMain(type, payload = {}) {
      return protocol.post(win, {
        direction: protocol.DIRECTIONS.ISOLATED_TO_MAIN,
        type,
        videoId: pageVideoId,
        generation: mainGeneration ?? 0,
        observedAt: Date.now(),
        payload
      });
    }

    function postHello() { postToMain("HELLO", { mode }); }

    function handleBridgeMessage(event) {
      if (!isActive() || event.source !== win) return;
      const result = protocol.validateEnvelope(event.data, { direction: protocol.DIRECTIONS.MAIN_TO_ISOLATED });
      if (!result.ok) return;
      const message = result.value;
      const routeId = currentVideoId();
      if (message.type === "VIDEO_CHANGED") {
        if (routeId && message.videoId && routeId !== message.videoId) return;
        resetMain();
        pageVideoId = message.videoId;
        mainGeneration = message.generation;
        mainReady = true;
        refresh("video-changed", true);
        return;
      }
      if (message.videoId && pageVideoId && message.videoId !== pageVideoId) return;
      if (message.type === "READY") {
        pageVideoId = message.videoId || pageVideoId || routeId;
        mainGeneration = message.generation;
        mainReady = true;
        refresh("bridge-ready", true);
      } else if (message.type === "TRACKS" && message.generation === mainGeneration) {
        const nextTrack = message.payload.selected || message.payload.tracks?.[0] || null;
        if ((mainTrack?.id || "") !== (nextTrack?.id || "")) {
          mainValid = false;
          timeline = createCueTimeline();
        }
        mainTrack = nextTrack;
        refresh("track-metadata");
      } else if (message.type === "TIMEDTEXT" && message.generation === mainGeneration) {
        mainReady = true;
        mainValid = true;
        timeline = createCueTimeline(message.payload.cues);
        syncTextTrackSource();
        mainTrack = message.payload.track || mainTrack;
        emitTimedtext("timedtext", true);
      } else if (message.type === "ERROR" && message.generation === mainGeneration) {
        mainValid = false;
        timeline = createCueTimeline();
        refresh("bridge-error", true);
      }
    }

    function listen(enabled) {
      const toggle = (target, name, callback) => enabled
        ? target?.addEventListener?.(name, callback) : target?.removeEventListener?.(name, callback);
      for (const name of NAVIGATION_EVENTS) toggle(doc, name, onNavigation);
      toggle(win, "popstate", onPopState);
      toggle(win, "message", handleBridgeMessage);
    }

    async function activate() {
      listen(true);
      const version = ++activation;
      bridgeOwners.set(ownerKey, owner);
      try { await install(); } catch {}
      if (!isActive() || version !== activation) {
        // Injection may finish after STOP. Clean its late hooks, unless another
        // active source now owns the shared MAIN bridge.
        if (!bridgeOwners.has(ownerKey)) postToMain("STOP");
        return getSnapshot();
      }
      postHello();
      return refresh("start", true);
    }

    async function start() {
      if (started) return getSnapshot();
      started = true;
      pageVideoId = currentVideoId();
      return mode === "off" ? getSnapshot() : activate();
    }

    function releasePlayer() {
      observer?.disconnect?.();
      observer = null;
      clearTimeout(cueTimer);
      cueTimer = null;
      bindVideo(null);
      playerRoot = null;
      resetMain();
    }

    function deactivate() {
      activation++;
      listen(false);
      if (bridgeOwners.get(ownerKey) === owner) {
        bridgeOwners.delete(ownerKey);
        postToMain("STOP");
      }
      releasePlayer();
    }

    function stop() {
      if (!started) return;
      started = false;
      deactivate();
    }

    function setMode(nextMode) {
      const previous = mode;
      mode = ["bilingual", "original", "off"].includes(nextMode) ? nextMode : "bilingual";
      if (started && mode !== previous) {
        if (mode === "off") deactivate();
        else if (previous === "off") activate().catch(() => {});
        else { postHello(); refresh("mode-change", true); }
      }
      return mode;
    }

    function getSnapshot() {
      return emitter.getLastSnapshot() || normalizeSnapshot({ source: SOURCE_KINDS.YOUTUBE_DOM, reason: "idle", mediaId: resolveMediaId(), cues: [] });
    }
    function getMode() {
      if (mainAvailable()) return SOURCE_KINDS.YOUTUBE_TIMEDTEXT;
      return textTrackSource?.getSnapshot?.().cues?.length ? SOURCE_KINDS.TEXT_TRACK : SOURCE_KINDS.YOUTUBE_DOM;
    }

    return { kind: "youtube", start, stop, refresh, setMode, getSnapshot, getMode };
  }

  app.modules.youtubeSubtitleSource = {
    PLAYER_SELECTORS,
    VIDEO_SELECTORS,
    CAPTION_CONTAINER_SELECTORS,
    CAPTION_SEGMENT_SELECTORS,
    parseYouTubeVideoId,
    createYouTubeSubtitleSource
  };
})();
