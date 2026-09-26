import { test, expect } from "./support/extension-fixture.mjs";

test.beforeEach(async ({ harness }) => {
  await harness.reset();
});

test("YouTube controller renders bilingually, applies preset, reuses cache and rejects stale video results", async ({ harness }) => {
  const page = await harness.open("/article");
  await installPlayer(page, { videoId: "video-a", caption: "First browser cue" });
  const tabId = await harness.inject(page);

  expect(await startTestController(harness, tabId)).toBe(true);
  await expect.poll(async () => (await readOverlay(page)).translated)
    .toBe("[DEFAULT|PLAIN] First browser cue");
  expect(harness.server.calls).toHaveLength(1);

  let overlay = await readOverlay(page);
  expect(overlay.original).toBe("First browser cue");
  expect(overlay.preset).toBe("inherit");
  expect(overlay.translatedHidden).toBe(false);

  await setControl(harness, tabId, "Translation preset", "technical");
  await expect.poll(async () => (await readOverlay(page)).translated)
    .toBe("[TECH|PLAIN] First browser cue");
  expect(harness.server.calls).toHaveLength(2);
  expect(harness.server.calls.at(-1).systemPrompt).toContain("Translation style preset: Technical");

  await setControl(harness, tabId, "Translated subtitle size", "large");
  await expect.poll(async () => (await readOverlay(page)).sizeVar).toBe("22px");

  await setControl(harness, tabId, "TranslateFlow subtitle mode", "original");
  overlay = await readOverlay(page);
  expect(overlay.originalHidden).toBe(false);
  expect(overlay.translatedHidden).toBe(true);
  await setControl(harness, tabId, "TranslateFlow subtitle mode", "bilingual");

  await stopTestController(harness, tabId);
  expect(await startTestController(harness, tabId)).toBe(true);
  await expect.poll(async () => (await readOverlay(page)).translated)
    .toBe("[TECH|PLAIN] First browser cue");
  expect(harness.server.calls).toHaveLength(2);

  harness.server.setDelay(300);
  await page.evaluate(() => {
    document.querySelector(".ytp-caption-segment").textContent = "Old video pending";
  });
  await expect.poll(() => harness.server.calls.length).toBe(3);

  harness.server.setDelay(0);
  await page.evaluate(() => {
    history.pushState({}, "", "/watch?v=video-b");
    const oldVideo = document.querySelector("video.html5-main-video");
    const nextVideo = document.createElement("video");
    nextVideo.className = "html5-main-video";
    oldVideo.replaceWith(nextVideo);
    document.querySelector(".ytp-caption-segment").textContent = "Second video cue";
    document.dispatchEvent(new Event("yt-navigate-finish"));
  });

  await expect.poll(async () => (await readOverlay(page)).original).toBe("Second video cue");
  await expect.poll(async () => (await readOverlay(page)).translated)
    .toBe("[TECH|PLAIN] Second video cue");
  await page.waitForTimeout(350);
  overlay = await readOverlay(page);
  expect(overlay.translated).not.toContain("Old video pending");
  expect(harness.server.calls.length).toBeGreaterThanOrEqual(4);

  await stopTestController(harness, tabId);
});

test("YouTube controller preserves original captions and surfaces translation failure", async ({ harness }) => {
  harness.server.setFailures([401]);
  const page = await harness.open("/article");
  await installPlayer(page, { videoId: "failure-video", caption: "Original caption stays visible" });
  const tabId = await harness.inject(page);

  expect(await startTestController(harness, tabId)).toBe(true);
  await expect.poll(async () => (await readOverlay(page)).original)
    .toBe("Original caption stays visible");
  await expect.poll(async () => (await readOverlay(page)).status)
    .toContain("original captions remain visible");

  const overlay = await readOverlay(page);
  expect(overlay.originalHidden).toBe(false);
  expect(overlay.translated).toBe("");
  expect(harness.server.calls).toHaveLength(1);

  await stopTestController(harness, tabId);
});

async function installPlayer(page, { videoId, caption }) {
  await page.evaluate(({ videoId, caption }) => {
    history.replaceState({}, "", `/watch?v=${videoId}`);
    document.querySelector("#movie_player")?.remove();

    const player = document.createElement("div");
    player.id = "movie_player";
    player.style.position = "relative";
    player.style.width = "960px";
    player.style.height = "540px";

    const video = document.createElement("video");
    video.className = "html5-main-video";

    const captions = document.createElement("div");
    captions.id = "ytp-caption-window-container";
    const segment = document.createElement("span");
    segment.className = "ytp-caption-segment";
    segment.textContent = caption;
    captions.appendChild(segment);

    player.append(video, captions);
    document.body.appendChild(player);
  }, { videoId, caption });
}

async function startTestController(harness, tabId) {
  return harness.driver.evaluate(async ({ tabId }) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        await globalThis.__tfYouTubeTestController?.stop?.();
        const factory = globalThis.__TRANSLATE_FLOW_CONTENT__?.modules?.subtitleControllerFactory;
        if (!factory?.createController) throw new Error("subtitle controller factory unavailable");
        const controller = factory.createController({
          isSupportedPage: () => true,
          pipelineOptions: {
            stabilityMs: 0,
            batchDelayMs: 0,
            maxBatchItems: 1
          }
        });
        globalThis.__tfYouTubeTestController = controller;
        return controller.start();
      }
    });
    return result?.result;
  }, { tabId });
}

async function stopTestController(harness, tabId) {
  await harness.driver.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        await globalThis.__tfYouTubeTestController?.stop?.();
        globalThis.__tfYouTubeTestController = null;
      }
    });
  }, { tabId });
}

async function setControl(harness, tabId, label, value) {
  await harness.driver.evaluate(async ({ tabId, label, value }) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [label, value],
      func: (controlLabel, nextValue) => {
        const host = document.querySelector('[data-tf-extension-ui="youtube-subtitles"]');
        const select = [...(host?.shadowRoot?.querySelectorAll("select") || [])]
          .find((node) => node.getAttribute("aria-label") === controlLabel);
        if (!select) throw new Error(`Missing subtitle control: ${controlLabel}`);
        select.value = nextValue;
        select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return select.value;
      }
    });
    if (result?.result !== value) throw new Error(`Subtitle control did not accept ${value}`);
  }, { tabId, label, value });
}

async function readOverlay(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-tf-extension-ui="youtube-subtitles"]');
    const root = host?.shadowRoot;
    const original = root?.querySelector(".original");
    const translated = root?.querySelector(".translated");
    const status = root?.querySelector(".status");
    const preset = root?.querySelector('[aria-label="Translation preset"]');
    return {
      original: original?.textContent || "",
      translated: translated?.textContent || "",
      status: status?.textContent || "",
      preset: preset?.value || "",
      sizeVar: host?.style.getPropertyValue("--tf-subtitle-size") || "",
      originalHidden: original?.classList.contains("hidden") ?? true,
      translatedHidden: translated?.classList.contains("hidden") ?? true
    };
  });
}
