import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const sources = await Promise.all([
  "../src/content/tasks.js",
  "../src/content/selection/result-model.js",
  "../src/content/selection/translation-query.js",
  "../src/content/selection/controller.js"
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const documentListeners = new Map(), windowListeners = new Map();
  const messages = [], chips = [], results = [], errors = [], accepted = [], statuses = [], storeAcks = [], chipWaiters = [];
  const storeStarted = deferred(), secondStoreStarted = deferred();
  const pageUrl = "https://fixture.invalid/article";
  const location = { href: pageUrl };
  let selectedText = "current selected text", onTranslate = null, onCancel = null, chipCount = 0;
  const cancelHandlers = [];
  let stored = false, cancelButtonDisabled = false;

  const sendRuntimeMessage = async (request) => {
    messages.push(request);
    switch (request.type) {
      case "selection-resolve":
        return { ok: true, route: "translation", intent: { kind: "translation", sourceLanguage: "en" }, explanationAllowed: false };
      case "cache-lookup":
        return { ok: true, hits: [] };
      case "translate-batch":
        return { ok: true, translations: [{ id: "selection", text: `${request.segments[0].text} translated` }],
          readingResult: { targetLanguage: "zh-CN", provenance: { provider: "synthetic" } } };
      case "cache-store":
        {
          const index = storeAcks.length;
          const storeAck = deferred();
          storeAcks.push(storeAck);
          (index === 0 ? storeStarted : secondStoreStarted).resolve();
          const result = await storeAck.promise;
          if (result?.ok) stored = true;
          return result;
        }
      case "cancel-translation":
        return { ok: true, cancelled: false };
      default:
        throw new Error(`Unexpected message: ${request.type}`);
    }
  };

  const app = { modules: {
    runtime: { messages: { background: {
      SELECTION_RESOLVE: "selection-resolve", CACHE_LOOKUP: "cache-lookup", TRANSLATE_BATCH: "translate-batch",
      CACHE_STORE: "cache-store", CANCEL_TRANSLATION: "cancel-translation"
    } }, sendRuntimeMessage, getPageIdentity: (value) => value, showToast() {} },
    contentI18n: createContentI18nStub(),
    selection: { readSelection: () => ({ text: selectedText, pageUrl, sourceRevision: 1, range: {}, rect: {} }),
      isExtensionOwnedNode: () => false },
    selectionContext: { captureSelectionContext: () => ({ text: "safe synthetic context", sensitive: false }) },
    textProjection: { start() {}, watchPage() {}, revision: () => 1, sameRange: () => true },
    selectionPopover: {
      setCloseHandler(handler) { this.closeHandler = handler; },
      showChip(_snapshot, handler) {
        onTranslate = handler;
        chips.push(selectedText);
        chipCount++;
        chipWaiters.filter(waiter => waiter.count <= chipCount).forEach(waiter => waiter.resolve());
      },
      showLoading(_snapshot, handler) { onCancel = handler; cancelHandlers.push(handler); cancelButtonDisabled = false; },
      setLoadingStatus(status) { statuses.push(status); },
      setLoadingCancelable(cancelable) { cancelButtonDisabled = !cancelable; },
      showResult(_snapshot, card) { results.push(card); },
      showError(_snapshot, message) { errors.push(message); },
      hide() {}, reposition() {}, contains: () => false
    },
    selectionClipboard: { writeText: async () => {} },
    selectionMessages: { unresolvedMessage: () => "content.selection.resolveFailed" },
    selectionRichDetails: { load: async () => {}, cancel: async () => {}, bindLifecycle() {} },
    selectionRecordClient: { create: () => ({
      start({ snapshot, capture }) { return { snapshot, capture, operations: [] }; },
      accept(_context, artifact) { accepted.push(artifact); },
      close: async () => null, invalidateReference() {}, refresh: async () => {}, render() {},
      save: async () => {}, retry: async () => {}, open: async () => {}, decline() {}
    }) },
    selectionRecordStatus: { update() {}, clear() {} },
    selectionSourceSnapshot: { capture(snapshot) { return { selectedText: snapshot.text, sourceRevision: snapshot.sourceRevision,
      sourceSnapshotId: "snapshot-1", documentGeneration: "document-1", selectionGeneration: snapshot.selectionGeneration,
      ready: Promise.resolve({ selectedText: snapshot.text, sourceSnapshotId: "snapshot-1", documentGeneration: "document-1",
        selectionGeneration: snapshot.selectionGeneration, anchor: { status: "unsupported", quote: { exact: snapshot.text } } }) }; } },
    quickControl: { setSelectionActive() {} }
  } };

  const document = {
    title: "Synthetic title", visibilityState: "visible", body: {},
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener() {}
  };
  const window = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener() {}
  };
  const realm = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document, window, location, crypto,
    setTimeout, clearTimeout, URL, Date, console });
  for (const source of sources) vm.runInContext(source, realm);
  app.modules.selectionController.start();
  documentListeners.get("mouseup")({ target: {} });

  return {
    messages, chips, results, errors, accepted, statuses, appModules: app.modules, ready: waitForChip(1), storeStarted: storeStarted.promise,
    secondStoreStarted: secondStoreStarted.promise, waitForChip,
    resolveStore: (index = 0, result = { ok: true }) => storeAcks[index].resolve(result), get stored() { return stored; },
    get cancelButtonDisabled() { return cancelButtonDisabled; },
    stop: () => onCancel?.(), translate: () => onTranslate?.({ isTrusted: true }),
    stopAt: (index) => cancelHandlers[index]?.(),
    getTask: () => app.modules.tasks.getLatestTask("selection"),
    setSelectedText(value) { selectedText = value; documentListeners.get("mouseup")({ target: {} }); },
    close: () => app.modules.selectionPopover.closeHandler?.(),
    location, windowListeners
  };

  function waitForChip(count) {
    if (chipCount >= count) return Promise.resolve();
    return new Promise(resolve => chipWaiters.push({ count, resolve }));
  }
}

test("Stop after Selection cache write starts completes the real committed result instead of claiming cancellation", async () => {
  const h = harness();
  await h.ready;
  const pending = h.translate();
  await h.storeStarted;

  h.stop();
  h.resolveStore();
  await pending;

  assert.equal(h.stored, true);
  assert.equal(h.getTask().state, "completed");
  assert.equal(h.cancelButtonDisabled, true);
  assert.equal(h.messages.filter((message) => message.type === "cancel-translation").length, 0);
  assert.deepEqual(h.errors, []);
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].primaryMeaning, "current selected text translated");
  assert.equal(h.accepted.length, 1);
  assert.equal(h.accepted[0].payload.text, "current selected text translated");
});

test("Stop before Selection cache storage begins cancels the request", async () => {
  const h = harness();
  await h.ready;
  const pending = h.translate();
  h.stop();
  await pending;

  assert.equal(h.getTask().state, "cancelled");
  assert.equal(h.messages.filter(message => message.type === "cancel-translation").length, 1);
  assert.equal(h.messages.filter(message => message.type === "cache-store").length, 0);
  assert.ok(h.errors.includes("content.selection.cancelled"));
  assert.equal(h.accepted.length, 0);
});

test("a new Selection invalidates pending old storage without replacing its task or Reading record", async () => {
  const h = harness();
  await h.ready;
  const oldQuery = h.translate();
  await h.storeStarted;
  const oldTaskId = h.getTask().id;

  h.setSelectedText("new selected text");
  await h.waitForChip(2);
  const newQuery = h.translate();
  h.stopAt(0);
  assert.equal(h.messages.filter(message => message.type === "cancel-translation").length, 1);
  assert.deepEqual(h.errors, []);
  await h.secondStoreStarted;
  h.resolveStore(1);
  await newQuery;
  const newTaskId = h.messages.filter(message => message.type === "translate-batch").at(-1).requestId;
  const newTask = h.appModules.tasks.getTaskStatus(newTaskId);

  h.resolveStore(0);
  await oldQuery;

  assert.notEqual(newTaskId, oldTaskId);
  assert.equal(newTask.id, newTaskId);
  assert.equal(newTask.state, "completed");
  assert.equal(h.appModules.tasks.getTaskStatus(newTaskId).state, "completed");
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].primaryMeaning, "new selected text translated");
  assert.equal(h.accepted.length, 1);
  assert.equal(h.accepted[0].payload.text, "new selected text translated");
});

test("dismiss after storage starts permits the commit but suppresses stale UI and Reading output", async () => {
  const h = harness();
  await h.ready;
  const pending = h.translate();
  await h.storeStarted;
  const taskId = h.messages.find(message => message.type === "translate-batch").requestId;

  h.close();
  h.resolveStore();
  await pending;

  assert.equal(h.stored, true);
  assert.equal(h.appModules.tasks.getTaskStatus(taskId).state, "cancelled");
  assert.deepEqual(h.results, []);
  assert.deepEqual(h.errors, []);
  assert.equal(h.accepted.length, 0);
});

test("Selection cache quota failure remains visible after storage begins", async () => {
  const h = harness();
  await h.ready;
  const pending = h.translate();
  await h.storeStarted;
  h.resolveStore(0, { ok: false, errorCode: "QUOTA_EXCEEDED" });
  await pending;

  assert.equal(h.getTask().state, "failed");
  assert.equal(h.getTask().errorCode, "QUOTA_EXCEEDED");
  assert.ok(h.errors.includes("content.selection.cacheStoreFailed"));
  assert.equal(h.results.length, 0);
  assert.equal(h.accepted.length, 0);
});
