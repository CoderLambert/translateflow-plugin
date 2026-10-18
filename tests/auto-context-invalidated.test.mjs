import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const source = await readFile(new URL("../src/content/auto.js", import.meta.url), "utf8");
const invalidated = () => new Error("Extension context invalidated.");
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ failure = invalidated(), processPage = async () => ({}), settingsFailure = null } = {}) {
  let now = 10_000, nextTimer = 0, attempts = 0, settingsCalls = 0;
  const timers = new Map(), observers = [], toasts = [], calls = [];
  const element = { hasAttribute: () => false };
  const state = { auto: false, cacheRestore: false, autoDrainRunning: false, manualRunning: false,
    pending: new Set(), autoTimer: null, autoBackoffUntil: 0, lastAutoErrorAt: 0, startupRestorePromise: null };
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    unobserve() {}
    disconnect() { this.disconnected = true; }
  }
  const app = { modules: {
    runtime: { state, constants: { AUTO_DEBOUNCE_MS: 180 }, messages: { background: { PUBLIC_SETTINGS_GET: "settings" } },
      getPageIdentity: value => value, getSiteScope: () => "https://fixture.invalid",
      sendRuntimeMessage: async () => { settingsCalls++; if (settingsFailure) throw settingsFailure; return { settings: {} }; },
      showToast: (message, kind) => toasts.push({ message, kind }) },
    contentI18n: createContentI18nStub({ messages: { "content.ai.extensionReloaded": "扩展已更新，请刷新当前网页后重试。" } }),
    tasks: { createTask: options => ({ ...options }), completeTask() {}, failTask() {}, releaseTask() {} },
    dom: { collectElements: () => [element], isCandidateElement: () => true,
      extractSourceText: () => "Synthetic paragraph for automatic translation.", shouldTranslate: () => true },
    batch: { buildEntries: elements => elements.map(el => ({ el, text: "synthetic" })),
      groupEntriesByText: entries => entries.map(entry => ({ ...entry, elements: [entry.el] })), makeBatches: groups => [groups] },
    processor: { processPage, processGroupBatch: async (_groups, options) => {
      attempts++; calls.push(options); if (failure) throw failure;
      return { cacheHits: 0, apiTranslated: 1 };
    } }
  } };
  vm.runInNewContext(source, { __TRANSLATE_FLOW_CONTENT__: app, location: { href: "https://fixture.invalid/article" },
    document: { contains: () => true, documentElement: {} }, IntersectionObserver: Observer, MutationObserver: Observer,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id), Date: { now: () => now }, queueMicrotask });
  return { state, timers, observers, toasts, calls, auto: app.modules.auto,
    get attempts() { return attempts; }, get settingsCalls() { return settingsCalls; },
    enqueue() { observers[0].callback([{ isIntersecting: true, target: element }]); },
    async drain() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id); now += timer.delay; timer.fn(); await tick();
    }
  };
}

for (const mode of ["auto", "cache", "both"]) {
  test(`invalidated ${mode} mode stops observers, pending work and retries with one refresh notice`, async () => {
    const h = harness();
    if (mode !== "auto") await h.auto.enableCacheRestoreMode({ initialRestore: false });
    if (mode !== "cache") await h.auto.enableAutoMode();
    h.enqueue(); await h.drain();
    assert.equal(h.attempts, 1);
    assert.equal(h.calls[0].cacheOnly, mode === "cache");
    assert.equal(h.state.auto, false); assert.equal(h.state.cacheRestore, false);
    assert.equal(h.state.autoDrainRunning, false); assert.equal(h.state.autoBackoffUntil, 0);
    assert.equal(h.state.pending.size, 0); assert.equal(h.state.autoTimer, null);
    assert.equal(h.timers.size, 0); assert.ok(h.observers.every(observer => observer.disconnected));
    assert.deepEqual(h.toasts, [{ message: "扩展已更新，请刷新当前网页后重试。", kind: "error" }]);
    // Queued observer notifications and later enable attempts cannot revive the old context.
    h.enqueue(); h.auto.scheduleAutoDrain(); h.auto.rescanAutoPage();
    await h.auto.enableAutoMode({ announce: true });
    await h.auto.enableCacheRestoreMode({ announce: true });
    await h.auto.maybeStartPersistentModes(); await h.auto.maybeStartAutoMode();
    assert.equal(h.settingsCalls, 0); assert.equal(h.timers.size, 0);
    assert.equal(h.attempts, 1); assert.equal(h.toasts.length, 1);
  });
}

for (const mode of ["auto", "cache"]) {
  test(`ordinary network failures retain ${mode} retry behavior`, async () => {
    const h = harness({ failure: new Error("Temporary network failure") });
    if (mode === "auto") await h.auto.enableAutoMode();
    else await h.auto.enableCacheRestoreMode({ initialRestore: false });
    h.enqueue(); await h.drain();
    assert.equal(h.state[mode === "auto" ? "auto" : "cacheRestore"], true);
    assert.ok(h.observers.every(observer => !observer.disconnected));
    assert.equal(h.timers.size, 1);
    await h.drain(); assert.equal(h.attempts, 2);
    assert.equal(h.toasts.some(toast => toast.message.includes("扩展已更新")), false);
  });
}

test("startup settings invalidation is handled once without scheduling work", async () => {
  const h = harness({ settingsFailure: invalidated() });
  await h.auto.maybeStartPersistentModes(); await h.auto.maybeStartAutoMode();
  assert.equal(h.settingsCalls, 1); assert.equal(h.toasts.length, 1);
  assert.equal(h.observers.length, 0); assert.equal(h.timers.size, 0);
});

test("startup restore invalidation cannot be followed by a waiting auto enable", async () => {
  let reject;
  const pending = new Promise((_resolve, fail) => { reject = fail; });
  const h = harness({ processPage: () => pending });
  const restore = h.auto.enableCacheRestoreMode(), auto = h.auto.enableAutoMode();
  reject(invalidated()); await Promise.all([restore, auto]);
  assert.equal(h.state.auto, false); assert.equal(h.state.cacheRestore, false);
  assert.equal(h.state.startupRestorePromise, null); assert.equal(h.toasts.length, 1);
  assert.equal(h.observers.length, 0); assert.equal(h.timers.size, 0);
});

test("a fresh page context can enable automatic translation normally", async () => {
  const h = harness({ failure: null });
  await h.auto.enableAutoMode(); h.enqueue(); await h.drain();
  assert.equal(h.attempts, 1); assert.equal(h.state.auto, true); assert.equal(h.toasts.length, 0);
});
