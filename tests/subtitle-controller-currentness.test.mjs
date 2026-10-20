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
  h.emit(snapshot([cue("A", 1)])); await h.flush();
  assert.equal(h.view.original, "A"); assert.equal(h.requests.length, 0);
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
  let first = true;
  const h = createFixture({ translate: message => {
    if (!first) return translated(message); first = false;
    return { ...translated(message), translations: [{ id: message.units[0].id, text: invalid }] };
  } });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)])); await h.flush();
  h.emit(snapshot([cue("A", 1)])); await h.flush();
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
