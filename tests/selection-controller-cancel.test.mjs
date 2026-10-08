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

function harness({ resolveRoute = "translation", readingRecords = true } = {}) {
  const documentListeners = new Map(), windowListeners = new Map();
  const messages = [], chips = [], results = [], resultActions = [], errors = [], accepted = [], statuses = [], storeAcks = [], chipWaiters = [];
  const assistantPorts = [], vocabularyAdds = [];
  const storeStarted = deferred(), secondStoreStarted = deferred();
  const pageUrl = "https://fixture.invalid/article";
  const location = { href: pageUrl };
  let selectedText = "current selected text", onTranslate = null, onCancel = null, chipCount = 0;
  let projectionRevision = 1, onProjectionChange = null, onAssistantStop = null;
  const cancelHandlers = [];
  let stored = false, cancelButtonDisabled = false;

  const sendRuntimeMessage = async (request) => {
    messages.push(request);
    switch (request.type) {
      case "selection-resolve":
        if (resolveRoute === "local") return { ok: true, route: "local", explanationAllowed: true, depth: "standard",
          intent: { kind: "lexical", sourceLanguage: "en" }, decision: { topCandidateId: "persistent", candidates: [{
            id: "persistent", kind: "lexical", headword: "persistent", pronunciation: "/pərˈsɪstənt/", partOfSpeech: "adjective",
            translations: ["持久的"], examples: [], provenance: { packId: "core", packVersion: "1",
              sourceRefs: [{ sourceId: "pwn-3.0", recordId: "persistent-entry" }] }
          }] } };
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

  function connectAssistant() {
    let onMessage = null, onDisconnect = null;
    const session = { messages: [], disconnected: false };
    session.port = {
      onMessage: { addListener(listener) { onMessage = listener; } },
      onDisconnect: { addListener(listener) { onDisconnect = listener; } },
      postMessage(message) { session.messages.push(message); },
      disconnect() { session.disconnected = true; }
    };
    session.emit = message => onMessage?.(message);
    session.disconnectExternally = () => onDisconnect?.();
    assistantPorts.push(session);
    return session.port;
  }

  const app = { modules: {
    runtime: { messages: { background: {
      SELECTION_RESOLVE: "selection-resolve", CACHE_LOOKUP: "cache-lookup", TRANSLATE_BATCH: "translate-batch",
      CACHE_STORE: "cache-store", CANCEL_TRANSLATION: "cancel-translation"
    } }, sendRuntimeMessage, getPageIdentity: (value) => value, showToast() {} },
    contentI18n: createContentI18nStub(),
    selection: { readSelection: () => ({ text: selectedText, pageUrl, sourceRevision: 1, range: {}, rect: {} }),
      isExtensionOwnedNode: () => false },
    selectionContext: { captureSelectionContext: () => ({ text: "safe synthetic context", sensitive: false }) },
    textProjection: { start(callback) { onProjectionChange = callback; }, watchPage() {}, revision: () => projectionRevision, sameRange: () => true },
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
      showResult(_snapshot, card, _copy, onExplain, onSave, onOpen) {
        results.push(card); resultActions.push({ onExplain, onSave, onOpen });
      },
      showError(_snapshot, message) { errors.push(message); },
      showAiDetailStreaming(_answer, onStop) { onAssistantStop = onStop; },
      showAiDetailStopping() {},
      showAiDetailResult() {},
      showAiDetailInterrupted() {},
      hide() {}, reposition() {}, contains: () => false
    },
    selectionClipboard: { writeText: async () => {} },
    selectionMessages: { unresolvedMessage: () => "content.selection.resolveFailed" },
    selectionRichDetails: { load: async () => {}, cancel: async () => {}, bindLifecycle() {} },
    selectionVocabularyBook: { create: () => ({
      add: async (entry, event) => { vocabularyAdds.push({ entry, event }); return { added: true }; },
      open: async () => ({})
    }) },
    selectionRecordClient: { create: () => readingRecords ? ({
      start({ snapshot, capture }) { return { snapshot, capture, operations: [] }; },
      assistant(context) { const operation = { operationId: `assistant-${context.operations.length + 1}` }; context.operations.push(operation); return operation; },
      accept(_context, artifact) { accepted.push(artifact); },
      close: async () => null, discard: async () => {}, invalidateReference() {}, refresh: async () => {}, render() {},
      save: async () => {}, retry: async () => {}, open: async () => {}, decline() {}
    }) : null },
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
  const chrome = { runtime: { connect: connectAssistant } };
  const realm = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document, window, location, chrome, crypto,
    setTimeout, clearTimeout, URL, Date, console });
  for (const source of sources) vm.runInContext(source, realm);
  app.modules.selectionController.start();
  documentListeners.get("mouseup")({ target: {} });

  return {
    messages, chips, results, resultActions, errors, accepted, statuses, appModules: app.modules, assistantPorts, vocabularyAdds,
    ready: waitForChip(1), storeStarted: storeStarted.promise,
    secondStoreStarted: secondStoreStarted.promise, waitForChip,
    resolveStore: (index = 0, result = { ok: true }) => storeAcks[index].resolve(result), get stored() { return stored; },
    get cancelButtonDisabled() { return cancelButtonDisabled; },
    stop: () => onCancel?.(), translate: () => onTranslate?.({ isTrusted: true }),
    explain: (index = 0) => resultActions[index]?.onExplain?.({ isTrusted: true }, "understand"),
    save: (index = 0) => resultActions[index]?.onSave?.({ isTrusted: true }),
    stopAssistant: () => onAssistantStop?.(),
    completeAssistant(text = "AI explanation") {
      const session = assistantPorts.at(-1), start = session?.messages.find(message => message.type === "start");
      session?.emit({ protocolVersion: 1, type: "complete", requestId: start?.requestId, text,
        turn: { completionStatus: "completed", assistantAnswer: text },
        readingResult: { targetLanguage: "zh-CN", sourceLanguage: "en", provenance: { provider: "synthetic" } } });
    },
    stopAt: (index) => cancelHandlers[index]?.(),
    getTask: () => app.modules.tasks.getLatestTask("selection"),
    setSelectedText(value) { selectedText = value; documentListeners.get("mouseup")({ target: {} }); },
    changeProjection({ notify = false } = {}) { projectionRevision++; if (notify) onProjectionChange?.(); },
    navigateTo(url, { notify = false } = {}) { location.href = url; if (notify) windowListeners.get("popstate")?.(); },
    close: () => app.modules.selectionPopover.closeHandler?.(),
    location, windowListeners
  };

  function waitForChip(count) {
    if (chipCount >= count) return Promise.resolve();
    return new Promise(resolve => chipWaiters.push({ count, resolve }));
  }
}

test("a local dictionary save remains valid while its optional AI explanation is streaming", async () => {
  const h = harness({ resolveRoute: "local", readingRecords: false });
  await h.ready;
  await h.translate();
  await h.save();
  assert.equal(h.vocabularyAdds.length, 1);

  await h.explain();
  assert.equal(h.assistantPorts.length, 1);
  await h.save();

  assert.equal(h.vocabularyAdds.length, 2);
});

test("a local dictionary save remains valid after its optional AI explanation completes", async () => {
  const h = harness({ resolveRoute: "local" });
  await h.ready;
  await h.translate();
  await h.explain();
  h.completeAssistant();

  await h.save();

  assert.equal(h.vocabularyAdds.length, 1);
});

test("a local dictionary save remains valid after its optional AI explanation is stopped", async () => {
  const h = harness({ resolveRoute: "local" });
  await h.ready;
  await h.translate();
  await h.explain();
  h.stopAssistant();

  await h.save();

  assert.equal(h.vocabularyAdds.length, 1);
});

test("a new selection invalidates a saved local dictionary result", async () => {
  const h = harness({ resolveRoute: "local" });
  await h.ready;
  await h.translate();
  const save = h.resultActions[0].onSave;

  h.setSelectedText("new selected text");
  await h.waitForChip(2);

  assert.throws(() => save({ isTrusted: true }), error => error.i18nKey === "content.vocabulary.updated");
  assert.equal(h.vocabularyAdds.length, 0);
});

test("navigation and projection changes invalidate a saved local dictionary result", async () => {
  const page = harness({ resolveRoute: "local" });
  await page.ready;
  await page.translate();
  const pageSave = page.resultActions[0].onSave;
  page.navigateTo("https://fixture.invalid/another-page");
  assert.throws(() => pageSave({ isTrusted: true }), error => error.i18nKey === "content.vocabulary.updated");
  assert.equal(page.vocabularyAdds.length, 0);

  const projection = harness({ resolveRoute: "local" });
  await projection.ready;
  await projection.translate();
  const projectionSave = projection.resultActions[0].onSave;
  projection.changeProjection();
  assert.throws(() => projectionSave({ isTrusted: true }), error => error.i18nKey === "content.vocabulary.updated");
  assert.equal(projection.vocabularyAdds.length, 0);
});

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
