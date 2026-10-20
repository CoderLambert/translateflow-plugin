import test from "node:test";
import assert from "node:assert/strict";
import { createFixture, cue, snapshot, translated, deferred, tick } from "./support/subtitle-controller-fixture.mjs";

// Behavioral reference: FluentRead 5a362c67 runtime.ts:446-500 and translationCache.ts:22-43.
// These are TranslateFlow integration regressions, not copies of upstream source or tests.
test("same-video late A response cannot appear beneath current B", async t => {
  const response = deferred();
  const h = createFixture({ translate: () => response.promise });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); const first = h.flush(); await tick();
  h.emit(snapshot([cue("B", 3)]));
  response.resolve(translated(h.requests[0])); await first;
  assert.equal(h.view.original, "B"); assert.equal(h.view.translation, "");
});

test("gap clears both lines without reporting a known track as missing", async t => {
  const h = createFixture(); await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); await h.flush(); assert.equal(h.view.translation, "T:A");
  h.emit(snapshot([], { mediaTime: 2.5 }));
  assert.equal(h.view.original, ""); assert.equal(h.view.translation, ""); assert.equal(h.view.status, "");
});

test("timed replay A after B restores a result without another transport call", async t => {
  const h = createFixture(); await h.controller.start(); t.after(() => h.controller.stop());
  for (const c of [cue("A", 1), cue("B", 3), cue("A", 1)]) { h.emit(snapshot([c])); await h.flush(); }
  assert.equal(h.view.original, "A"); assert.equal(h.view.translation, "T:A"); assert.equal(h.requests.length, 2);
});

test("original-only startup never enqueues translation", async t => {
  const h = createFixture({ mode: "original" }); await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)], { upcomingCues: [cue("B", 3)] })); await h.flush();
  assert.equal(h.view.original, "A"); assert.equal(h.requests.length, 0);
});

test("a short upcoming cue is translated before its start and appears immediately without another request", async t => {
  const response = deferred(), video = { currentTime: 0.1, seeking: false };
  const h = createFixture({ video, translate: () => response.promise });
  await h.controller.start(); t.after(() => h.controller.stop());
  const a = { id: "A", startTime: 0, endTime: 1, text: "A" }, b = { id: "B", startTime: 2, endTime: 2.2, text: "B" };
  h.emit(snapshot([a], { mediaTime: 0.1, upcomingCues: [b] })); const running = h.flush(); await tick();
  assert.deepEqual(Array.from(h.requests[0].units, unit => unit.text), ["A", "B"]);
  // The Provider completes after A has ended, before the short B starts.
  video.currentTime = 1.6; h.emit(snapshot([], { mediaTime: 1.6, upcomingCues: [b] })); await tick();
  response.resolve(translated(h.requests[0])); await running;
  assert.equal(h.view.translation, "");
  video.currentTime = 2; h.emit(snapshot([b], { mediaTime: 2 })); await tick();
  assert.equal(h.view.original, "B"); assert.equal(h.view.translation, "T:B"); assert.equal(h.requests.length, 1);
  video.currentTime = 2.2; h.emit(snapshot([], { mediaTime: 2.2 }));
  assert.equal(h.view.translation, "");
});

test("known timed cues enter the existing batch without waiting for DOM text stabilization", async t => {
  const h = createFixture(); await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)], { upcomingCues: [cue("B", 3)] })); await tick();
  assert.equal(h.pipelines[0].getState().candidates, 0);
  assert.equal(h.pipelines[0].getState().queued, 2);
});

test("an unsuccessful future cue does not report failure over a successful current cue", async t => {
  const h = createFixture({ translate: message => ({ ...translated(message), translations: translated(message).translations.filter(item => item.text === "T:A") }) });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)], { upcomingCues: [cue("B", 3)] })); await h.flush();
  assert.equal(h.requests[0].units.length, 2);
  assert.equal(h.view.translation, "T:A"); assert.equal(h.view.status, "");
});

test("a changed playback window drops queued old cues and dispatches the current cue first", async t => {
  const first = deferred();
  const h = createFixture({ pipelineOptions: { maxBatchItems: 1 }, translate: message => message.units[0].text === "A" ? first.promise : translated(message) });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)], { upcomingCues: [cue("B", 3), cue("C", 4)] })); const running = h.flush(); await tick();
  h.emit(snapshot([cue("D", 10)], { upcomingCues: [cue("E", 11)] })); await tick();
  first.resolve(translated(h.requests[0])); await running; await h.flush();
  assert.deepEqual(h.requests.flatMap(message => Array.from(message.units, unit => unit.text)), ["A", "D", "E"]);
  assert.equal(h.view.translation, "T:D");
});

test("seek revokes lookahead without starting another execution until the old transport settles", async t => {
  const first = deferred(), video = { currentTime: 1, seeking: false };
  const h = createFixture({ video, translate: message => message.units[0].text === "A" ? first.promise : translated(message) });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)], { upcomingCues: [cue("B", 3)] })); const running = h.flush(); await tick();
  video.seeking = true; video.currentTime = 10;
  h.emit(snapshot([cue("D", 10)], { seeking: true, upcomingCues: [cue("E", 11)] })); await tick();
  assert.equal(h.cancelled.length, 1); assert.equal(h.requests.length, 1); assert.equal(h.view.translation, "");
  video.seeking = false; h.emit(snapshot([cue("D", 10)], { upcomingCues: [cue("E", 11)] })); await tick();
  assert.equal(h.requests.length, 1);
  first.resolve(translated(h.requests[0])); await running; await h.flush();
  assert.equal(h.view.translation, "T:D");
  assert.deepEqual(Array.from(h.requests.at(-1).units, unit => unit.text), ["D", "E"]);
});

test("configuration invalidation cannot replay a prefetched result under the new settings", async t => {
  let revision = "old";
  const video = { currentTime: 1, seeking: false };
  const h = createFixture({ video, getContext: () => ({ ok: true, context: { translationRevision: revision } }), translate: message => translated(message, `${revision}:`) });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)], { upcomingCues: [cue("B", 3)] })); await h.flush();
  revision = "new"; await h.controller.invalidate({ retranslate: true }); await h.flush();
  video.currentTime = 3; h.emit(snapshot([cue("B", 3)])); await tick();
  assert.equal(h.view.translation, "new:B"); assert.equal(h.requests.length, 2);
});

test("off cancels active subtitle work before a slow settings write resolves", async t => {
  const response = deferred(), save = deferred();
  const h = createFixture({ translate: () => response.promise, saveSettings: () => save.promise });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); const running = h.flush(); await tick();
  const closing = h.controller.setMode("off");
  try {
    assert.equal(h.cancelled.length, 1); assert.equal(h.sources.at(-1).mode, "off");
    assert.equal(h.view.translation, "");
  } finally { save.resolve({ ok: true }); response.resolve(translated(h.requests[0])); await closing; await running; }
  assert.equal(h.view.translation, "");
});

test("original mode cancels pending translation and re-enable restores successes", async t => {
  const h = createFixture(); await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); await h.flush();
  await h.controller.setMode("original", { persist: false });
  assert.equal(h.view.translation, "");
  await h.controller.setMode("bilingual", { persist: false }); await h.flush();
  assert.equal(h.view.translation, "T:A"); assert.equal(h.requests.length, 1);
});

test("track replacement rejects old-language results in the same media", async t => {
  const response = deferred(); const h = createFixture({ translate: () => response.promise });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("same", 1, "Text")])); const first = h.flush(); await tick();
  h.emit(snapshot([cue("same", 1, "Text")], { track: { id: "fr", language: "fr", kind: "captions", label: "French" } }));
  response.resolve(translated(h.requests[0])); await first;
  assert.equal(h.view.translation, "");
});

test("overlapping cues render their corresponding translations in original order", async t => {
  const h = createFixture({ translate: message => ({ ...translated(message), translations: translated(message).translations.reverse() }) });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1), cue("B", 1)])); await h.flush();
  assert.equal(h.view.original, "A B"); assert.equal(h.view.translation, "T:A\nT:B");
});

test("same timed cue repeated in flight does not dispatch twice", async t => {
  const response = deferred(); const h = createFixture({ translate: () => response.promise });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); const first = h.flush(); await tick();
  h.emit(snapshot([cue("A", 1)])); await h.flush();
  response.resolve(translated(h.requests[0])); await first;
  assert.equal(h.requests.length, 1); assert.equal(h.view.translation, "T:A");
});

test("stopping while initial settings load cannot resurrect the controller", async () => {
  const settings = deferred(); const h = createFixture({ getSettings: () => settings.promise });
  const starting = h.controller.start(); await h.controller.stop();
  settings.resolve({ ok: true, settings: {} }); await starting;
  assert.equal(h.controller.getState().started, false);
  assert.equal(h.view.mounted, false); assert.equal(h.sources.length, 0);
});

test("late source callbacks after stop do not remount subtitle UI", async () => {
  const h = createFixture(); await h.controller.start();
  const oldSource = h.sources.at(-1); await h.controller.stop();
  oldSource.emit(snapshot([cue("A", 1)]));
  assert.equal(h.view.mounted, false); assert.equal(h.view.translation, "");
});

test("stopped pipeline cannot ingest after its asynchronous initial media switch", async () => {
  const h = createFixture(); const pipeline = h.modules.subtitlePipeline.createSubtitlePipeline({ setTimer: () => 1, clearTimer() {} });
  const ingesting = pipeline.ingest(snapshot([cue("A", 1)])); await pipeline.stop(); await ingesting;
  assert.equal(pipeline.getState().candidates, 0); assert.equal(pipeline.getState().queued, 0);
});

test("reset invalidates an ingest suspended at the initial scope switch", async () => {
  const h = createFixture(); const p = h.modules.subtitlePipeline.createSubtitlePipeline({ setTimer: () => 1, clearTimer() {} });
  const entering = p.ingest(snapshot([cue("A", 1)]));
  await p.reset(); await entering;
  assert.equal(p.getState().candidates, 0); assert.equal(p.getState().queued, 0); await p.stop();
});

test("a response rechecks the live media clock rather than a stale source snapshot", async t => {
  const response = deferred(), video = { currentTime: 1.5, seeking: false };
  const h = createFixture({ video, translate: () => response.promise });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); const running = h.flush(); await tick();
  video.currentTime = 2.5; // The clock moved, but the next source callback has not arrived yet.
  response.resolve(translated(h.requests[0])); await running;
  assert.equal(h.view.translation, "");
});

test("an incomplete overlapping batch cannot present one translation as the whole original", async t => {
  const h = createFixture({ translate: message => ({ ...translated(message), translations: translated(message).translations.slice(1) }) });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1), cue("B", 1)])); await h.flush();
  assert.equal(h.view.original, "A B"); assert.equal(h.view.translation, "");
});

test("old source callbacks remain detached after controller restart", async t => {
  const h = createFixture(); await h.controller.start(); const old = h.sources.at(-1);
  await h.controller.stop(); await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("New", 5)])); await h.flush();
  old.emit(snapshot([cue("Old", 1)]));
  assert.equal(h.view.original, "New"); assert.equal(h.view.translation, "T:New");
});

test("failed persistence never re-enables translation after off", async t => {
  const h = createFixture({ saveSettings: () => ({ ok: false, error: "storage failed" }) });
  await h.controller.start(); t.after(() => h.controller.stop());
  await assert.rejects(h.controller.setMode("off"));
  h.emit(snapshot([cue("A", 1)])); await h.flush();
  assert.equal(h.controller.getState().mode, "off"); assert.equal(h.requests.length, 0);
});

test("cached results are bounded and evicted cues may use the backend again", async t => {
  const h = createFixture(); await h.controller.start(); t.after(() => h.controller.stop());
  for (let index = 0; index < 161; index++) { h.emit(snapshot([cue(String(index), index * 2)])); await h.flush(); }
  h.emit(snapshot([cue("160", 320)])); await h.flush(); assert.equal(h.requests.length, 161);
  h.emit(snapshot([cue("0", 0)])); await h.flush(); assert.equal(h.requests.length, 162);
  assert.equal(h.view.translation, "T:0");
});

test("mode cancellation leaves a same-page non-subtitle task untouched", async t => {
  const h = createFixture(); await h.controller.start(); t.after(() => h.controller.stop());
  const pageTask = h.modules.tasks.createTask({ surface: "page" }); h.modules.tasks.transition(pageTask, "translating");
  h.emit(snapshot([cue("A", 1)])); await h.controller.setMode("original", { persist: false });
  h.modules.tasks.assertActive(pageTask); assert.equal(pageTask.state, "translating");
  assert.equal(h.cancelled.includes(pageTask.id), false);
});

for (const invalid of ["   ", { unexpected: true }]) test("invalid translation is not remembered as a replayable result: " + JSON.stringify(invalid), async t => {
  let first = true, time = 1000;
  const h = createFixture({ pipelineOptions: { now: () => time }, translate: message => {
    if (!first) return translated(message); first = false;
    return { ...translated(message), translations: [{ id: message.units[0].id, text: invalid }] };
  } });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); await h.flush();
  time += 2001; h.emit(snapshot([cue("A", 1)])); await h.flush();
  assert.equal(h.requests.length, 2); assert.equal(h.view.translation, "T:A");
});

test("seeking blocks a still-timed result until the source publishes the new position", async t => {
  const response = deferred(), video = { currentTime: 1.5, seeking: false };
  const h = createFixture({ video, translate: () => response.promise });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); const running = h.flush(); await tick();
  video.seeking = true; response.resolve(translated(h.requests[0])); await running;
  assert.equal(h.view.translation, ""); video.seeking = false;
  h.emit(snapshot([cue("A", 1)])); await h.flush(); assert.equal(h.view.translation, "T:A"); assert.equal(h.requests.length, 1);
});

test("a result larger than the in-memory byte budget is displayed but not retained", async t => {
  const result = "x".repeat(1024 * 1024 + 1);
  const h = createFixture({ translate: message => ({ ...translated(message), translations: [{ id: message.units[0].id, text: result }] }) });
  await h.controller.start(); t.after(() => h.controller.stop());
  for (const c of [cue("A", 1), cue("B", 3), cue("A", 1)]) { h.emit(snapshot([c])); await h.flush(); }
  assert.equal(h.requests.length, 3); assert.equal(h.view.translation, result);
});

const domSnapshot = text => snapshot(text ? [{ id: "yt:dom:0", startTime: null, endTime: null, text }] : [], { source: "youtube-dom", track: null });

test("a slow DOM prefix result may display while that exact phrase remains in the visible rolling caption", async t => {
  const response = deferred(), h = createFixture({ translate: () => response.promise });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(domSnapshot("Put your phones down.")); const running = h.flush(); await tick();
  h.emit(domSnapshot("Put your phones down. Put your laptop down.")); await tick();
  response.resolve(translated(h.requests[0])); await running;
  assert.equal(h.view.translation, "T:Put your phones down.");
  h.emit(domSnapshot("Put your phones down. Put your laptop down. Seriously."));
  assert.equal(h.view.translation, "T:Put your phones down.");
  h.emit(domSnapshot("A completely different caption."));
  assert.equal(h.view.translation, "");
});

test("a completed DOM phrase survives appended words but clears when the phrase scrolls out", async t => {
  const h = createFixture(); await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(domSnapshot("This is serious.")); await h.flush();
  h.emit(domSnapshot("This is serious. Put your phones down."));
  assert.equal(h.view.translation, "T:This is serious.");
  h.emit(domSnapshot("Put your phones down."));
  assert.equal(h.view.translation, "");
});

test("continuous DOM word updates cannot postpone translation beyond eight hundred milliseconds", async t => {
  let time = 1000;
  const h = createFixture({ pipelineOptions: { now: () => time } }); await h.controller.start(); t.after(() => h.controller.stop());
  for (let index = 0; index <= 8; index++) {
    time = 1000 + index * 100;
    h.emit({ ...domSnapshot(Array.from({ length: index + 1 }, (_, i) => `word${i}`).join(" ")), observedAt: time }); await tick();
    await h.pipelines[0].flush({ force: false });
    if (index < 8) assert.equal(h.requests.length, 0);
  }
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].units[0].text, "word0 word1 word2 word3 word4 word5 word6 word7 word8");
});

for (const middle of ["", "B"]) test("DOM replay A after " + (middle || "gap") + " restores without another translation", async t => {
  const h = createFixture(); await h.controller.start(); t.after(() => h.controller.stop());
  for (const text of ["A", middle, "A"]) { h.emit(domSnapshot(text)); await h.flush(); }
  assert.equal(h.view.translation, "T:A"); assert.equal(h.requests.length, middle ? 2 : 1);
});
test("DOM original/bilingual restores a successful result without another translation", async t => {
  const h = createFixture(); await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(domSnapshot("A")); await h.flush();
  await h.controller.setMode("original", { persist: false });
  await h.controller.setMode("bilingual", { persist: false }); await h.flush();
  assert.equal(h.view.translation, "T:A"); assert.equal(h.requests.length, 1);
});
test("changed effective context invalidates completed replay on route refresh", async t => {
  let target = "old";
  const h = createFixture({ getContext: () => ({ ok: true, context: { targetLanguage: target } }), translate: m => translated(m, target + ":") });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); await h.flush();
  target = "new"; await h.controller.refreshRoute(); await h.flush();
  assert.equal(h.view.translation, "new:A"); assert.equal(h.requests.length, 2);
});
test("same current cue failures back off while a new cue may proceed", async t => {
  let time = 1000;
  const h = createFixture({ pipelineOptions: { now: () => time }, translate: m => m.units.some(u => u.text === "A") ? { ok: false, errorCode: "HTTP_429" } : translated(m) });
  await h.controller.start(); t.after(() => h.controller.stop());
  for (let n = 0; n < 3; n++) { h.emit(snapshot([cue("A", 1)])); await h.flush(); }
  assert.equal(h.requests.length, 1);
  h.emit(snapshot([cue("B", 3)])); await h.flush(); assert.equal(h.view.translation, "T:B");
  time += 2001; h.emit(snapshot([cue("A", 1)])); await h.flush(); assert.equal(h.requests.length, 3);
});

test("configuration invalidation clears old output before a slow context read and replays only new config", async t => {
  const context = deferred(); let slow = false, revision = "old";
  const h = createFixture({ getContext: () => slow ? context.promise : { ok: true, context: { translationRevision: revision } }, translate: m => translated(m, revision + ":") });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); await h.flush();
  slow = true; revision = "new"; const refresh = h.controller.invalidate({ retranslate: true });
  assert.equal(h.view.translation, "");
  context.resolve({ ok: true, context: { translationRevision: revision } }); await refresh; await h.flush();
  assert.equal(h.view.translation, "new:A");
});
test("cache invalidation clears replay without starting another translation", async t => {
  const h = createFixture(); await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); await h.flush();
  await h.controller.invalidate(); assert.equal(h.view.translation, ""); assert.equal(h.requests.length, 1);
  h.emit(snapshot([cue("A", 1)])); await h.flush();
  assert.equal(h.requests.length, 2); assert.equal(h.view.translation, "T:A");
});

test("a failed old caption does not strand the already queued current caption", async t => {
  const first = deferred();
  const h = createFixture({ pipelineOptions: { stabilityMs: 0, batchDelayMs: 0, setTimer: (fn) => setImmediate(fn), clearTimer: clearImmediate },
    translate: m => m.units[0].text === "A" ? first.promise : translated(m) });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); const running = h.flush(); await tick();
  h.emit(snapshot([cue("B", 3)])); await h.flush();
  first.resolve({ ok: false, errorCode: "HTTP_429" }); await running;
  await tick(); await tick();
  assert.equal(h.view.translation, "T:B"); assert.equal(h.requests.length, 2);
});
test("partial subtitle retry preserves successful overlap results and requests only missing cues", async t => {
  let time = 1000, first = true;
  const h = createFixture({ pipelineOptions: { now: () => time }, translate: m => {
    const response = translated(m); if (first) { first = false; response.translations.splice(1); } return response;
  } });
  await h.controller.start(); t.after(() => h.controller.stop());
  const frame = snapshot([cue("A", 1), cue("B", 1)]);
  h.emit(frame); await h.flush(); assert.equal(h.view.translation, "");
  h.emit(frame); await h.flush(); assert.equal(h.requests.length, 1);
  time += 2001; h.emit(frame); await h.flush();
  assert.deepEqual(Array.from(h.requests[1].units, u => u.text), ["B"]); assert.equal(h.view.translation, "T:A\nT:B");
});
