import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/content/selection/dictionary-first.js", import.meta.url), "utf8");

function harness() {
  const views = [], completed = [], snapshot = {}, task = {};
  let active = true;
  const app = { modules: {
    selectionPopover: { showEmpty: (...args) => views.push(args) },
    tasks: {
      assertActive(value) {
        assert.equal(value, task);
        if (!active) throw Object.assign(new Error("inactive"), { code: "CANCELLED" });
      },
      completeTask: value => completed.push(value)
    }
  } };
  vm.runInNewContext(source, { __TRANSLATE_FLOW_CONTENT__: app });
  return { views, completed, snapshot, task, run: app.modules.selectionDictionaryFirst.run,
    cancel() { active = false; } };
}

test("rich hit preserves the initial view and optional AI callback without invoking AI", async () => {
  const h = harness();
  let aiCalls = 0;
  const onExplain = () => { aiCalls++; };
  assert.equal(await h.run(h.snapshot, h.task, async options => {
    assert.equal(options.eager, true);
    assert.equal(options.allowVocabularyFallback, true);
    options.onSettled({ hasHit: true });
  }, onExplain), true);
  assert.equal(h.views.length, 1);
  assert.equal(h.views[0][0], h.snapshot);
  assert.equal(h.views[0][1].onExplain, onExplain);
  assert.deepEqual(h.completed, [h.task]);
  assert.equal(aiCalls, 0);
});

test("rich miss returns control to the existing fallback without completing the task", async () => {
  const h = harness();
  assert.equal(await h.run(h.snapshot, h.task, async options => options.onSettled({ hasHit: false })), false);
  assert.equal(h.views[0][1].onExplain, null);
  assert.deepEqual(h.completed, []);
});

test("cancelled or superseded rich lookups never complete the task", async () => {
  for (const superseded of [false, true]) {
    const h = harness();
    await assert.rejects(h.run(h.snapshot, h.task, async options => {
      if (superseded) h.cancel();
      options.onSettled({ hasHit: true, cancelled: !superseded });
    }), { code: "CANCELLED" });
    assert.deepEqual(h.completed, []);
  }
});
