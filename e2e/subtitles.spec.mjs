import { test, expect } from "./support/extension-fixture.mjs";

const SUBTITLE_SCRIPTS = [
  "src/content/subtitles/source.js",
  "src/content/subtitles/sources/text-track.js",
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

test("YouTube DOM fallback activates an available native caption track before declaring it unavailable", async ({ harness }) => {
  const page = await harness.open("/article");
  await page.evaluate(() => {
    history.replaceState({}, "", "/watch?v=e2e-caption-activation");
    const player = document.createElement("div");
    player.id = "movie_player";
    const video = document.createElement("video");
    video.className = "html5-main-video";
    const button = document.createElement("button");
    button.className = "ytp-subtitles-button";
    button.setAttribute("aria-label", "Subtitles/closed captions");
    button.setAttribute("aria-pressed", "false");
    const captions = document.createElement("div");
    captions.id = "ytp-caption-window-container";
    button.addEventListener("click", () => {
      button.setAttribute("aria-pressed", "true");
      const segment = document.createElement("span");
      segment.className = "ytp-caption-segment";
      segment.textContent = "Activated native cue";
      captions.appendChild(segment);
    });
    player.append(video, button, captions);
    document.body.appendChild(player);
  });

  const tabId = await harness.tabId(page);
  await harness.driver.evaluate(async ({ tabId, scripts }) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: scripts });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        globalThis.__tfSubtitleEvents = [];
        globalThis.__tfSubtitleSource = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.youtubeSubtitleSource
          .createYouTubeSubtitleSource({ onSnapshot: (snapshot) => globalThis.__tfSubtitleEvents.push(snapshot) });
        globalThis.__tfSubtitleSource.start();
      }
    });
  }, { tabId, scripts: SUBTITLE_SCRIPTS });

  await expect.poll(async () => (await readEvents(harness, tabId)).at(-1)?.cues?.[0]?.text || "").toBe("Activated native cue");
  await expect(page.locator(".ytp-subtitles-button")).toHaveAttribute("aria-pressed", "true");
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
