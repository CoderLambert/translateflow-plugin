(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.subtitleSource
    || !app.modules.textTrackSubtitleSource
    || app.modules.youtubeSubtitleSource
  ) return;

  const {
    SOURCE_KINDS,
    cleanCueText,
    normalizeSnapshot,
    createSnapshotEmitter
  } = app.modules.subtitleSource;
  const { createTextTrackSource } = app.modules.textTrackSubtitleSource;

  const PLAYER_SELECTORS = Object.freeze([
    "#movie_player",
    ".html5-video-player"
  ]);
  const VIDEO_SELECTORS = Object.freeze([
    "video.html5-main-video",
    "video"
  ]);
  const CAPTION_CONTAINER_SELECTORS = Object.freeze([
    "#ytp-caption-window-container",
    ".ytp-caption-window-container"
  ]);
  const CAPTION_SEGMENT_SELECTOR = ".ytp-caption-segment";
  const NAVIGATION_EVENTS = Object.freeze([
    "yt-navigate-finish",
    "yt-page-data-updated"
  ]);

  function parseYouTubeVideoId(rawUrl) {
    try {
      const url = new URL(rawUrl, "https://www.youtube.com/");
      const queryId = cleanCueText(url.searchParams.get("v"));
      if (queryId) return queryId;
      const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i);
      if (match?.[1]) return decodeURIComponent(match[1]);
      if (url.hostname === "youtu.be") return decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
      return "";
    } catch {
      return "";
    }
  }

  function createYouTubeSubtitleSource({
    document: doc = globalThis.document,
    window: win = globalThis.window,
    onSnapshot,
    preferredLanguage = ""
  } = {}) {
    if (!doc) throw new Error("YouTube subtitle source requires a document.");

    const emitter = createSnapshotEmitter(onSnapshot);
    let started = false;
    let playerRoot = null;
    let videoElement = null;
    let textTrackSource = null;
    let observer = null;

    const onMutation = () => refresh("dom-mutation");
    const onNavigation = () => refresh("spa-navigation", true);
    const onPopState = () => refresh("popstate", true);

    function resolveMediaId() {
      const videoId = parseYouTubeVideoId(win?.location?.href || "");
      if (videoId) return `youtube:${videoId}`;
      const currentSrc = cleanCueText(videoElement?.currentSrc || videoElement?.src);
      return currentSrc ? `youtube-media:${currentSrc}` : "youtube:unknown";
    }

    function findPlayerRoot() {
      return queryFirst(doc, PLAYER_SELECTORS) || doc.documentElement || doc.body || null;
    }

    function findVideoElement() {
      const scope = playerRoot || doc;
      return queryFirst(scope, VIDEO_SELECTORS) || queryFirst(doc, VIDEO_SELECTORS);
    }

    function syncObserver(nextRoot) {
      if (playerRoot === nextRoot && observer) return;
      observer?.disconnect?.();
      observer = null;
      playerRoot = nextRoot;

      const Observer = win?.MutationObserver || globalThis.MutationObserver;
      if (!started || !playerRoot || typeof Observer !== "function") return;
      observer = new Observer(onMutation);
      observer.observe(playerRoot, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    function syncVideo(nextVideo) {
      if (videoElement === nextVideo && textTrackSource) return;

      const previousSource = textTrackSource;
      textTrackSource = null;
      previousSource?.stop?.();
      videoElement = nextVideo || null;
      if (!videoElement) return;

      let source;
      source = createTextTrackSource({
        mediaElement: videoElement,
        preferredLanguage,
        mediaId: resolveMediaId,
        onSnapshot(snapshot) {
          if (!started || source !== textTrackSource || !source.isAvailable()) return;
          emitter.emit({
            ...snapshot,
            mediaId: resolveMediaId(),
            reason: `youtube-${snapshot.reason || "text-track"}`
          });
        }
      });
      textTrackSource = source;
      source.start();
    }

    function readDomCues() {
      for (const selector of CAPTION_CONTAINER_SELECTORS) {
        const container = doc.querySelector?.(selector);
        if (!container) continue;
        const segments = Array.from(container.querySelectorAll?.(CAPTION_SEGMENT_SELECTOR) || [])
          .map((node) => cleanCueText(node?.textContent))
          .filter(Boolean);
        const text = cleanCueText(segments.join(" "));
        if (text) return [{ text }];
      }
      return [];
    }

    function emitDomSnapshot(reason, force = false) {
      return emitter.emit({
        source: SOURCE_KINDS.YOUTUBE_DOM,
        reason,
        mediaId: resolveMediaId(),
        mediaTime: videoElement?.currentTime,
        track: {
          kind: "captions",
          label: "YouTube caption DOM",
          language: "",
          mode: "showing"
        },
        cues: readDomCues()
      }, { force });
    }

    function refresh(reason = "refresh", force = false) {
      const nextRoot = findPlayerRoot();
      syncObserver(nextRoot);
      syncVideo(findVideoElement());

      if (textTrackSource?.isAvailable()) {
        const snapshot = textTrackSource.refresh(reason);
        return emitter.getLastSnapshot() || normalizeSnapshot({
          ...snapshot,
          mediaId: resolveMediaId()
        });
      }
      return emitDomSnapshot(reason, force);
    }

    function start() {
      if (started) return emitter.getLastSnapshot() || refresh("start", true);
      started = true;
      for (const eventName of NAVIGATION_EVENTS) {
        doc.addEventListener?.(eventName, onNavigation);
      }
      win?.addEventListener?.("popstate", onPopState);
      return refresh("start", true);
    }

    function stop() {
      if (!started) return;
      started = false;
      for (const eventName of NAVIGATION_EVENTS) {
        doc.removeEventListener?.(eventName, onNavigation);
      }
      win?.removeEventListener?.("popstate", onPopState);
      observer?.disconnect?.();
      observer = null;
      playerRoot = null;
      const previousSource = textTrackSource;
      textTrackSource = null;
      previousSource?.stop?.();
      videoElement = null;
    }

    function getSnapshot() {
      return emitter.getLastSnapshot() || normalizeSnapshot({
        source: SOURCE_KINDS.YOUTUBE_DOM,
        reason: "idle",
        mediaId: resolveMediaId(),
        mediaTime: videoElement?.currentTime,
        cues: []
      });
    }

    function getMode() {
      return textTrackSource?.isAvailable() ? SOURCE_KINDS.TEXT_TRACK : SOURCE_KINDS.YOUTUBE_DOM;
    }

    return {
      kind: "youtube",
      start,
      stop,
      refresh,
      getSnapshot,
      getMode
    };
  }

  function queryFirst(root, selectors) {
    for (const selector of selectors) {
      const match = root?.querySelector?.(selector);
      if (match) return match;
    }
    return null;
  }

  app.modules.youtubeSubtitleSource = {
    PLAYER_SELECTORS,
    VIDEO_SELECTORS,
    CAPTION_CONTAINER_SELECTORS,
    CAPTION_SEGMENT_SELECTOR,
    parseYouTubeVideoId,
    createYouTubeSubtitleSource
  };
})();
