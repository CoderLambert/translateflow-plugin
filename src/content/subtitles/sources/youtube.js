(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.subtitleSource
    || !app.modules.textTrackSubtitleSource
    || !app.modules.youtubeBridgeProtocol
    || !app.modules.youtubeTimedtext
    || app.modules.youtubeSubtitleSource
  ) return;

  const { SOURCE_KINDS, cleanCueText, normalizeSnapshot, createSnapshotEmitter } = app.modules.subtitleSource;
  const { createTextTrackSource } = app.modules.textTrackSubtitleSource;
  const protocol = app.modules.youtubeBridgeProtocol;
  const timedtext = app.modules.youtubeTimedtext;
  const runtime = app.modules.runtime;

  const PLAYER_SELECTORS = Object.freeze(["#movie_player", ".html5-video-player"]);
  const VIDEO_SELECTORS = Object.freeze(["video.html5-main-video", "video"]);
  const CAPTION_CONTAINER_SELECTORS = Object.freeze(["#ytp-caption-window-container", ".ytp-caption-window-container"]);
  const CAPTION_SEGMENT_SELECTORS = Object.freeze([".ytp-caption-segment", ".caption-visual-line", ".captions-text span"]);
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
    let started = false;
    let mode = ["bilingual", "original", "off"].includes(subtitleMode) ? subtitleMode : "bilingual";
    let pageVideoId = "";
    let mainGeneration = null;
    let mainValid = false;
    let mainCues = [];
    let mainTrack = null;
    let mainReady = false;
    let playerRoot = null;
    let videoElement = null;
    let textTrackSource = null;
    let observer = null;
    let cueTimer = null;
    const hiddenNative = new Map();

    const onNavigation = () => refresh("spa-navigation", true);
    const onPopState = () => refresh("popstate", true);
    const onMutation = () => refresh("dom-mutation");
    const onVideoEvent = () => refresh("media-time");

    function currentVideoId() {
      const fromUrl = parseYouTubeVideoId(win?.location?.href || "");
      if (fromUrl) return fromUrl;
      return cleanCueText(videoElement?.currentSrc || videoElement?.src);
    }

    function resolveMediaId() {
      const id = pageVideoId || currentVideoId();
      return id.startsWith("youtube:") || id.startsWith("youtube-media:") ? id : id ? `youtube:${id}` : "youtube:unknown";
    }

    function syncPageIdentity() {
      const next = currentVideoId();
      if (!next || next === pageVideoId) return false;
      pageVideoId = next;
      mainGeneration = null;
      mainValid = false;
      mainCues = [];
      mainTrack = null;
      mainReady = false;
      clearTimeout(cueTimer);
      cueTimer = null;
      emitter.reset();
      restoreNativeCaptionLayer();
      return true;
    }

    function bindObserver(nextRoot) {
      if (playerRoot === nextRoot && observer) return false;
      observer?.disconnect?.();
      observer = null;
      const changed = playerRoot !== nextRoot;
      playerRoot = nextRoot;
      const Observer = win?.MutationObserver || globalThis.MutationObserver;
      if (!started || !playerRoot || typeof Observer !== "function") return changed;
      observer = new Observer(onMutation);
      observer.observe(playerRoot, { childList: true, subtree: true, characterData: true });
      return changed;
    }

    function bindVideo(nextVideo) {
      if (videoElement === nextVideo && textTrackSource) return false;
      const changed = videoElement !== nextVideo;
      textTrackSource?.stop?.();
      textTrackSource = null;
      for (const name of ["timeupdate", "seeking", "seeked", "play", "pause", "ratechange", "loadedmetadata", "emptied"]) {
        videoElement?.removeEventListener?.(name, onVideoEvent);
      }
      videoElement = nextVideo || null;
      if (!videoElement) return changed;
      for (const name of ["timeupdate", "seeking", "seeked", "play", "pause", "ratechange", "loadedmetadata", "emptied"]) {
        videoElement.addEventListener?.(name, onVideoEvent);
      }
      let candidate;
      candidate = createTextTrackSource({
        mediaElement: videoElement,
        preferredLanguage,
        mediaId: resolveMediaId,
        onSnapshot: (snapshot) => {
          if (!started || candidate !== textTrackSource || mainAvailable()) return;
          if (snapshot.cues?.length) emitTextTrack(snapshot, "text-track-event");
          else refresh("text-track-empty");
        }
      });
      textTrackSource = candidate;
      candidate.start();
      return changed;
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

    function activeCuesAt(time) {
      return mainCues.filter((cue) => {
        const start = Number(cue.startTime);
        const end = cue.endTime === null ? Infinity : Number(cue.endTime);
        return Number.isFinite(start) && start <= time && time < end;
      });
    }

    function scheduleNextBoundary(time) {
      clearTimeout(cueTimer);
      cueTimer = null;
      if (!mainAvailable() || !mainCues.length) return;
      const boundaries = mainCues.flatMap((cue) => [cue.startTime, cue.endTime]).filter((value) => Number.isFinite(value) && value > time + 0.001);
      if (!boundaries.length) return;
      const rate = Math.max(0.1, Math.abs(Number(videoElement?.playbackRate) || 1));
      cueTimer = setTimeout(() => {
        cueTimer = null;
        if (started && mainAvailable()) emitTimedtext("cue-boundary", true);
      }, Math.max(0, ((Math.min(...boundaries) - time) / rate) * 1000));
    }

    function emitTimedtext(reason = "timedtext", force = false) {
      const mediaTime = Number(videoElement?.currentTime);
      const time = Number.isFinite(mediaTime) && mediaTime >= 0 ? mediaTime : 0;
      const snapshot = emitter.emit({
        source: SOURCE_KINDS.YOUTUBE_TIMEDTEXT,
        reason,
        mediaId: resolveMediaId(),
        mediaTime: time,
        track: mainTrack,
        cues: activeCuesAt(time)
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

    function readDomCues() {
      for (const selector of CAPTION_CONTAINER_SELECTORS) {
        const container = doc.querySelector?.(selector);
        if (!container) continue;
        const nodes = [];
        for (const segmentSelector of CAPTION_SEGMENT_SELECTORS) {
          for (const node of Array.from(container.querySelectorAll?.(segmentSelector) || [])) {
            if (!nodes.includes(node)) nodes.push(node);
          }
        }
        const text = cleanCueText(nodes.map((node) => node?.textContent).filter(Boolean).join(" "));
        if (text) return [{ id: "yt:dom:0", startTime: null, endTime: null, text }];
      }
      return [];
    }

    function emitDomSnapshot(reason = "dom-fallback", force = false) {
      const cues = readDomCues();
      const snapshot = emitter.emit({
        source: SOURCE_KINDS.YOUTUBE_DOM,
        reason,
        mediaId: resolveMediaId(),
        mediaTime: videoElement?.currentTime,
        track: { kind: "captions", label: "YouTube caption DOM", language: "", mode: "showing" },
        cues
      }, { force });
      if (cues.length) suppressNativeCaptionLayer();
      else restoreNativeCaptionLayer();
      return snapshot;
    }

    function refresh(reason = "refresh", force = false) {
      if (!started) return getSnapshot();
      syncPageIdentity();
      const bindingChanged = bindCurrentPlayer();
      if (mainAvailable()) return emitTimedtext(reason, force || bindingChanged);
      const textTrackSnapshot = textTrackSource?.getSnapshot?.();
      if (textTrackSnapshot?.cues?.length) return emitTextTrack(textTrackSnapshot, reason, force || bindingChanged);
      return emitDomSnapshot(reason, force || bindingChanged);
    }

    function suppressNativeCaptionLayer() {
      if (mode === "off") {
        restoreNativeCaptionLayer();
        return;
      }
      const roots = [playerRoot, doc];
      for (const root of roots) {
        for (const selector of CAPTION_CONTAINER_SELECTORS) {
          const node = root?.querySelector?.(selector);
          if (!node || hiddenNative.has(node)) continue;
          if (node.style) hiddenNative.set(node, node.style.visibility);
          node.style && (node.style.visibility = "hidden");
          node.setAttribute?.("data-tf-native-caption-hidden", "true");
        }
      }
    }

    function restoreNativeCaptionLayer() {
      for (const [node, visibility] of hiddenNative) {
        if (node.style) node.style.visibility = visibility || "";
        node.removeAttribute?.("data-tf-native-caption-hidden");
      }
      hiddenNative.clear();
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
      if (event.source !== win) return;
      const result = protocol.validateEnvelope(event.data, { direction: protocol.DIRECTIONS.MAIN_TO_ISOLATED });
      if (!result.ok) return;
      const message = result.value;
      const routeId = currentVideoId();
      if (message.type === "VIDEO_CHANGED") {
        if (routeId && message.videoId && routeId !== message.videoId) return;
        pageVideoId = message.videoId;
        mainGeneration = message.generation;
        mainReady = true;
        mainValid = false;
        mainCues = [];
        mainTrack = null;
        emitter.reset();
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
        if (mainTrack?.id && nextTrack?.id && mainTrack.id !== nextTrack.id) {
          mainValid = false;
          mainCues = [];
        }
        mainTrack = nextTrack;
        refresh("track-metadata", true);
      } else if (message.type === "TIMEDTEXT" && message.generation === mainGeneration) {
        mainReady = true;
        mainValid = true;
        mainCues = message.payload.cues;
        mainTrack = message.payload.track || mainTrack;
        emitTimedtext("timedtext", true);
      } else if (message.type === "ERROR" && message.generation === mainGeneration) {
        mainValid = false;
        mainCues = [];
        refresh("bridge-error", true);
      }
    }

    async function start() {
      if (started) return getSnapshot();
      started = true;
      pageVideoId = currentVideoId();
      for (const name of NAVIGATION_EVENTS) doc.addEventListener?.(name, onNavigation);
      win?.addEventListener?.("popstate", onPopState);
      win?.addEventListener?.("message", handleBridgeMessage);
      try { await install(); } catch {}
      if (!started) return getSnapshot();
      postHello();
      return refresh("start", true);
    }

    function stop() {
      if (!started) return;
      postToMain("STOP");
      started = false;
      for (const name of NAVIGATION_EVENTS) doc.removeEventListener?.(name, onNavigation);
      win?.removeEventListener?.("popstate", onPopState);
      win?.removeEventListener?.("message", handleBridgeMessage);
      observer?.disconnect?.();
      observer = null;
      clearTimeout(cueTimer);
      cueTimer = null;
      textTrackSource?.stop?.();
      textTrackSource = null;
      bindVideo(null);
      playerRoot = null;
      restoreNativeCaptionLayer();
      emitter.reset();
    }

    function setMode(nextMode) {
      mode = ["bilingual", "original", "off"].includes(nextMode) ? nextMode : "bilingual";
      if (started) {
        postHello();
        if (mode === "off") restoreNativeCaptionLayer();
        else refresh("mode-change", true);
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
