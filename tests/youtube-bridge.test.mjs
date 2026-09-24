import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { installYouTubeMainBridge, isYouTubePageUrl, validateYouTubeBridgeSender } from "../src/background/youtube-bridge.js";

const PROTOCOL = new URL("../src/content/subtitles/youtube-bridge-protocol.js", import.meta.url);
const TIMEDTEXT = new URL("../src/content/subtitles/youtube-timedtext.js", import.meta.url);
const MAIN_BRIDGE = new URL("../src/content/subtitles/youtube-main-bridge.js", import.meta.url);

class EventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
  }
  dispatchEvent(event) {
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener.call(this, event);
  }
}

function loadPage({ videoId = "bridge-a", fetchImpl = null, xhrClass = null } = {}) {
  const page = new EventTarget();
  const document = new EventTarget();
  const video = Object.assign(new EventTarget(), { currentTime: 1, playbackRate: 1, paused: false });
  let currentId = videoId;
  let nudgeCount = 0;
  let setOptionCount = 0;
  const track = { languageCode: "en", kind: "captions", vssId: "en", name: { simpleText: "English" } };
  const player = {
    querySelector(selector) { return selector.startsWith("video") ? video : null; },
    getVideoData() { return { video_id: currentId }; },
    getOption() { return track; },
    getAudioTrack() { return { captionTracks: [track] }; },
    loadModule() { nudgeCount += 1; return Promise.resolve(); },
    setOption() { setOptionCount += 1; }
  };
  document.documentElement = player;
  document.querySelector = (selector) => {
    if (selector === "#movie_player" || selector === ".html5-video-player") return player;
    if (selector.startsWith("video")) return video;
    return null;
  };

  const outbound = [];
  let context;
  let pageGlobal;
  page.postMessage = (data) => {
    outbound.push(data);
    page.dispatchEvent({ type: "message", source: pageGlobal, data });
  };
  const originalFetch = fetchImpl || (() => Promise.reject(new Error("fetch not configured")));
  context = vm.createContext({
    console,
    Date,
    URL,
    TextEncoder,
    Promise,
    setTimeout,
    clearTimeout,
    document,
    location: { href: `https://www.youtube.com/watch?v=${videoId}`, origin: "https://www.youtube.com" },
    addEventListener: page.addEventListener.bind(page),
    removeEventListener: page.removeEventListener.bind(page),
    dispatchEvent: page.dispatchEvent.bind(page),
    postMessage: (...args) => page.postMessage(...args),
    MutationObserver: class { observe() {} disconnect() {} },
    PerformanceObserver: undefined,
    performance: { getEntriesByType: () => [] },
    XMLHttpRequest: xhrClass || class {},
    fetch: originalFetch
  });
  pageGlobal = vm.runInContext("globalThis", context);
  vm.runInContext(readFileSync(PROTOCOL, "utf8"), context);
  vm.runInContext(readFileSync(TIMEDTEXT, "utf8"), context);
  vm.runInContext(readFileSync(MAIN_BRIDGE, "utf8"), context);
  return {
    context,
    page,
    player,
    outbound,
    originalFetch,
    setVideoId(value) {
      currentId = value;
      context.location.href = `https://www.youtube.com/watch?v=${value}`;
      document.dispatchEvent({ type: "yt-navigate-finish" });
    },
    get nudgeCount() { return nudgeCount; },
    get setOptionCount() { return setOptionCount; }
  };
}

function sendHello(page, protocol, videoId, generation, mode = "bilingual") {
  protocol.post(page, {
    direction: protocol.DIRECTIONS.ISOLATED_TO_MAIN,
    type: "HELLO",
    videoId,
    generation,
    observedAt: Date.now(),
    payload: { mode }
  });
}

test("timedtext parser handles JSON3, XML/srv3, entities and stable track identity", () => {
  const context = vm.createContext({ console, TextEncoder, DOMParser: undefined });
  vm.runInContext(readFileSync(TIMEDTEXT, "utf8"), context);
  const parser = context.__TRANSLATE_FLOW_YOUTUBE_TIMEDTEXT__;
  const json = parser.parseTimedtext(JSON.stringify({ events: [
    { tStartMs: 1200, dDurationMs: 800, segs: [{ utf8: "Hello " }, { utf8: "world" }] },
    { tStartMs: 2400, dDurationMs: 500, segs: [{ utf8: " &amp; " }] }
  ] }));
  assert.equal(json.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(json.cues.map((cue) => [cue.id, cue.startTime, cue.endTime, cue.text]))), [
    ["yt:1200:800:0", 1.2, 2, "Hello world"],
    ["yt:2400:500:1", 2.4, 2.9, "&amp;"]
  ]);

  const xml = parser.parseTimedtext('<transcript><text start="1.5" dur="2">Tom &amp; Jerry</text></transcript>');
  assert.equal(xml.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(xml.cues[0])), { id: "yt:1500:2000:0", startTime: 1.5, endTime: 3.5, text: "Tom & Jerry" });
  const srv3 = parser.parseTimedtext('<timedtext><p t="2500" d="750"><s>Hello</s><s> there</s></p></timedtext>');
  assert.equal(srv3.cues[0].startTime, 2.5);
  assert.equal(srv3.cues[0].text, "Hello there");
  assert.equal(parser.parseTimedtext("not timedtext").ok, false);

  const first = parser.normalizeTrackMetadata({ languageCode: "en", kind: "asr", vssId: ".asr", baseUrl: "?pot=one" });
  const rotated = parser.normalizeTrackMetadata({ languageCode: "en", kind: "asr", vssId: ".asr", baseUrl: "?pot=two&sig=rotated" });
  assert.equal(first.id, rotated.id);
  assert.equal(first.autoGenerated, true);
});

test("bridge protocol rejects forged, stale-shape and over-sized page messages", () => {
  const context = vm.createContext({ console, TextEncoder, Date });
  vm.runInContext(readFileSync(PROTOCOL, "utf8"), context);
  const protocol = context.__TRANSLATE_FLOW_YOUTUBE_BRIDGE_PROTOCOL__;
  const valid = protocol.createEnvelope({
    direction: protocol.DIRECTIONS.MAIN_TO_ISOLATED,
    type: "TIMEDTEXT",
    videoId: "a",
    generation: 1,
    observedAt: 1,
    payload: { format: "json3", cues: [{ id: "yt:0:1:0", startTime: 0, endTime: 1, text: "cue" }], track: null }
  });
  assert.equal(protocol.validateEnvelope(valid).ok, true);
  assert.equal(protocol.validateEnvelope({ ...valid, source: "forged" }).ok, false);
  assert.equal(protocol.validateEnvelope({ ...valid, type: "UNKNOWN" }).ok, false);
  assert.equal(protocol.validateEnvelope({ ...valid, type: "READY", payload: { unexpected: true } }).ok, false);
  assert.equal(protocol.validateEnvelope({ ...valid, type: "HELLO", payload: { mode: "bilingual", unexpected: true } }).ok, false);
  assert.equal(protocol.validateEnvelope({ ...valid, payload: { format: "json3", cues: [{ id: "x", startTime: 0, endTime: 1, text: "x".repeat(2 * 1024 * 1024) }], track: null } }).error, "payload-too-large");
});

test("background installer validates sender tab and installs the frozen MAIN file order", async () => {
  assert.equal(isYouTubePageUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isYouTubePageUrl("https://example.com/watch?v=abc"), false);
  assert.throws(() => validateYouTubeBridgeSender({ tab: { id: 2, url: "https://example.com" } }));
  const calls = [];
  const chromeApi = { scripting: { executeScript: async (details) => calls.push(details) } };
  const result = await installYouTubeMainBridge({ tab: { id: 7, url: "https://www.youtube.com/watch?v=abc" } }, { chromeApi });
  assert.equal(result.world, "MAIN");
  assert.equal(calls[0].target.tabId, 7);
  assert.equal(calls[0].world, "MAIN");
  assert.deepEqual(calls[0].files, [
    "src/content/subtitles/youtube-bridge-protocol.js",
    "src/content/subtitles/youtube-timedtext.js",
    "src/content/subtitles/youtube-main-bridge.js"
  ]);
});

test("MAIN fetch observation preserves the page promise, delivers cues, guards one nudge and rejects stale responses", async () => {
  let resolveResponse;
  const responsePromise = new Promise((resolve) => { resolveResponse = resolve; });
  const originalFetch = () => responsePromise;
  const page = loadPage({ fetchImpl: originalFetch });
  const protocol = page.context.__TRANSLATE_FLOW_YOUTUBE_BRIDGE_PROTOCOL__;
  sendHello(page.page, protocol, "bridge-a", 1);
  const returned = page.context.fetch("https://www.youtube.com/api/timedtext?v=bridge-a");
  assert.equal(returned, responsePromise);
  page.setVideoId("bridge-b");
  sendHello(page.page, protocol, "bridge-b", 2);
  page.context.__TRANSLATE_FLOW_YOUTUBE_MAIN_BRIDGE__.stop();
  resolveResponse({
    headers: { get: () => "application/json" },
    clone() { return { headers: this.headers, text: async () => JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "stale" }] }] }) }; }
  });
  await returned;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.outbound.some((message) => message.type === "TIMEDTEXT"), false);

  const second = loadPage({ fetchImpl: () => Promise.resolve({ headers: { get: () => "application/json" }, clone() { return { headers: this.headers, text: async () => JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "fresh" }] }] }) }; } }) });
  const secondProtocol = second.context.__TRANSLATE_FLOW_YOUTUBE_BRIDGE_PROTOCOL__;
  sendHello(second.page, secondProtocol, "bridge-a", 1);
  secondProtocol.post(second.page, { direction: secondProtocol.DIRECTIONS.ISOLATED_TO_MAIN, type: "NUDGE", videoId: "bridge-a", generation: 1, observedAt: 1, payload: {} });
  secondProtocol.post(second.page, { direction: secondProtocol.DIRECTIONS.ISOLATED_TO_MAIN, type: "NUDGE", videoId: "bridge-a", generation: 1, observedAt: 2, payload: {} });
  await Promise.resolve();
  assert.equal(second.nudgeCount, 1);
  assert.equal(second.setOptionCount, 1);
  assert.equal(second.context.__TRANSLATE_FLOW_YOUTUBE_MAIN_BRIDGE__.version, 1);
  second.context.__TRANSLATE_FLOW_YOUTUBE_MAIN_BRIDGE__.stop();
  assert.equal(second.context.fetch, second.originalFetch);
});

test("MAIN XHR observation preserves native methods and teardown restores only TranslateFlow wrappers", async () => {
  class FakeXHR extends EventTarget {
    open(method, url) { this.method = method; this.url = url; return "native-open"; }
    send(body) {
      this.body = body;
      this.responseType = "";
      this.responseText = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "xhr cue" }] }] });
      this.dispatchEvent({ type: "loadend" });
      return "native-send";
    }
    getResponseHeader() { return "application/json"; }
  }
  const nativeOpen = FakeXHR.prototype.open;
  const nativeSend = FakeXHR.prototype.send;
  const page = loadPage({ xhrClass: FakeXHR });
  const protocol = page.context.__TRANSLATE_FLOW_YOUTUBE_BRIDGE_PROTOCOL__;
  sendHello(page.page, protocol, "bridge-a", 1);
  const xhr = new page.context.XMLHttpRequest();
  assert.equal(xhr.open("GET", "https://www.youtube.com/api/timedtext?v=bridge-a"), "native-open");
  assert.equal(xhr.send("body"), "native-send");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.outbound.some((message) => message.type === "TIMEDTEXT" && message.payload.cues[0].text === "xhr cue"), true);
  page.context.__TRANSLATE_FLOW_YOUTUBE_MAIN_BRIDGE__.stop();
  assert.equal(FakeXHR.prototype.open, nativeOpen);
  assert.equal(FakeXHR.prototype.send, nativeSend);
});
