import { readFileSync } from "node:fs";
import vm from "node:vm";

export const tick = () => new Promise(resolve => setImmediate(resolve));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Actual Task/Source/Pipeline/Controller; only transport, media source and renderer are doubles. */
export function createFixture({ mode = "bilingual", translate, saveSettings, getSettings, getContext, cancelRequest, video = null, pipelineOptions = {} } = {}) {
  const requests = [], cancelled = [], pipelines = [], sources = [], views = [];
  let taskSequence = 0;
  const runtime = {
    messages: { background: Object.fromEntries(["PUBLIC_SETTINGS_GET", "PUBLIC_SETTINGS_SET", "EFFECTIVE_CONTEXT",
      "TEMP_PRESET_SET", "SUBTITLE_TRANSLATE_BATCH", "CACHE_PRUNE", "CANCEL_TRANSLATION"].map(key => [key, key])) },
    async sendRuntimeMessage(message) {
      if (message.type === "PUBLIC_SETTINGS_GET") return getSettings ? getSettings(message)
        : { ok: true, settings: { youtubeSubtitleMode: mode } };
      if (message.type === "PUBLIC_SETTINGS_SET") return saveSettings ? saveSettings(message) : { ok: true };
      if (["EFFECTIVE_CONTEXT", "TEMP_PRESET_SET"].includes(message.type)) return getContext ? getContext(message) : { ok: true, context: {} };
      if (message.type === "CANCEL_TRANSLATION") { cancelled.push(message.requestId); return cancelRequest ? cancelRequest(message) : { ok: true, cancelled: true }; }
      if (message.type === "CACHE_PRUNE") return { ok: true };
      requests.push(message);
      return translate ? translate(message) : translated(message);
    }
  };
  function rendererFactory() {
    const view = { original: "", translation: "", status: "", mounted: false };
    views.push(view);
    return {
      mount() { view.mounted = true; }, unmount() { view.mounted = false; },
      setMode(value) { view.mode = value; return value; }, setSize(value) { return value; },
      renderOriginal(value) { view.original = value; }, renderTranslation(value) { view.translation = value; },
      clear() { view.original = view.translation = view.status = ""; },
      setStatus(value) { view.status = value; }, setStatusKey(value) { view.status = value; }, setPresetContext() {}
    };
  }
  function sourceFactory({ onSnapshot }) {
    const source = {
      last: null, stopped: false, mode,
      async start() {}, stop() { this.stopped = true; },
      setMode(value) { this.mode = value; },
      refresh(reason) { if (this.last && !this.stopped) onSnapshot({ ...this.last, reason }); },
      emit(input) { this.last = modules.subtitleSource.normalizeSnapshot(input); onSnapshot(this.last); }
    };
    sources.push(source); return source;
  }
  const modules = { runtime, contentI18n: { t: key => key },
    youtubeSubtitleSource: { createYouTubeSubtitleSource: sourceFactory, PLAYER_SELECTORS: ["#movie_player"] },
    subtitleRenderer: { createSubtitleRenderer: rendererFactory, MODES: ["bilingual", "original", "off"], SIZES: ["standard"] } };
  const context = vm.createContext({ console, Date, setTimeout, clearTimeout, crypto: { randomUUID: () => `subtitle-test-${++taskSequence}` },
    location: { href: "https://www.youtube.com/watch?v=example", hostname: "www.youtube.com", pathname: "/watch" },
    document: { title: "fixture", querySelector: () => ({ querySelector: () => video }) }, __TRANSLATE_FLOW_CONTENT__: { modules } });
  for (const name of ["tasks", "subtitles/source", "subtitles/pipeline", "subtitles/controller"]) {
    const path = new URL(`../../src/content/${name}.js`, import.meta.url);
    vm.runInContext(readFileSync(path, "utf8"), context, { filename: path.pathname });
  }
  const controller = modules.subtitleControllerFactory.createController({
    isSupportedPage: () => true, sourceFactory, rendererFactory,
    pipelineFactory(options) {
      const pipeline = modules.subtitlePipeline.createSubtitlePipeline({ ...options,
        setTimer: () => 1, clearTimer() {}, ...pipelineOptions });
      pipelines.push(pipeline); return pipeline;
    }
  });
  return { controller, requests, cancelled, pipelines, sources, modules,
    get view() { return views.at(-1); },
    emit(input) { sources.at(-1).emit(input); },
    async flush() { await tick(); await pipelines.at(-1)?.flush(); }
  };
}

export function translated(message, prefix = "T:") {
  return { ok: true, cacheHits: 0, apiTranslated: message.units.length,
    translations: message.units.map(unit => ({ id: unit.id, text: `${prefix}${unit.text}` })) };
}
export const cue = (id, startTime, text = id) => ({ id, startTime, endTime: startTime + 1, text });
export function snapshot(cues, extra = {}) {
  return { source: "youtube-timedtext", mediaId: "youtube:fixture", mediaTime: cues[0]?.startTime ?? 0,
    observedAt: Date.now(), track: { id: "en", language: "en", kind: "captions", label: "English" }, cues, ...extra };
}
