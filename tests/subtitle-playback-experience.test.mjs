import test from "node:test";
import assert from "node:assert/strict";
import { createFixture, cue, snapshot, translated, deferred, tick } from "./support/subtitle-controller-fixture.mjs";

// A current cue must be usable while future work is still unresolved.
test("current subtitle returns before future batches and prefetch promotion reuses its request", async t => {
  const future = deferred(), video = { currentTime: 1, seeking: false };
  const h = createFixture({ video, translate: message => message.units.some(unit => unit.text !== "A") ? future.promise : translated(message) });
  await h.controller.start();
  t.after(async () => { future.resolve({ ok: true, translations: [] }); await h.controller.stop(); });
  const b = cue("B", 3);
  h.emit(snapshot([cue("A", 1)], { upcomingCues: [b, cue("C", 4), cue("D", 5), cue("E", 6), cue("F", 7)] }));
  const running = h.flush(); await tick(); await tick();
  assert.deepEqual(Array.from(h.requests[0].units, unit => unit.text), ["A"]);
  assert.equal(h.view.translation, "T:A");
  assert.deepEqual(Array.from(h.requests[1].units, unit => unit.text), ["B", "C"]);
  video.currentTime = 3;
  h.emit(snapshot([b], { upcomingCues: [cue("C", 4)] })); await tick();
  assert.equal(h.requests.length, 2, "promotion must not start a parallel or duplicate request");
  future.resolve(translated(h.requests[1])); await running; await tick();
  assert.equal(h.view.translation, "T:B");
  assert.equal(h.requests.length, 2, "obsolete unstarted future cues must be dropped");
});

test("a full prefetch queue never evicts the current subtitle", async t => {
  const h = createFixture({ pipelineOptions: { maxQueue: 2 } });
  await h.controller.start(); t.after(() => h.controller.stop());
  h.emit(snapshot([cue("A", 1)], { upcomingCues: [cue("B", 3), cue("C", 4), cue("D", 5)] }));
  await h.flush();
  assert.equal(h.requests[0].units[0].text, "A");
  assert.equal(h.view.translation, "T:A");
});

test("a nearer future cue replaces farther queued work while the current request is pending", async t => {
  const first = deferred();
  const h = createFixture({ pipelineOptions: { maxQueue: 2 }, translate: message => message.units[0].text === "A" ? first.promise : translated(message) });
  await h.controller.start();
  t.after(async () => { first.resolve({ ok: true, translations: [] }); await h.controller.stop(); });
  const a = cue("A", 1), b = cue("B", 5), c = cue("C", 10), d = cue("D", 3);
  h.emit(snapshot([a], { upcomingCues: [b, c] })); const running = h.flush(); await tick();
  h.emit(snapshot([a], { upcomingCues: [d, b, c] })); await tick();
  first.resolve(translated(h.requests[0])); await running;
  assert.deepEqual(h.requests.map(message => Array.from(message.units, unit => unit.text)), [["A"], ["D", "B"]]);
});

test("double-speed future window survives repeated normalization and remains bounded", () => {
  const { modules } = createFixture();
  const source = modules.subtitleSource;
  const cues = Array.from({ length: 30 }, (_, i) => cue(String(i), 2 + i * 2));
  const input = snapshot([], { mediaTime: 1, playbackRate: 2, upcomingCues: cues });
  const value = source.normalizeSnapshot(source.normalizeSnapshot(input));
  assert.equal(value.playbackRate, 2);
  assert.equal(value.upcomingCues.length, 10);
  assert.equal(value.upcomingCues.at(-1).startTime, 20);
  assert.deepEqual(Array.from(source.createCueTimeline(cues).upcomingAt(1, 2), c => c.id), Array.from(value.upcomingCues, c => c.id));
  assert.equal(source.normalizeSnapshot({ ...input, playbackRate: 1 }).upcomingCues.length, 5);
  for (const rate of [Infinity, NaN, -1, 0, null, "invalid"]) {
    const invalid = source.normalizeSnapshot({ ...input, playbackRate: rate });
    assert.equal(invalid.playbackRate, 1);
    assert.equal(invalid.upcomingCues.length, 5);
  }
  const bounded = source.normalizeSnapshot({ ...input, playbackRate: 1000 });
  assert.equal(bounded.playbackRate, 4); assert.ok(bounded.upcomingCues.length <= 10);
  assert.ok(bounded.upcomingCues.every(c => c.startTime <= 49));
});
