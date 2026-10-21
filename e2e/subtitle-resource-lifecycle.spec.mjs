import { test, expect } from "./support/extension-fixture.mjs";

test("production subtitle mode cycles release MAIN resources and ignore unrelated DOM changes", async ({ harness }, testInfo) => {
  await harness.reset(); await harness.setStorage({ uiLocale: "en" });
  const url = "https://www.youtube.com/watch?v=tf-resource-lifecycle";
  await harness.context.addInitScript(() => {
    const native = { fetch: window.fetch, open: XMLHttpRequest.prototype.open, send: XMLHttpRequest.prototype.send };
    const active = new Set(), messages = {};
    const NativeObserver = window.PerformanceObserver;
    window.PerformanceObserver = class extends NativeObserver {
      observe(options) { const result = super.observe(options); active.add(this); return result; }
      disconnect() { active.delete(this); return super.disconnect(); }
    };
    window.addEventListener("message", event => {
      if (event.source === window && event.data?.source === "translateflow-youtube-bridge" && event.data.direction === "main-to-isolated") {
        messages[event.data.type] = (messages[event.data.type] || 0) + 1;
      }
    });
    window.__tfResourceCounts = () => ({ active: window.__TRANSLATE_FLOW_YOUTUBE_MAIN_BRIDGE__?.getState().active,
      observers: active.size, tracks: messages.TRACKS || 0,
      hooksRestored: window.fetch === native.fetch && XMLHttpRequest.prototype.open === native.open && XMLHttpRequest.prototype.send === native.send,
      videoReleased: window.__TRANSLATE_FLOW_YOUTUBE_MAIN_BRIDGE__?.getState().video === null });
  });
  await harness.context.route(url, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><title>Subtitle resource lifecycle · synthetic player</title></head><body style="background:#18201c;color:white;font-family:system-ui"><h1>Subtitle resource lifecycle · synthetic player / mock Provider</h1><div id="movie_player" style="position:relative;width:960px;height:540px;background:#26392e"><video class="html5-main-video"></video><div id="ytp-caption-window-container"><span class="ytp-caption-segment">Known lifecycle caption</span></div><div class="ytp-right-controls" style="position:absolute;bottom:0;right:0;height:48px"><button class="ytp-settings-button">Settings</button></div></div><div id="outside"></div><script>const p=document.querySelector('#movie_player'),t={languageCode:'en',kind:'captions',vssId:'.en',name:{simpleText:'English'}};p.getVideoData=()=>({video_id:'tf-resource-lifecycle'});p.getOption=()=>t;p.getAudioTrack=()=>({captionTracks:[t]});document.querySelector('video').currentTime=1;</script></body></html>` }));
  await harness.context.route("**/api/timedtext**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: "Known lifecycle caption" }] }] }) }));
  const page = await harness.context.newPage();
  const counts = () => page.evaluate(() => window.__tfResourceCounts());
  const mode = page.getByRole("combobox", { name: "TranslateFlow subtitle mode", exact: true });
  try {
    await page.goto(url); await harness.installYouTubeMainBridge(page);
    await page.evaluate(() => fetch("/api/timedtext?lang=en&fmt=json3"));
    await expect.poll(async () => (await counts()).observers).toBe(1);
    await expect.poll(() => page.locator('[data-tf-extension-ui="youtube-subtitles"]').evaluate(node => node.shadowRoot.querySelector('.translated').textContent)).toBe("[DEFAULT|PLAIN] Known lifecycle caption");
    await page.getByRole("button", { name: "TranslateFlow subtitles", exact: true }).click();
    for (let index = 0; index < 20; index++) await mode.selectOption(index % 2 ? "bilingual" : "original");
    await expect.poll(async () => (await counts()).observers).toBe(1);
    const before = await counts();
    await page.evaluate(async () => {
      const outside = document.querySelector('#outside');
      for (let index = 0; index < 40; index++) { outside.textContent = `Unrelated comment ${index}`; await new Promise(requestAnimationFrame); }
    });
    expect((await counts()).tracks).toBe(before.tracks);
    await mode.selectOption("off");
    await expect.poll(counts).toMatchObject({ active: false, observers: 0, hooksRestored: true, videoReleased: true });
    expect(await page.locator('#ytp-caption-window-container').evaluate(node => node.style.visibility)).toBe("");
    const off = await counts(), calls = harness.server.calls.length;
    await page.locator('#outside').evaluate(node => { node.textContent = "Off update"; });
    await page.locator('.ytp-caption-segment').evaluate(node => { node.textContent = "Caption changes while off"; });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect((await counts()).tracks).toBe(off.tracks); expect(harness.server.calls.length).toBe(calls);
    for (let index = 0; index < 5; index++) {
      await mode.selectOption("bilingual");
      await expect.poll(counts).toMatchObject({ active: true, observers: 1 });
      await mode.selectOption("off");
      await expect.poll(counts).toMatchObject({ active: false, observers: 0, hooksRestored: true, videoReleased: true });
    }
    await page.screenshot({ path: testInfo.outputPath("subtitles-off-resources-released.png") });
    await testInfo.attach("resource-counts", { body: JSON.stringify({ before, off, final: await counts() }, null, 2), contentType: "application/json" });
  } finally { await page.close(); }
});
