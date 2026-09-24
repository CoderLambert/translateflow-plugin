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
