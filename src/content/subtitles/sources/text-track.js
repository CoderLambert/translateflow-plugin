(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.subtitleSource || app.modules.textTrackSubtitleSource) return;

  const {
    SOURCE_KINDS,
    normalizeSnapshot,
    createSnapshotEmitter
  } = app.modules.subtitleSource;

  function listTracks(trackList) {
    if (!trackList || !Number.isFinite(Number(trackList.length))) return [];
    return Array.from({ length: Number(trackList.length) }, (_, index) => (
      trackList[index] ?? trackList.item?.(index) ?? null
    )).filter(Boolean);
  }

  function listCues(cueList) {
    if (!cueList || !Number.isFinite(Number(cueList.length))) return [];
    return Array.from({ length: Number(cueList.length) }, (_, index) => (
      cueList[index] ?? cueList.item?.(index) ?? null
    )).filter(Boolean);
  }

  function isSubtitleTrack(track) {
    const kind = String(track?.kind || "").toLowerCase();
    return kind === "captions" || kind === "subtitles";
  }

  function isEnabledTrack(track) {
    const mode = String(track?.mode || "").toLowerCase();
    return isSubtitleTrack(track) && (mode === "hidden" || mode === "showing");
  }

  function pickTextTrack(mediaElement, preferredLanguage = "") {
    const targetLanguage = String(preferredLanguage || "").toLowerCase();
    const candidates = listTracks(mediaElement?.textTracks).filter(isEnabledTrack);
    if (!candidates.length) return null;

    return candidates
      .map((track, index) => ({
        track,
        index,
        languageMatch: targetLanguage && String(track.language || "").toLowerCase() === targetLanguage ? 1 : 0,
        showing: String(track.mode || "").toLowerCase() === "showing" ? 1 : 0
      }))
      .sort((a, b) => (
        b.languageMatch - a.languageMatch
        || b.showing - a.showing
        || a.index - b.index
      ))[0].track;
  }

  function createTextTrackSource({
    mediaElement,
    onSnapshot,
    mediaId = "",
    preferredLanguage = ""
  } = {}) {
    if (!mediaElement) throw new Error("TextTrack source requires a mediaElement.");

    const emitter = createSnapshotEmitter(onSnapshot);
    let started = false;
    let activeTrack = null;

    const onCueChange = () => emit("cuechange");
    const onMediaUpdate = () => emit("media-update");
    const onTrackListChange = () => emit("track-list-change", true);

    function resolveMediaId() {
      if (typeof mediaId === "function") return String(mediaId() || "");
      if (mediaId) return String(mediaId);
      return String(mediaElement.currentSrc || mediaElement.src || "");
    }

    function syncTrackListener(nextTrack) {
      if (activeTrack === nextTrack) return;
      removeListener(activeTrack, "cuechange", onCueChange);
      activeTrack = nextTrack;
      addListener(activeTrack, "cuechange", onCueChange);
    }

    function emit(reason = "update", force = false) {
      const nextTrack = pickTextTrack(mediaElement, preferredLanguage);
      syncTrackListener(nextTrack);
      return emitter.emit({
        source: SOURCE_KINDS.TEXT_TRACK,
        reason,
        mediaId: resolveMediaId(),
        mediaTime: mediaElement.currentTime,
        track: nextTrack,
        cues: nextTrack ? listCues(nextTrack.activeCues) : []
      }, { force });
    }

    function start() {
      if (started) return emitter.getLastSnapshot() || emit("start", true);
      started = true;
      addListener(mediaElement, "timeupdate", onMediaUpdate);
      addListener(mediaElement, "loadedmetadata", onMediaUpdate);
      addListener(mediaElement, "emptied", onMediaUpdate);
      addListener(mediaElement?.textTracks, "addtrack", onTrackListChange);
      addListener(mediaElement?.textTracks, "removetrack", onTrackListChange);
      addListener(mediaElement?.textTracks, "change", onTrackListChange);
      return emit("start", true);
    }

    function stop() {
      if (!started) return;
      started = false;
      removeListener(mediaElement, "timeupdate", onMediaUpdate);
      removeListener(mediaElement, "loadedmetadata", onMediaUpdate);
      removeListener(mediaElement, "emptied", onMediaUpdate);
      removeListener(mediaElement?.textTracks, "addtrack", onTrackListChange);
      removeListener(mediaElement?.textTracks, "removetrack", onTrackListChange);
      removeListener(mediaElement?.textTracks, "change", onTrackListChange);
      syncTrackListener(null);
    }

    function refresh(reason = "refresh") {
      return emit(reason, true);
    }

    function isAvailable() {
      return Boolean(pickTextTrack(mediaElement, preferredLanguage));
    }

    function getSnapshot() {
      return emitter.getLastSnapshot() || normalizeSnapshot({
        source: SOURCE_KINDS.TEXT_TRACK,
        reason: "idle",
        mediaId: resolveMediaId(),
        mediaTime: mediaElement.currentTime,
        track: pickTextTrack(mediaElement, preferredLanguage),
        cues: []
      });
    }

    return {
      kind: SOURCE_KINDS.TEXT_TRACK,
      start,
      stop,
      refresh,
      isAvailable,
      getSnapshot
    };
  }

  function addListener(target, type, listener) {
    target?.addEventListener?.(type, listener);
  }

  function removeListener(target, type, listener) {
    target?.removeEventListener?.(type, listener);
  }

  app.modules.textTrackSubtitleSource = {
    listTracks,
    listCues,
    isSubtitleTrack,
    isEnabledTrack,
    pickTextTrack,
    createTextTrackSource
  };
})();
