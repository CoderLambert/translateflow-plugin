import { test, expect } from "./support/extension-fixture.mjs";

const SUBTITLE_SCRIPTS = [
  "src/content/subtitles/source.js",
  "src/content/subtitles/sources/text-track.js",
  "src/content/subtitles/youtube-bridge-protocol.js",
  "src/content/subtitles/youtube-timedtext.js",
  "src/content/subtitles/sources/youtube.js"
];

test("YouTube DOM subtitle source survives SPA navigation and tears down cleanly", async ({ harness }) => {
  const page = await harness.open("/article");
  await page.evaluate(() => {
    history.replaceState({}, "", "/watch?v=e2e-video-a");
    const player = document.createElement("div");
    player.id = "movie_player";

    const video = document.createElement("video");
    video.className = "html5-main-video";

    const captions = document.createElement("div");
    captions.id = "ytp-caption-window-container";
    const segment = document.createElement("span");
    segment.className = "ytp-caption-segment";
    segment.textContent = "First browser cue";
    captions.appendChild(segment);

    player.append(video, captions);
    document.body.appendChild(player);
  });

  const tabId = await harness.tabId(page);
  await harness.driver.evaluate(async ({ tabId, scripts }) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: scripts });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        globalThis.__tfSubtitleEvents = [];
        const source = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.youtubeSubtitleSource
          .createYouTubeSubtitleSource({
            onSnapshot(snapshot) {
              globalThis.__tfSubtitleEvents.push(snapshot);
            }
          });
        globalThis.__tfSubtitleSource = source;
        source.start();
      }
    });
  }, { tabId, scripts: SUBTITLE_SCRIPTS });

  await expect.poll(async () => (await readEvents(harness, tabId)).at(-1)?.mediaId).toBe("youtube:e2e-video-a");
  let events = await readEvents(harness, tabId);
  expect(events.at(-1).source).toBe("youtube-dom");
  expect(events.at(-1).cues[0].text).toBe("First browser cue");

  await page.evaluate(() => {
    history.pushState({}, "", "/watch?v=e2e-video-b");
    const oldVideo = document.querySelector("video.html5-main-video");
    const nextVideo = document.createElement("video");
    nextVideo.className = "html5-main-video";
    oldVideo.replaceWith(nextVideo);
    document.querySelector(".ytp-caption-segment").textContent = "Cue after SPA navigation";
    document.dispatchEvent(new Event("yt-navigate-finish"));
  });

  await expect.poll(async () => {
    const current = (await readEvents(harness, tabId)).at(-1);
    return `${current?.mediaId}|${current?.cues?.[0]?.text || ""}`;
  }).toBe("youtube:e2e-video-b|Cue after SPA navigation");

  events = await readEvents(harness, tabId);
  const beforeStop = events.length;
  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.__tfSubtitleSource?.stop?.()
    });
  }, { tabId });

  await page.evaluate(async () => {
    document.querySelector(".ytp-caption-segment").textContent = "No event after stop";
    document.dispatchEvent(new Event("yt-navigate-finish"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  expect((await readEvents(harness, tabId)).length).toBe(beforeStop);
});

test("MAIN-world player-owned timedtext becomes active cues and native caption suppression is reversible", async ({ harness }) => {
  const page = await harness.open("/article");
  await page.evaluate(() => {
    history.replaceState({}, "", "/watch?v=e2e-bridge-cues");
    const player = document.createElement("div");
    player.id = "movie_player";
    player.style.position = "relative";
    const video = document.createElement("video");
    video.className = "html5-main-video";
    video.currentTime = 0.5;
    video.textTracks = [];
    const captions = document.createElement("div");
    captions.id = "ytp-caption-window-container";
    captions.style.visibility = "visible";
    const segment = document.createElement("span");
    segment.className = "ytp-caption-segment";
    segment.textContent = "Native visual layer";
    captions.appendChild(segment);
    const track = { languageCode: "en", kind: "captions", vssId: "en", name: { simpleText: "English" }, baseUrl: "https://www.youtube.com/api/timedtext?pot=rotating" };
    player.getVideoData = () => ({ video_id: "e2e-bridge-cues" });
    player.getOption = () => track;
    player.getAudioTrack = () => ({ captionTracks: [track] });
    player.append(video, captions);
    document.body.appendChild(player);
  });
  await page.route("**/api/timedtext**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Bridge cue one" }] },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "Bridge cue two" }] }
    ] })
  }));

  await harness.installYouTubeMainBridge(page);
  const tabId = await harness.inject(page);
  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      globalThis.__tfBridgeEvents = [];
      globalThis.__tfBridgeSource = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.youtubeSubtitleSource.createYouTubeSubtitleSource({
        onSnapshot: (snapshot) => globalThis.__tfBridgeEvents.push(snapshot)
      });
      await globalThis.__tfBridgeSource.start();
    } });
  }, { tabId });

  await page.evaluate(() => fetch("/api/timedtext?fmt=json3"));
  await expect.poll(async () => (await readBridgeEvents(harness, tabId)).at(-1)?.cues?.[0]?.text || "").toBe("Bridge cue one");
  let state = await readBridgeState(harness, tabId);
  expect(state.mode).toBe("youtube-timedtext");
  expect(await page.locator("#ytp-caption-window-container").evaluate((node) => node.style.visibility)).toBe("hidden");

  await page.evaluate(() => {
    const video = document.querySelector("video.html5-main-video");
    video.currentTime = 1.5;
    video.dispatchEvent(new Event("timeupdate"));
  });
  await expect.poll(async () => (await readBridgeEvents(harness, tabId)).at(-1)?.cues?.[0]?.text || "").toBe("Bridge cue two");

  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__tfBridgeSource.stop() });
  }, { tabId });
  expect(await page.locator("#ytp-caption-window-container").evaluate((node) => node.style.visibility)).toBe("visible");
});

test("late MAIN bridge injection nudges YouTube once, while off mode never nudges", async ({ harness }) => {
  const page = await harness.open("/article");
  await page.evaluate(() => {
    history.replaceState({}, "", "/watch?v=e2e-late-bridge");
    const player = document.createElement("div");
    player.id = "movie_player";
    const video = document.createElement("video");
    video.className = "html5-main-video";
    video.currentTime = 0;
    video.textTracks = [];
    const track = { languageCode: "en", kind: "captions", vssId: "en", name: { simpleText: "English" } };
    player.getVideoData = () => ({ video_id: "e2e-late-bridge" });
    player.getOption = () => track;
    player.getAudioTrack = () => ({ captionTracks: [track] });
    player.loadModule = () => Promise.resolve();
    player.setOption = () => {
      window.__tfNudgeCount = (window.__tfNudgeCount || 0) + 1;
      void fetch("/api/timedtext?nudged=1");
    };
    player.appendChild(video);
    document.body.appendChild(player);
    window.__tfNudgeCount = 0;
  });
  await page.route("**/api/timedtext**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Late cue after one nudge" }] }] })
  }));
  await harness.installYouTubeMainBridge(page);
  const tabId = await harness.inject(page);
  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      globalThis.__tfLateSource = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.youtubeSubtitleSource.createYouTubeSubtitleSource({
        onSnapshot: (snapshot) => { globalThis.__tfLateEvents ||= []; globalThis.__tfLateEvents.push(snapshot); }
      });
      await globalThis.__tfLateSource.start();
    } });
  }, { tabId });
  await expect.poll(async () => (await readBridgeEvents(harness, tabId, "__tfLateEvents")).at(-1)?.cues?.[0]?.text || "", { timeout: 5000 }).toBe("Late cue after one nudge");
  expect(await page.evaluate(() => window.__tfNudgeCount)).toBe(1);
  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__tfLateSource.stop() });
  }, { tabId });

  await page.evaluate(() => {
    document.querySelector("#movie_player").remove();
    const player = document.createElement("div");
    player.id = "movie_player";
    const video = document.createElement("video");
    video.className = "html5-main-video";
    video.textTracks = [];
    const track = { languageCode: "en", kind: "captions", vssId: "en", name: { simpleText: "English" } };
    player.getVideoData = () => ({ video_id: "e2e-off-bridge" });
    player.getOption = () => track;
    player.getAudioTrack = () => ({ captionTracks: [track] });
    player.loadModule = () => { throw new Error("off mode must not nudge"); };
    player.appendChild(video);
    document.body.appendChild(player);
    history.replaceState({}, "", "/watch?v=e2e-off-bridge");
  });
  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      globalThis.__tfOffSource = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.youtubeSubtitleSource.createYouTubeSubtitleSource({ subtitleMode: "off" });
      await globalThis.__tfOffSource.start();
    } });
  }, { tabId });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(await page.evaluate(() => window.__tfNudgeCount)).toBe(1);
});

test("off mode restores the native caption layer even after asynchronous bridge metadata", async ({ harness }) => {
  const page = await harness.open("/article");
  await page.evaluate(() => {
    history.replaceState({}, "", "/watch?v=e2e-off-visuals");
    const player = document.createElement("div");
    player.id = "movie_player";
    const video = document.createElement("video");
    video.className = "html5-main-video";
    video.textTracks = [];
    const captions = document.createElement("div");
    captions.id = "ytp-caption-window-container";
    captions.style.visibility = "visible";
    const segment = document.createElement("span");
    segment.className = "ytp-caption-segment";
    segment.textContent = "Native caption";
    captions.appendChild(segment);
    const track = { languageCode: "en", kind: "captions", vssId: "en", name: { simpleText: "English" } };
    player.getVideoData = () => ({ video_id: "e2e-off-visuals" });
    player.getOption = () => track;
    player.getAudioTrack = () => ({ captionTracks: [track] });
    player.append(video, captions);
    document.body.appendChild(player);
  });
  await harness.installYouTubeMainBridge(page);
  const tabId = await harness.inject(page);
  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      globalThis.__tfOffVisualSource = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.youtubeSubtitleSource.createYouTubeSubtitleSource({
        subtitleMode: "off"
      });
      await globalThis.__tfOffVisualSource.start();
      globalThis.__tfOffVisualSource.setMode("off");
    } });
  }, { tabId });
  await page.evaluate(() => document.dispatchEvent(new Event("yt-page-data-updated")));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(await page.locator("#ytp-caption-window-container").evaluate((node) => node.style.visibility)).toBe("visible");
});


test("MAIN bridge preserves selected ASR metadata before inferred human fallback and handles track change", async ({ harness }) => {
  const page = await harness.open("/article");
  await page.evaluate(() => {
    history.replaceState({}, "", "/watch?v=e2e-track-metadata");
    const player = document.createElement("div");
    player.id = "movie_player";
    const video = document.createElement("video");
    video.className = "html5-main-video";
    video.currentTime = 0.5;

    const human = {
      languageCode: "en",
      kind: "captions",
      vssId: "en-human",
      name: { simpleText: "English" },
      baseUrl: "https://www.youtube.com/api/timedtext?track=human"
    };
    const asr = {
      languageCode: "en",
      kind: "asr",
      vssId: "a.en",
      name: { simpleText: "English (auto-generated)" },
      baseUrl: "https://www.youtube.com/api/timedtext?track=asr"
    };

    window.__tfTracks = { human, asr };
    window.__tfSelectedTrack = asr;
    window.__tfNudgedTrack = null;
    player.getVideoData = () => ({ video_id: "e2e-track-metadata" });
    player.getOption = () => window.__tfSelectedTrack;
    player.getAudioTrack = () => ({ captionTracks: [human, asr] });
    player.loadModule = () => Promise.resolve();
    player.setOption = (_module, _key, track) => {
      window.__tfNudgedTrack = track;
    };
    player.appendChild(video);
    document.body.appendChild(player);
  });

  await page.route("**/api/timedtext**", (route) => {
    const isHuman = new URL(route.request().url()).searchParams.get("track") === "human";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: isHuman ? "Human bridge cue" : "ASR bridge cue" }] }]
      })
    });
  });

  await harness.installYouTubeMainBridge(page);
  const tabId = await harness.inject(page);
  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      globalThis.__tfTrackEvents = [];
      globalThis.__tfTrackSource = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.youtubeSubtitleSource.createYouTubeSubtitleSource({
        onSnapshot: (snapshot) => globalThis.__tfTrackEvents.push(snapshot)
      });
      await globalThis.__tfTrackSource.start();
    } });
  }, { tabId });

  await expect.poll(
    () => page.evaluate(() => window.__tfNudgedTrack?.kind || ""),
    { timeout: 5000 }
  ).toBe("asr");

  await page.evaluate(() => fetch("/api/timedtext?track=asr"));
  await expect.poll(async () => {
    const current = (await readBridgeEvents(harness, tabId, "__tfTrackEvents")).at(-1);
    return String(current?.track?.autoGenerated) + "|" + (current?.track?.language || "") + "|" + (current?.cues?.[0]?.text || "");
  }).toBe("true|en|ASR bridge cue");

  await page.evaluate(() => {
    window.__tfSelectedTrack = window.__tfTracks.human;
    document.dispatchEvent(new Event("yt-page-data-updated"));
  });
  await page.evaluate(() => fetch("/api/timedtext?track=human"));
  await expect.poll(async () => {
    const current = (await readBridgeEvents(harness, tabId, "__tfTrackEvents")).at(-1);
    return String(current?.track?.autoGenerated) + "|" + (current?.track?.language || "") + "|" + (current?.cues?.[0]?.text || "");
  }).toBe("null|en|Human bridge cue");

  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__tfTrackSource?.stop?.() });
  }, { tabId });
});

test("MAIN bridge rejects a late video-A timedtext response after SPA navigation to video B", async ({ harness }) => {
  const page = await harness.open("/article");
  await page.evaluate(() => {
    history.replaceState({}, "", "/watch?v=e2e-stale-a");
    const player = document.createElement("div");
    player.id = "movie_player";
    const video = document.createElement("video");
    video.className = "html5-main-video";
    video.currentTime = 0.5;
    const track = { languageCode: "en", kind: "captions", vssId: "en", name: { simpleText: "English" } };
    window.__tfBridgeVideoId = "e2e-stale-a";
    player.getVideoData = () => ({ video_id: window.__tfBridgeVideoId });
    player.getOption = () => track;
    player.getAudioTrack = () => ({ captionTracks: [track] });
    player.appendChild(video);
    document.body.appendChild(player);
  });

  let releaseLateA;
  let sawLateA;
  const lateAGate = new Promise((resolve) => { releaseLateA = resolve; });
  const lateAObserved = new Promise((resolve) => { sawLateA = resolve; });
  await page.route("**/api/timedtext**", async (route) => {
    const kind = new URL(route.request().url()).searchParams.get("case");
    if (kind === "late-a") {
      sawLateA();
      await lateAGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: "STALE VIDEO A" }] }] })
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: "Fresh video B" }] }] })
    });
  });

  await harness.installYouTubeMainBridge(page);
  const tabId = await harness.inject(page);
  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      globalThis.__tfStaleEvents = [];
      globalThis.__tfStaleSource = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.youtubeSubtitleSource.createYouTubeSubtitleSource({
        onSnapshot: (snapshot) => globalThis.__tfStaleEvents.push(snapshot)
      });
      await globalThis.__tfStaleSource.start();
    } });
  }, { tabId });

  const lateRequest = page.evaluate(() => fetch("/api/timedtext?case=late-a").then((response) => response.text()));
  await lateAObserved;
  await page.evaluate(() => {
    window.__tfBridgeVideoId = "e2e-stale-b";
    history.pushState({}, "", "/watch?v=e2e-stale-b");
    document.dispatchEvent(new Event("yt-navigate-finish"));
  });
  releaseLateA();
  await lateRequest;
  await new Promise((resolve) => setTimeout(resolve, 50));

  let events = await readBridgeEvents(harness, tabId, "__tfStaleEvents");
  expect(events.some((snapshot) => snapshot.cues?.some((cue) => cue.text === "STALE VIDEO A"))).toBe(false);

  await page.evaluate(() => fetch("/api/timedtext?case=fresh-b"));
  await expect.poll(async () => {
    const current = (await readBridgeEvents(harness, tabId, "__tfStaleEvents")).at(-1);
    return (current?.mediaId || "") + "|" + (current?.cues?.[0]?.text || "");
  }).toBe("youtube:e2e-stale-b|Fresh video B");

  events = await readBridgeEvents(harness, tabId, "__tfStaleEvents");
  expect(events.some((snapshot) => snapshot.cues?.some((cue) => cue.text === "STALE VIDEO A"))).toBe(false);
  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__tfStaleSource?.stop?.() });
  }, { tabId });
});

test("YouTube source uses TextTrack as secondary fallback and rendered DOM as final fallback", async ({ harness }) => {
  const page = await harness.open("/article");
  await page.evaluate(() => {
    history.replaceState({}, "", "/watch?v=e2e-fallback-order");
    const player = document.createElement("div");
    player.id = "movie_player";
    const video = document.createElement("video");
    video.className = "html5-main-video";
    video.currentTime = 1;

    const cue = { id: "tt-1", startTime: 0, endTime: 10, text: "TextTrack fallback cue" };
    const activeCues = { 0: cue, length: 1, item: (index) => activeCues[index] || null };
    const track = {
      kind: "captions",
      mode: "showing",
      language: "en",
      label: "English",
      activeCues,
      addEventListener() {},
      removeEventListener() {}
    };
    const trackList = {
      0: track,
      length: 1,
      item: (index) => trackList[index] || null,
      addEventListener() {},
      removeEventListener() {}
    };
    Object.defineProperty(video, "textTracks", { configurable: true, value: trackList });
    window.__tfFallbackTrack = track;

    const captions = document.createElement("div");
    captions.id = "ytp-caption-window-container";
    const segment = document.createElement("span");
    segment.className = "caption-visual-line";
    segment.textContent = "DOM final fallback cue";
    captions.appendChild(segment);
    player.append(video, captions);
    document.body.appendChild(player);
  });

  const tabId = await harness.tabId(page);
  await harness.driver.evaluate(async ({ tabId, scripts }) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: scripts });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        globalThis.__tfFallbackEvents = [];
        globalThis.__tfFallbackSource = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.youtubeSubtitleSource.createYouTubeSubtitleSource({
          installBridge: () => Promise.resolve({ ok: true }),
          onSnapshot: (snapshot) => globalThis.__tfFallbackEvents.push(snapshot)
        });
        await globalThis.__tfFallbackSource.start();
      }
    });
  }, { tabId, scripts: SUBTITLE_SCRIPTS });

  await expect.poll(async () => {
    const current = (await readBridgeEvents(harness, tabId, "__tfFallbackEvents")).at(-1);
    return (current?.source || "") + "|" + (current?.cues?.[0]?.text || "");
  }).toBe("text-track|TextTrack fallback cue");

  await page.evaluate(() => {
    window.__tfFallbackTrack.mode = "disabled";
    document.querySelector("video.html5-main-video").dispatchEvent(new Event("timeupdate"));
  });
  await expect.poll(async () => {
    const current = (await readBridgeEvents(harness, tabId, "__tfFallbackEvents")).at(-1);
    return (current?.source || "") + "|" + (current?.cues?.[0]?.text || "");
  }).toBe("youtube-dom|DOM final fallback cue");

  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__tfFallbackSource?.stop?.() });
  }, { tabId });
});

test("MAIN bridge reinjection is idempotent and does not stack network wrappers", async ({ harness }) => {
  const page = await harness.open("/article");
  await page.evaluate(() => {
    history.replaceState({}, "", "/watch?v=e2e-idempotent");
    const player = document.createElement("div");
    player.id = "movie_player";
    const video = document.createElement("video");
    video.className = "html5-main-video";
    const track = { languageCode: "en", kind: "captions", vssId: "en", name: { simpleText: "English" } };
    player.getVideoData = () => ({ video_id: "e2e-idempotent" });
    player.getOption = () => track;
    player.getAudioTrack = () => ({ captionTracks: [track] });
    player.appendChild(video);
    document.body.appendChild(player);
  });

  await harness.installYouTubeMainBridge(page);
  await page.evaluate(() => {
    window.__tfFirstFetchWrapper = window.fetch;
    window.__tfFirstXhrOpenWrapper = XMLHttpRequest.prototype.open;
  });
  await harness.installYouTubeMainBridge(page);

  const result = await page.evaluate(() => ({
    sameFetch: window.fetch === window.__tfFirstFetchWrapper,
    sameXhrOpen: XMLHttpRequest.prototype.open === window.__tfFirstXhrOpenWrapper,
    version: window.__TRANSLATE_FLOW_YOUTUBE_MAIN_BRIDGE__?.version || 0
  }));
  expect(result).toEqual({ sameFetch: true, sameXhrOpen: true, version: 1 });
});


async function readEvents(harness, tabId) {
  return harness.driver.evaluate(async ({ tabId }) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.__tfSubtitleEvents || []
    });
    return result?.result || [];
  }, { tabId });
}

async function readBridgeEvents(harness, tabId, key = "__tfBridgeEvents") {
  return harness.driver.evaluate(async ({ tabId, key }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [key], func: (name) => globalThis[name] || [] });
    return result?.result || [];
  }, { tabId, key });
}

async function readBridgeState(harness, tabId) {
  return harness.driver.evaluate(async ({ tabId }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({ mode: globalThis.__tfBridgeSource?.getMode?.() || "" }) });
    return result?.result || {};
  }, { tabId });
}
