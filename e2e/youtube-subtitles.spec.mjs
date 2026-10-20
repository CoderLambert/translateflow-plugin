import { test, expect } from "./support/extension-fixture.mjs";

test.beforeEach(async ({ harness }) => {
  await harness.reset();
  await harness.setStorage({ uiLocale: "en" });
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
  await expect.poll(() => harness.server.calls[2].responseState).not.toBe("pending");
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
      source: host?.getAttribute("data-tf-subtitle-source") || "",
      translated: translated?.textContent || "",
      status: status?.textContent || "",
      preset: preset?.value || "",
      presetLabel: preset?.selectedOptions[0]?.textContent || "",
      sizeVar: host?.style.getPropertyValue("--tf-subtitle-size") || "",
      originalHidden: original?.classList.contains("hidden") ?? true,
      translatedHidden: translated?.classList.contains("hidden") ?? true
    };
  });
}

test("production YouTube controller restores DOM captions and invalidates configuration and cleared cache", async ({ harness }) => {
  const url = "https://www.youtube.com/watch?v=tf-reliability";
  await harness.context.route(url, route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><title>Subtitle reliability fixture</title></head><body><div id="movie_player" style="position:relative;width:960px;height:540px"><video class="html5-main-video"></video><div id="ytp-caption-window-container"><span class="ytp-caption-segment">Caption A</span></div></div></body></html>' }));
  const page = await harness.context.newPage();
  try {
    await page.goto(url);
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("[DEFAULT|PLAIN] Caption A");
    expect((await readOverlay(page)).source).toBe("youtube-dom");
    expect((await readOverlay(page)).presetLabel).toBe("Use this site’s setting");
    expect(harness.server.calls).toHaveLength(1);
    await page.locator(".ytp-caption-segment").evaluate(node => { node.textContent = ""; });
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("");
    await page.locator(".ytp-caption-segment").evaluate(node => { node.textContent = "Caption A"; });
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("[DEFAULT|PLAIN] Caption A");
    expect(harness.server.calls).toHaveLength(1);
    await harness.setStorage({ targetLanguage: "Japanese" });
    await expect.poll(() => harness.server.calls.length).toBe(2);
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("[DEFAULT|PLAIN] Caption A");
    expect(harness.server.calls.at(-1).systemPrompt).toContain("Japanese");
    const cleared = await harness.runtime({ type: "CACHE_CLEAR_PAGE", pageUrl: url }); expect(cleared.ok).toBe(true);
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("");
    expect(harness.server.calls).toHaveLength(2);
    await page.locator(".ytp-caption-segment").evaluate(node => { node.textContent = "Caption B"; });
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("[DEFAULT|PLAIN] Caption B");
    expect(harness.server.calls).toHaveLength(3);
    await page.evaluate(() => {
      document.body.style.minHeight = "1600px";
      const player = document.querySelector("#movie_player"), next = player.cloneNode(true);
      next.style.overflow = "hidden";
      next.querySelector('[data-tf-extension-ui="youtube-subtitles"]').remove();
      player.replaceWith(next);
      document.dispatchEvent(new Event("yt-page-data-updated"));
    });
    await expect.poll(async () => (await readOverlay(page)).presetLabel).toBe("Use this site’s setting");
    await page.getByRole("button", { name: "TranslateFlow subtitles", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "TranslateFlow subtitle mode", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "TranslateFlow subtitle mode", exact: true }).press("Escape");
    await expect(page.getByRole("combobox", { name: "TranslateFlow subtitle mode", exact: true })).toBeHidden();
  } finally { await page.close(); }
});

test("production timedtext prepares short captions before their start without a blank painted frame", async ({ harness }, testInfo) => {
  const url = "https://www.youtube.com/watch?v=tf-short-captions";
  const track = { languageCode: "en", kind: "captions", vssId: ".en", name: { simpleText: "English" }, baseUrl: "https://www.youtube.com/api/timedtext?lang=en&fmt=json3" };
  await harness.context.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><title>TranslateFlow short-caption regression fixture</title></head><body style="margin:0;background:#eef1ea;font-family:system-ui"><h1 style="margin:28px">Short captions · synthetic player / mock Provider</h1><div id="movie_player" style="position:relative;width:960px;height:540px;background:#152a24;margin:28px;color:white"><p style="padding:40px;font-size:28px">Known subtitles are translated before their playback window.</p><video class="html5-main-video"></video><div id="ytp-caption-window-container"></div></div><script>const p=document.querySelector('#movie_player'),t=${JSON.stringify(track)};p.getVideoData=()=>({video_id:'tf-short-captions'});p.getOption=()=>t;p.getAudioTrack=()=>({captionTracks:[t]});document.querySelector('video').currentTime=0.1;</script></body></html>` }));
  const captions = [
    { tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: "Warmup caption" }] },
    { tStartMs: 4000, dDurationMs: 200, segs: [{ utf8: "First short caption" }] },
    { tStartMs: 4200, dDurationMs: 200, segs: [{ utf8: "Second short caption" }] },
    { tStartMs: 4400, dDurationMs: 200, segs: [{ utf8: "Third short caption" }] },
    { tStartMs: 25000, dDurationMs: 1000, segs: [{ utf8: "Outside lookahead" }] }
  ];
  await harness.context.route("**/api/timedtext**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ events: captions }) }));
  harness.server.setDelay(1400);
  const page = await harness.context.newPage();
  try {
    await page.goto(url);
    await harness.installYouTubeMainBridge(page);
    await page.evaluate(() => fetch("/api/timedtext?lang=en&fmt=json3"));
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("[DEFAULT|PLAIN] Warmup caption");
    expect((await readOverlay(page)).source).toBe("youtube-timedtext");
    expect(harness.server.calls).toHaveLength(1);
    expect(harness.server.calls[0].segments.map(item => item.text)).toEqual([
      "Warmup caption", "First short caption", "Second short caption", "Third short caption"
    ]);

    for (const [time, text] of [[4, "First short caption"], [4.2, "Second short caption"], [4.4, "Third short caption"]]) {
      const frames = await page.evaluate(async time => {
        const video = document.querySelector("video"); video.currentTime = time; video.dispatchEvent(new Event("timeupdate"));
        const frames = [];
        for (let index = 0; index < 3; index++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          frames.push(document.querySelector('[data-tf-extension-ui="youtube-subtitles"]').shadowRoot.querySelector(".translated").textContent);
        }
        return frames;
      }, time);
      expect(frames).toEqual(Array(3).fill(`[DEFAULT|PLAIN] ${text}`));
      expect(harness.server.calls).toHaveLength(1);
    }
    const overlap = await page.evaluate(() => {
      const root = document.querySelector('[data-tf-extension-ui="youtube-subtitles"]').shadowRoot;
      const caption = root.querySelector(".wrap").getBoundingClientRect(), controls = root.querySelector(".controls").getBoundingClientRect();
      return Math.max(0, Math.min(caption.right, controls.right) - Math.max(caption.left, controls.left))
        * Math.max(0, Math.min(caption.bottom, controls.bottom) - Math.max(caption.top, controls.top));
    });
    expect(overlap, "subtitle controls must not cover caption lines").toBe(0);
    await page.screenshot({ path: testInfo.outputPath("short-caption-lookahead.png") });
    await page.evaluate(() => { const video = document.querySelector("video"); video.currentTime = 5; video.dispatchEvent(new Event("timeupdate")); });
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("");
    expect(harness.server.calls).toHaveLength(1);
  } finally { await page.close(); }
});

test("production rolling DOM captions retain a translated visible phrase until it scrolls out", async ({ harness }) => {
  const url = "https://www.youtube.com/watch?v=tf-rolling-dom";
  await harness.context.route(url, route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="movie_player" style="position:relative;width:960px;height:540px"><video class="html5-main-video"></video><div id="ytp-caption-window-container"><span class="caption-visual-line"><span class="ytp-caption-segment">Put your phones down.</span></span></div></div></body></html>' }));
  harness.server.setDelay(1400);
  const page = await harness.context.newPage();
  try {
    await page.goto(url);
    await expect.poll(() => harness.server.calls.length).toBe(1);
    expect(harness.server.calls[0].segments[0].text).toBe("Put your phones down.");
    await page.locator(".ytp-caption-segment").evaluate(node => { node.textContent = "Put your phones down. Put your laptop down."; });
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("[DEFAULT|PLAIN] Put your phones down.");
    expect((await readOverlay(page)).original).toBe("Put your phones down. Put your laptop down.");
    expect((await readOverlay(page)).source).toBe("youtube-dom");
    await page.locator(".ytp-caption-segment").evaluate(node => { node.textContent += " Seriously."; });
    const visible = await page.evaluate(async () => {
      const values = [];
      for (let index = 0; index < 3; index++) { await new Promise(requestAnimationFrame); values.push(Boolean(document.querySelector('[data-tf-extension-ui="youtube-subtitles"]').shadowRoot.querySelector('.translated').textContent)); }
      return values;
    });
    expect(visible).toEqual([true, true, true]);
    await page.locator(".ytp-caption-segment").evaluate(node => { node.textContent = "A different caption."; });
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("");
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("[DEFAULT|PLAIN] A different caption.");
  } finally { await page.close(); }
});

test("subtitle settings open from one native YouTube toolbar button and survive controls reconstruction", async ({ harness }, testInfo) => {
  const url = "https://www.youtube.com/watch?v=tf-native-controls";
  await harness.context.route(url, route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><title>Native subtitle controls fixture</title></head><body style="margin:24px;background:#18201c;color:white;font-family:system-ui"><h1>Synthetic YouTube player · mock Provider</h1><div id="movie_player" style="position:relative;width:960px;height:540px;overflow:hidden;background:#26392e"><video class="html5-main-video"></video><div id="ytp-caption-window-container"><span class="ytp-caption-segment">A visible caption</span></div><div class="ytp-chrome-bottom" style="position:absolute;bottom:0;left:0;right:0;height:48px;background:#111"><div class="ytp-right-controls" style="float:right;height:100%;display:flex"><div class="ytp-right-controls-left"><button class="ytp-settings-button" aria-label="Settings">⚙</button></div><div class="ytp-right-controls-right"><button aria-label="Fullscreen">⛶</button></div></div></div></div></body></html>' }));
  const page = await harness.context.newPage();
  const entry = page.locator('.ytp-right-controls [data-tf-subtitle-button]');
  const mode = page.getByRole("combobox", { name: "TranslateFlow subtitle mode", exact: true });
  try {
    await page.goto(url);
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("[DEFAULT|PLAIN] A visible caption");
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute("aria-expanded", "false");
    await expect(mode).toBeHidden();
    await entry.click();
    await expect(mode).toBeVisible();
    await expect(entry).toHaveAttribute("aria-expanded", "true");
    expect((await readOverlay(page)).presetLabel).toBe("Use this site’s setting");
    await mode.selectOption("original");
    expect((await readOverlay(page)).translatedHidden).toBe(true);
    await mode.selectOption("bilingual");
    await expect.poll(async () => (await readOverlay(page)).translated).toBe("[DEFAULT|PLAIN] A visible caption");
    expect(harness.server.calls).toHaveLength(1);
    await mode.press("Escape");
    await expect(mode).toBeHidden();
    expect(await entry.evaluate(node => document.activeElement === node)).toBe(true);
    await page.locator('.ytp-right-controls').evaluate(node => { node.innerHTML = '<button class="ytp-settings-button" aria-label="Settings">⚙</button><button aria-label="Fullscreen">⛶</button>'; });
    await expect(entry).toHaveCount(1);
    await entry.press("Enter");
    await expect(mode).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("native-subtitle-settings.png") });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(mode).toBeHidden();
  } finally { await page.close(); }
});
