(() => {
  const page = globalThis;
  const protocol = page.__TRANSLATE_FLOW_YOUTUBE_BRIDGE_PROTOCOL__;
  const timedtext = page.__TRANSLATE_FLOW_YOUTUBE_TIMEDTEXT__;
  const GLOBAL = "__TRANSLATE_FLOW_YOUTUBE_MAIN_BRIDGE__";
  const BRIDGE_VERSION = 1;
  if (!protocol || !timedtext) return;

  const existing = page[GLOBAL];
  if (existing?.version === BRIDGE_VERSION) {
    existing.reannounce?.();
    return;
  }

  const state = {
    active: false,
    mode: "bilingual",
    videoId: "",
    generation: 0,
    trackRevision: 0,
    player: null,
    video: null,
    track: null,
    selectedRaw: null,
    rawTracks: [],
    captured: false,
    nudged: false,
    nudgeTimer: null,
    navigationTimer: null,
    mutationObserver: null,
    performanceObserver: null,
    observing: false,
    tracksSignature: "",
    originalFetch: null,
    fetchWrapper: null,
    xhrPrototype: null,
    originalXhrOpen: null, originalXhrSend: null,
    xhrOpenWrapper: null,
    xhrSendWrapper: null,
    xhrRequests: new Map(),
    resourceUrl: ""
  };
  const bodyReader = timedtext.createBodyReader();
  function clean(value) { return String(value ?? "").trim(); }
  function safeCall(fn, receiver, ...args) {
    try { return typeof fn === "function" ? fn.apply(receiver, args) : undefined; } catch { return undefined; }
  }
  function isTimedtextUrl(rawUrl) { return /(?:^|\/)api\/timedtext(?:[/?]|$)/i.test(String(rawUrl || "")); }
  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input?.url) return String(input.url);
    return "";
  }
  function locationVideoId() {
    try {
      const url = new URL(page.location?.href || "", page.location?.origin || "https://www.youtube.com");
      const query = clean(url.searchParams.get("v"));
      if (query) return query;
      const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/i);
      return match?.[1] ? decodeURIComponent(match[1]) : "";
    } catch { return ""; }
  }
  function findPlayer() {
    const query = page.document?.querySelector?.bind(page.document);
    if (/^\/shorts\//i.test(String(page.location?.pathname || ""))) return query?.("#shorts-player") || query?.("ytd-reel-video-renderer[is-active] .html5-video-player") || query?.(".html5-video-player") || null;
    return query?.("#movie_player") || query?.(".html5-video-player") || null;
  }
  function findVideo(player) {
    return player?.querySelector?.("video.html5-main-video")
      || player?.querySelector?.("video")
      || page.document?.querySelector?.("video.html5-main-video")
      || page.document?.querySelector?.("video")
      || null;
  }
  function readPlayerVideoId(player) {
    const data = safeCall(player?.getVideoData, player);
    return clean(data?.video_id || data?.videoId || data?.video_id_raw);
  }
  function readSelectedRaw(player) {
    return safeCall(player?.getOption, player, "captions", "track") || null;
  }
  function readRawTracks(player) {
    const audio = safeCall(player?.getAudioTrack, player);
    const fromAudio = Array.isArray(audio?.captionTracks) ? audio.captionTracks : [];
    const selected = readSelectedRaw(player);
    const all = [...fromAudio, ...(selected ? [selected] : []), ...(page.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [])];
    const seen = new Set();
    return all.filter((track) => {
      const identity = timedtext.trackIdentity(track);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }
  function normalizedTrack(raw) { return raw ? timedtext.normalizeTrackMetadata(raw) : null; }
  function post(type, payload = {}, identity = {}) {
    protocol.post(page, {
      direction: protocol.DIRECTIONS.MAIN_TO_ISOLATED,
      type,
      videoId: identity.videoId ?? state.videoId,
      generation: identity.generation ?? state.generation,
      observedAt: Date.now(),
      payload
    });
  }
  function resolveState(reason = "refresh") {
    if (!state.active || state.mode === "off") return false;
    const player = findPlayer();
    const video = findVideo(player);
    const bindingChanged = state.player !== player || state.video !== video;
    const nextId = locationVideoId() || readPlayerVideoId(player);
    if (!nextId) return false;
    if (state.videoId !== nextId) {
      bodyReader.cancelAll();
      state.videoId = nextId;
      state.generation += 1;
      state.captured = false;
      state.nudged = false;
      state.track = null;
      state.selectedRaw = null;
      state.rawTracks = [];
      clearTimeout(state.nudgeTimer);
      state.nudgeTimer = null;
      post("VIDEO_CHANGED", { reason });
    }

    state.player = player;
    bindVideo(video);
    const selectedRaw = readSelectedRaw(player);
    const rawTracks = readRawTracks(player);
    const nextRaw = selectedRaw || rawTracks[0] || null;
    const nextTrack = normalizedTrack(nextRaw);
    const changed = nextTrack?.id !== state.track?.id;
    state.selectedRaw = selectedRaw;
    state.rawTracks = rawTracks;
    if (changed) { state.trackRevision += 1; bodyReader.cancelAll(); }
    state.track = nextTrack;
    publishTracks(reason, bindingChanged);
    return true;
  }
  function publishTracks(reason = "tracks", force = false) {
    const payload = {
      reason,
      tracks: state.rawTracks.map(normalizedTrack).filter(Boolean),
      selected: state.track
    };
    const signature = JSON.stringify([state.videoId, state.generation, payload.tracks, payload.selected]);
    if (!force && signature === state.tracksSignature) return;
    state.tracksSignature = signature;
    post("TRACKS", payload);
  }
  function captureContext(url) {
    resolveState("request");
    let query;
    try { query = new URL(url, page.location.href).searchParams; } catch { return null; }
    const language = clean(query.get("lang")).toLowerCase(), kind = clean(query.get("kind"));
    if (language && (language !== state.track?.language || (kind === "asr") !== (state.track?.autoGenerated === true))) return null;
    if (kind && kind !== state.track?.kind) return null;
    return { videoId: state.videoId, generation: state.generation, trackRevision: state.trackRevision, track: state.track, url };
  }
  function isCurrentContext(context) {
    resolveState("response");
    return state.active
      && context?.videoId
      && context.videoId === state.videoId
      && context.generation === state.generation
      && context.trackRevision === state.trackRevision;
  }
  function handleTimedtext(body, context, url, contentType = "") {
    if (!isCurrentContext(context)) return;
    const parsed = timedtext.parseTimedtext(body, { contentType });
    if (!parsed.ok) {
      post("ERROR", { code: parsed.errorCode, message: parsed.errorMessage }, context);
      return;
    }
    if (!isCurrentContext(context)) return;
    state.captured = true;
    clearTimeout(state.nudgeTimer);
    state.nudgeTimer = null;
    post("TIMEDTEXT", {
      format: parsed.format,
      cues: parsed.cues,
      track: context.track,
      requestUrl: clean(url).slice(0, 2048)
    }, context);
  }
  function observeFetchResponse(response, context, url) {
    if (!isCurrentContext(context) || !response || typeof response.clone !== "function") return;
    let clone;
    try { clone = response.clone(); } catch { return; }
    try {
      const contentType = clone.headers?.get?.("content-type") || response.headers?.get?.("content-type") || "";
      bodyReader.read(clone, {
        isCurrent: () => isCurrentContext(context),
        onTooLarge: () => post("ERROR", { code: "payload-too-large", message: "Timedtext payload exceeds 2 MiB." }, context)
      }).then((body) => {
        if (body !== null) handleTimedtext(body, context, url, contentType);
      }, () => {});
    } catch {}
  }
  function installFetch() {
    const original = page.fetch;
    if (typeof original !== "function" || state.fetchWrapper) return;
    const wrapper = function translateFlowYouTubeFetchWrapper(...args) {
      const url = requestUrl(args[0]);
      const context = isTimedtextUrl(url) ? captureContext(url) : null;
      let result;
      try { result = original.apply(this, args); } catch (error) { throw error; }
      if (context) Promise.resolve(result).then((response) => observeFetchResponse(response, context, url), () => {});
      return result;
    };
    state.originalFetch = original;
    state.fetchWrapper = wrapper;
    try { page.fetch = wrapper; } catch { state.fetchWrapper = null; state.originalFetch = null; }
  }
  function detachXhr(xhr) {
    const listener = state.xhrRequests.get(xhr);
    if (listener) xhr.removeEventListener?.("loadend", listener);
    state.xhrRequests.delete(xhr);
    delete xhr.__translateFlowYouTubeRequest;
    delete xhr.__translateFlowYouTubeObserved;
  }
  function installXhr() {
    const prototype = page.XMLHttpRequest?.prototype;
    if (!prototype || state.xhrOpenWrapper) return;
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    if (typeof originalOpen !== "function" || typeof originalSend !== "function") return;
    const openWrapper = function translateFlowYouTubeXhrOpen(method, url, ...rest) {
      detachXhr(this);
      const value = originalOpen.call(this, method, url, ...rest);
      const rawUrl = requestUrl(url);
      this.__translateFlowYouTubeRequest = isTimedtextUrl(rawUrl) ? captureContext(rawUrl) : null;
      this.__translateFlowYouTubeObserved = false;
      return value;
    };
    const sendWrapper = function translateFlowYouTubeXhrSend(...args) {
      const context = this.__translateFlowYouTubeRequest;
      if (context && !this.__translateFlowYouTubeObserved && typeof this.addEventListener === "function") {
        this.__translateFlowYouTubeObserved = true;
        const onLoadEnd = () => {
          detachXhr(this);
          const body = timedtext.readXhrBody(this);
          if (body !== null) handleTimedtext(body, context, context.url, this.getResponseHeader?.("content-type") || "");
        };
        state.xhrRequests.set(this, onLoadEnd);
        this.addEventListener("loadend", onLoadEnd, { once: true });
      }
      try { return originalSend.apply(this, args); }
      catch (error) {
        detachXhr(this);
        throw error;
      }
    };
    state.xhrPrototype = prototype;
    state.originalXhrOpen = originalOpen;
    state.originalXhrSend = originalSend;
    state.xhrOpenWrapper = openWrapper;
    state.xhrSendWrapper = sendWrapper;
    try {
      prototype.open = openWrapper;
      prototype.send = sendWrapper;
    } catch { state.xhrOpenWrapper = null; state.xhrSendWrapper = null; }
  }
  function observeResources(entries = []) {
    if (!state.active || state.mode === "off") return;
    for (const entry of entries) {
      const url = entry?.name || "";
      if (isTimedtextUrl(url)) {
        state.resourceUrl = url;
        resolveState("resource-timing");
      }
    }
  }
  function installResourceTiming() {
    if (!state.active || state.mode === "off" || state.performanceObserver) return;
    observeResources(page.performance?.getEntriesByType?.("resource") || []);
    const Observer = page.PerformanceObserver;
    if (typeof Observer !== "function") return;
    try {
      state.performanceObserver = new Observer((list) => observeResources(list.getEntries?.() || []));
      state.performanceObserver.observe({ type: "resource", buffered: true });
    } catch { state.performanceObserver?.disconnect?.(); state.performanceObserver = null; }
  }
  function selectedNudgeTrack() {
    return timedtext.selectNudgeTrack(state.selectedRaw, state.rawTracks);
  }
  function nudgeOnce() {
    if (!state.active || state.mode === "off" || state.nudged || state.captured) return false;
    state.nudged = true;
    const player = state.player || findPlayer();
    const generation = state.generation;
    const applyTrack = () => {
      if (!state.active || state.mode === "off" || generation !== state.generation) return;
      resolveState("nudge");
      if (generation !== state.generation) return;
      const selection = timedtext.nudgeTrackSelection(selectedNudgeTrack());
      if (selection && typeof player?.setOption === "function") safeCall(player.setOption, player, "captions", "track", selection);
    };
    const loaded = safeCall(player?.loadModule, player, "captions");
    if (loaded && typeof loaded.then === "function") loaded.then(applyTrack, applyTrack); else applyTrack();
    return true;
  }
  function scheduleNudge() {
    clearTimeout(state.nudgeTimer);
    state.nudgeTimer = null;
    if (state.mode === "off" || state.captured || state.nudged) return;
    state.nudgeTimer = setTimeout(() => {
      state.nudgeTimer = null;
      if (!state.captured) nudgeOnce();
    }, 1000);
  }
  function scheduleResolve() {
    if (!state.active || state.mode === "off" || state.navigationTimer) return;
    state.navigationTimer = setTimeout(() => {
      state.navigationTimer = null;
      if (!state.active || state.mode === "off") return;
      resolveState("navigation");
      if (state.active && state.mode !== "off" && !state.captured) scheduleNudge();
    }, 0);
  }
  function onMessage(event) {
    if (event.source !== page) return;
    const result = protocol.validateEnvelope(event.data, { direction: protocol.DIRECTIONS.ISOLATED_TO_MAIN });
    if (!result.ok) return;
    const message = result.value;
    if (message.type === "HELLO") {
      state.mode = message.payload.mode || "bilingual";
      if (state.mode === "off") { teardown(); return; }
      installObservers(); installFetch(); installXhr();
      resolveState("hello");
      post("READY", {});
      publishTracks("hello", true);
      installResourceTiming();
      scheduleNudge();
    } else if (message.type === "NUDGE") {
      nudgeOnce();
    } else if (message.type === "STOP") {
      teardown();
    }
  }
  function bindVideo(video) {
    if (state.video === video) return;
    const previous = state.video;
    for (const name of ["loadedmetadata", "loadstart", "durationchange", "emptied"]) previous?.removeEventListener?.(name, scheduleResolve);
    state.video = video || null;
    for (const name of ["loadedmetadata", "loadstart", "durationchange", "emptied"]) state.video?.addEventListener?.(name, scheduleResolve);
  }
  function installObservers() {
    if (state.observing) return;
    state.observing = true;
    for (const name of ["yt-navigate-finish", "yt-page-data-updated"]) page.document?.addEventListener?.(name, scheduleResolve);
    page.addEventListener?.("popstate", scheduleResolve);
    const Observer = page.MutationObserver;
    if (typeof Observer === "function" && page.document?.documentElement) {
      try {
        state.mutationObserver = new Observer(records => {
          // Ignore outside mutations. Player DOM can reveal a cached track
          // change without another timedtext request; metadata itself is deduped.
          if (state.player?.isConnected && state.video?.isConnected && state.player.contains?.(state.video)
            && !records.some(record => state.player.contains(record.target))) return;
          scheduleResolve();
        });
        state.mutationObserver.observe(page.document.documentElement, { childList: true, subtree: true });
      } catch { state.mutationObserver = null; }
    }
  }
  function restoreHooks() {
    bodyReader.cancelAll();
    for (const xhr of state.xhrRequests.keys()) detachXhr(xhr);
    if (state.fetchWrapper && page.fetch === state.fetchWrapper) page.fetch = state.originalFetch;
    const prototype = state.xhrPrototype;
    if (prototype?.open === state.xhrOpenWrapper) prototype.open = state.originalXhrOpen;
    if (prototype?.send === state.xhrSendWrapper) prototype.send = state.originalXhrSend;
    state.originalFetch = state.fetchWrapper = null;
    state.xhrPrototype = state.originalXhrOpen = state.originalXhrSend = null;
    state.xhrOpenWrapper = state.xhrSendWrapper = null;
  }
  function teardown() {
    if (!state.active) return;
    state.active = false;
    clearTimeout(state.nudgeTimer);
    clearTimeout(state.navigationTimer);
    state.nudgeTimer = state.navigationTimer = null;
    for (const name of ["yt-navigate-finish", "yt-page-data-updated"]) page.document?.removeEventListener?.(name, scheduleResolve);
    page.removeEventListener?.("popstate", scheduleResolve);
    state.mutationObserver?.disconnect?.();
    state.performanceObserver?.disconnect?.();
    state.mutationObserver = state.performanceObserver = null;
    state.observing = false;
    bindVideo(null); state.player = null;
    state.track = state.selectedRaw = null; state.rawTracks = [];
    state.tracksSignature = ""; state.resourceUrl = "";
    page.removeEventListener?.("message", onMessage);
    restoreHooks();
    state.generation += 1;
    state.captured = false;
    state.nudged = false;
  }
  function start() {
    if (state.active) {
      resolveState("reannounce");
      post("READY", {});
      return;
    }
    state.active = true;
    page.addEventListener?.("message", onMessage);
    installObservers();
    installFetch();
    installXhr();
    installResourceTiming();
    resolveState("install");
    post("READY", {});
  }

  const bridge = { version: BRIDGE_VERSION, start, stop: teardown, reannounce: start, getState: () => ({ ...state, xhrRequests: undefined }) };
  page[GLOBAL] = bridge;
  start();
})();
