(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.tasks
    || !app?.modules.subtitleSource
    || app.modules.subtitlePipeline
  ) return;

  const { messages, sendRuntimeMessage } = app.modules.runtime;
  const tasks = app.modules.tasks;
  const { normalizeSnapshot, cleanCueText } = app.modules.subtitleSource;

  const DEFAULT_STABILITY_MS = 280;
  const DEFAULT_BATCH_DELAY_MS = 60;
  const DEFAULT_MAX_BATCH_ITEMS = 6;
  const DEFAULT_MAX_QUEUE = 24;

  function createSubtitlePipeline({
    onTranslation,
    onState,
    stabilityMs = DEFAULT_STABILITY_MS,
    batchDelayMs = DEFAULT_BATCH_DELAY_MS,
    maxBatchItems = DEFAULT_MAX_BATCH_ITEMS,
    maxQueue = DEFAULT_MAX_QUEUE,
    pageUrl = () => location.href,
    pageTitle = () => document.title,
    now = () => Date.now(),
    setTimer = (fn, delay) => setTimeout(fn, delay),
    clearTimer = (timer) => clearTimeout(timer)
  } = {}) {
    const candidates = new Map();
    const completed = new Set();
    const pending = [];
    let generation = 0;
    let mediaId = "";
    let sequence = 0;
    let stabilizationTimer = null;
    let batchTimer = null;
    let processing = false;
    let stopped = false;
    let activeTask = null;
    let blockedByError = false;
    let lastUntimedText = "";

    async function ingest(input) {
      if (stopped) return getState();
      const snapshot = normalizeSnapshot(input);
      if (snapshot.mediaId !== mediaId) {
        await switchMedia(snapshot.mediaId);
      }

      const observedAt = Number(snapshot.observedAt) || now();
      const timed = [];
      const untimed = [];
      for (const cue of snapshot.cues) {
        if (cue.startTime !== null || cue.endTime !== null) timed.push(cue);
        else untimed.push(cue);
      }

      for (const cue of timed) {
        updateCandidate(candidateKey(cue), snapshot, cue, observedAt);
      }
      if (untimed.length) {
        const text = cleanCueText(untimed.map((cue) => cue.text).join(" "));
        updateUntimedCandidate(snapshot, text, observedAt);
      } else if (lastUntimedText && candidates.has("rolling")) {
        finalizeCandidate("rolling");
      }

      blockedByError = false;
      scheduleStabilization();
      if (pending.length) scheduleBatch();
      publishState();
      return getState();
    }

    function updateCandidate(key, snapshot, cue, observedAt) {
      const previous = candidates.get(key);
      if (previous?.cue.text === cue.text) return;
      candidates.set(key, {
        key,
        snapshot,
        cue,
        firstSeenAt: previous?.firstSeenAt || observedAt,
        updatedAt: observedAt
      });
    }

    function updateUntimedCandidate(snapshot, text, observedAt) {
      if (!text) return;
      const previous = candidates.get("rolling");
      if (previous?.cue.text === text) return;
      if (!previous && text === lastUntimedText) return;

      if (previous && !isRollingContinuation(previous.cue.text, text)) {
        finalizeCandidate("rolling");
      }

      candidates.set("rolling", {
        key: "rolling",
        snapshot,
        cue: {
          id: "",
          startTime: null,
          endTime: null,
          text
        },
        firstSeenAt: observedAt,
        updatedAt: observedAt
      });
    }

    function isRollingContinuation(previous, next) {
      const a = cleanCueText(previous);
      const b = cleanCueText(next);
      return Boolean(a && b && (b.startsWith(a) || a.startsWith(b)));
    }

    function candidateKey(cue) {
      const start = cue.startTime === null ? "na" : Number(cue.startTime).toFixed(3);
      const end = cue.endTime === null ? "na" : Number(cue.endTime).toFixed(3);
      const id = cleanCueText(cue.id);
      const generated = id.match(/^[^:]+:[^:]+:[^:]+:(\d+):[^:]+$/);
      const slot = generated?.[1] ?? id;
      return `timed:${start}:${end}:${slot}`;
    }

    function scheduleStabilization() {
      clearTimer(stabilizationTimer);
      stabilizationTimer = null;
      if (!candidates.size) return;

      let earliest = Infinity;
      const current = now();
      for (const candidate of candidates.values()) {
        earliest = Math.min(earliest, candidate.updatedAt + Math.max(0, stabilityMs));
      }
      const delay = Math.max(0, earliest - current);
      stabilizationTimer = setTimer(() => {
        stabilizationTimer = null;
        flushStableCandidates(false);
      }, delay);
    }

    function flushStableCandidates(force = false, { schedule = true } = {}) {
      const current = now();
      for (const [key, candidate] of [...candidates]) {
        if (!force && current < candidate.updatedAt + Math.max(0, stabilityMs)) continue;
        finalizeCandidate(key);
      }
      if (candidates.size) scheduleStabilization();
      if (schedule) scheduleBatch();
      publishState();
    }

    function finalizeCandidate(key) {
      const candidate = candidates.get(key);
      if (!candidate) return;
      candidates.delete(key);

      const unit = createUnit(candidate);
      if (!unit) return;
      if (completed.has(unit.fingerprint)) return;
      if (pending.some((item) => item.fingerprint === unit.fingerprint)) return;

      if (key === "rolling") lastUntimedText = unit.text;
      pending.push(unit);
      if (pending.length > Math.max(1, maxQueue)) {
        pending.splice(0, pending.length - Math.max(1, maxQueue));
      }
    }

    function createUnit(candidate) {
      const snapshot = candidate.snapshot;
      const cue = candidate.cue;
      const text = cleanCueText(cue.text);
      if (!text || !snapshot.mediaId) return null;

      sequence += 1;
      const track = snapshot.track ? {
        id: cleanCueText(snapshot.track.id),
        kind: cleanCueText(snapshot.track.kind),
        label: cleanCueText(snapshot.track.label),
        language: cleanCueText(snapshot.track.language).toLowerCase(),
        autoGenerated: snapshot.track.autoGenerated === true ? true : null
      } : null;
      const position = candidate.key === "rolling"
        ? `seq:${sequence}`
        : candidate.key;
      const fingerprint = [
        snapshot.mediaId,
        snapshot.source,
        track?.id || "",
        track?.language || "",
        position,
        text
      ].join("|");

      return {
        id: `subtitle-${generation}-${sequence}`,
        mediaId: snapshot.mediaId,
        source: snapshot.source,
        track,
        cue: {
          id: cleanCueText(cue.id),
          startTime: cue.startTime,
          endTime: cue.endTime
        },
        sequence,
        fingerprint,
        text
      };
    }

    function isUntimedUnit(unit) {
      return unit?.cue?.startTime === null && unit?.cue?.endTime === null;
    }

    function scheduleBatch() {
      if (!pending.length || processing || stopped || blockedByError) return;
      clearTimer(batchTimer);
      batchTimer = null;

      if (pending.length >= Math.max(1, maxBatchItems)) {
        void processQueue();
        return;
      }
      batchTimer = setTimer(() => {
        batchTimer = null;
        void processQueue();
      }, Math.max(0, batchDelayMs));
    }

    async function processQueue() {
      if (processing || stopped) return;
      processing = true;
      clearTimer(batchTimer);
      batchTimer = null;

      try {
        while (pending.length && !stopped) {
          const batchGeneration = generation;
          const batch = pending.splice(0, Math.max(1, maxBatchItems));
          activeTask = tasks.createTask({
            surface: "subtitle",
            pageUrl: pageUrl(),
            total: batch.length
          });
          tasks.transition(activeTask, "cache_lookup");

          let response;
          try {
            response = await sendRuntimeMessage({
              type: messages.background.SUBTITLE_TRANSLATE_BATCH,
              requestId: activeTask.id,
              pageUrl: pageUrl(),
              pageTitle: pageTitle(),
              units: batch
            });
            tasks.assertActive(activeTask);
            if (!response?.ok) throw tasks.responseError(response, "字幕翻译失败");

            if (batchGeneration !== generation || stopped) {
              tasks.completeTask(activeTask, { done: batch.length });
              continue;
            }

            const byId = new Map((response.translations || []).map((item) => [String(item.id), item]));
            for (const unit of batch) {
              const result = byId.get(unit.id);
              if (!result?.text) {
                if (isUntimedUnit(unit) && lastUntimedText === unit.text) lastUntimedText = "";
                continue;
              }
              completed.add(unit.fingerprint);
              if (typeof onTranslation === "function") {
                onTranslation({
                  unit,
                  translation: result.text,
                  cacheHit: Boolean(result.cacheHit)
                });
              }
            }
            tasks.completeTask(activeTask, {
              done: batch.length,
              cacheHits: Number(response.cacheHits || 0),
              apiTranslated: Number(response.apiTranslated || 0)
            });
          } catch (error) {
            tasks.failTask(activeTask, error);
            if (!tasks.isCancelledError(error) && batchGeneration === generation && !stopped) {
              pending.unshift(...batch);
              blockedByError = true;
              return;
            }
          } finally {
            activeTask = null;
            publishState();
          }
        }
      } finally {
        processing = false;
        if (pending.length && !stopped && !blockedByError) scheduleBatch();
      }
    }

    async function switchMedia(nextMediaId) {
      generation += 1;
      mediaId = cleanCueText(nextMediaId);
      candidates.clear();
      completed.clear();
      pending.splice(0);
      lastUntimedText = "";
      sequence = 0;
      clearTimer(stabilizationTimer);
      stabilizationTimer = null;
      clearTimer(batchTimer);
      batchTimer = null;

      if (activeTask && !tasks.isTerminal(activeTask)) {
        await tasks.cancelTask(activeTask);
      }
      publishState();
    }

    async function flush({ force = true } = {}) {
      if (stopped) return getState();
      blockedByError = false;
      flushStableCandidates(Boolean(force), { schedule: false });
      clearTimer(batchTimer);
      batchTimer = null;
      await processQueue();
      return getState();
    }

    async function stop() {
      if (stopped) return;
      stopped = true;
      generation += 1;
      candidates.clear();
      pending.splice(0);
      clearTimer(stabilizationTimer);
      stabilizationTimer = null;
      clearTimer(batchTimer);
      batchTimer = null;
      if (activeTask && !tasks.isTerminal(activeTask)) {
        await tasks.cancelTask(activeTask);
      }
      activeTask = null;
      publishState();
    }

    function getState() {
      return {
        mediaId,
        generation,
        candidates: candidates.size,
        queued: pending.length,
        processing,
        blockedByError,
        stopped,
        task: activeTask ? tasks.getTaskStatus(activeTask) : null
      };
    }

    function publishState() {
      if (typeof onState === "function") onState(getState());
    }

    return {
      ingest,
      flush,
      stop,
      getState
    };
  }

  app.modules.subtitlePipeline = {
    DEFAULT_STABILITY_MS,
    DEFAULT_BATCH_DELAY_MS,
    DEFAULT_MAX_BATCH_ITEMS,
    DEFAULT_MAX_QUEUE,
    createSubtitlePipeline
  };
})();
