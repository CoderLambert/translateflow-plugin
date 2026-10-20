import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const sources = await Promise.all([
  "../src/content/tasks.js",
  "../src/content/selection/result-model.js",
  "../src/content/selection/translation-query.js",
  "../src/content/selection/assistant-persistence.js",
  "../src/content/selection/dictionary-first.js",
  "../src/content/selection/controller.js"
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness({ resolveRoute = "translation", readingRecords = true, runtimeFailure = "", preferRich = false, explanationAllowed = true, deferRich = false, resolvedSelection = null } = {}) {
  const documentListeners = new Map(), windowListeners = new Map();
  const messages = [], chips = [], results = [], resultActions = [], errors = [], accepted = [], statuses = [], storeAcks = [], chipWaiters = [], assistantInterruptions = [];
  const assistantPorts = [], vocabularyAdds = [], aiPersistence = [], emptyViews = [], assistantAnswers = [], assistantUpdates = [], richLookups = [], assistantRetries = [];
  const storeStarted = deferred(), secondStoreStarted = deferred();
  const pageUrl = "https://fixture.invalid/article";
  const location = { href: pageUrl };
  let selectedText = "current selected text", onTranslate = null, onCancel = null, chipCount = 0;
  let projectionRevision = 1, onProjectionChange = null, onAssistantStop = null;
  let sourceMatches = true, rangeConnected = true, rangeText = null, hideCount = 0, repositionCount = 0, referenceInvalidations = 0;
  const rangeEndpoint = { get isConnected() { return rangeConnected; } };
  const cancelHandlers = [];
  let stored = false, cancelButtonDisabled = false;

  const sendRuntimeMessage = async (request) => {
    messages.push(request);
    if (runtimeFailure) throw new Error(runtimeFailure);
    switch (request.type) {
      case "selection-resolve":
        if (resolvedSelection) return resolvedSelection;
        if (preferRich) return { ok: true, route: "translation", preferRich, explanationAllowed, depth: "standard",
          intent: { kind: "lexical", sourceLanguage: "en" } };
        if (resolveRoute === "local") return { ok: true, route: "local", explanationAllowed: true, depth: "standard",
          intent: { kind: "lexical", sourceLanguage: "en" }, decision: { topCandidateId: "persistent", candidates: [{
            id: "persistent", kind: "lexical", headword: "persistent", pronunciation: "/pərˈsɪstənt/", partOfSpeech: "adjective",
            translations: ["持久的"], examples: [], provenance: { packId: "core", packVersion: "1",
              sourceRefs: [{ sourceId: "pwn-3.0", recordId: "persistent-entry" }] }
          }] } };
        return { ok: true, route: "translation", intent: { kind: "translation", sourceLanguage: "en" }, explanationAllowed: false };
      case "cache-lookup":
        return { ok: true, hits: [], configSnapshotId: "fixture-config",
          writeTokens: [{ id: "selection", token: { fixture: true } }] };
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
          if (result?.ok && Number(result.stored || 0) > 0) stored = true;
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
    session.disconnectExternally = (message = "") => {
      chrome.runtime.lastError = message ? { message } : undefined;
      onDisconnect?.();
      delete chrome.runtime.lastError;
    };
    assistantPorts.push(session);
    return session.port;
  }

  const app = { modules: {
    runtime: { messages: { background: {
      SELECTION_RESOLVE: "selection-resolve", CACHE_LOOKUP: "cache-lookup", TRANSLATE_BATCH: "translate-batch",
      CACHE_STORE: "cache-store", CANCEL_TRANSLATION: "cancel-translation"
    } }, sendRuntimeMessage, getPageIdentity: (value) => value, showToast() {} },
    contentI18n: createContentI18nStub(),
    selection: { readSelection: () => {
      const range = { startContainer: rangeEndpoint, startOffset: 0, endContainer: rangeEndpoint, endOffset: selectedText.length,
        toString: () => rangeText ?? selectedText };
      return { text: selectedText, pageUrl, sourceRevision: projectionRevision, range,
        rangeIdentity: { startContainer: range.startContainer, startOffset: range.startOffset,
          endContainer: range.endContainer, endOffset: range.endOffset, text: selectedText }, rect: {} };
    }, isExtensionOwnedNode: () => false },
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
      showResult(_snapshot, card, onExplain, onSave, onOpen) {
        results.push(card); resultActions.push({ onExplain, onSave, onOpen });
      },
      showError(_snapshot, message) { errors.push(message); },
      showEmpty(snapshot, options) { emptyViews.push({ snapshot, ...options }); },
      showAiDetailStreaming(answer, onStop) { onAssistantStop = onStop; assistantUpdates.push(answer); },
      showAiDetailStopping() {},
      showAiDetailResult(result, action) { assistantAnswers.push({ result, action }); },
      showAiPersistence(state, action) { aiPersistence.push({ state, action }); },
      showAiDetailInterrupted(_answer, message, retry, action) { assistantInterruptions.push(message); assistantRetries.push({ retry, action }); },
      hide() { hideCount++; }, reposition() { repositionCount++; }, contains: () => false
    },
    selectionClipboard: { writeText: async () => {} },
    selectionMessages: { unresolvedMessage: () => "content.selection.resolveFailed" },
    selectionRichDetails: { load: async (...args) => { richLookups.push(args); if (!deferRich) args.at(-1)?.onSettled?.({ hasHit: true }); }, cancel: async () => {}, bindLifecycle() {} },
    selectionVocabularyBook: { create: () => ({
      add: async (entry, event) => { vocabularyAdds.push({ entry, event }); return { added: true }; },
      addAiNote: async (note, event) => { vocabularyAdds.push({ note, event }); return { added: true }; },
      syncAiNote: async (note) => { vocabularyAdds.push({ note, sync: true }); return { updated: true }; },
      open: async () => ({})
    }) },
    selectionRecordClient: { create: () => readingRecords ? ({
      start({ snapshot, capture }) { return { snapshot, capture, operations: [] }; },
      assistant(context) { const operation = { operationId: `assistant-${context.operations.length + 1}` }; context.operations.push(operation); return operation; },
      accept(_context, artifact, options = {}) {
        accepted.push(artifact);
        options.onStatus?.({ state: "saved", messageKey: "content.reading.saved", retryAvailable: false, openAvailable: true });
        options.onSaved?.({ recordId: "record-1", artifactId: `artifact-${accepted.length}`, revision: accepted.length, duplicate: false });
        return Promise.resolve();
      },
      close: async () => null, discard: async () => {}, invalidateReference() { referenceInvalidations++; }, refresh: async () => {}, render() {},
      save: async () => {}, retry: async () => {}, open: async () => {}, decline() {}
    }) : null },
    selectionRecordStatus: { update() {}, clear() {} },
    selectionSourceSnapshot: {
      createProjectionGuard({ getSnapshot, getCurrentUrl, getPageIdentity, onAccept, onReject }) {
        const freezeQuery = (snapshot) => {
          const frozen = this.capture(snapshot);
          snapshot.sourceCapture = frozen; snapshot.text = frozen.selectedText;
          return frozen;
        };
        const isFrozenCurrent = (snapshot, frozen) => snapshot === getSnapshot() && snapshot.sourceCapture === frozen
          && snapshot.sourceRevision === frozen.sourceRevision && frozen.sourceRevision === projectionRevision;
        const getQuerySource = () => {
          const snapshot = getSnapshot(), frozen = snapshot?.sourceCapture;
          return frozen && isFrozenCurrent(snapshot, frozen) ? frozen : null;
        };
        return { invalidate: (revision = projectionRevision) => {
          const snapshot = getSnapshot(), capture = snapshot?.sourceCapture;
          if (!snapshot) return;
          if (this.matchesCurrentPage(snapshot, capture, getCurrentUrl(), getPageIdentity)) onAccept(snapshot, capture, revision);
          else onReject();
        }, clear() {}, freezeQuery, isFrozenCurrent, getQuerySource };
      },
      matchesCurrentPage(snapshot, frozen, currentUrl, getIdentity) {
        return Boolean(snapshot) && getIdentity(snapshot.pageUrl) === getIdentity(currentUrl)
          && (frozen ? this.matches(snapshot, frozen) : this.rangeMatches(snapshot.range, snapshot.rangeIdentity));
      },
      rangeMatches(range, frozen) { return Boolean(range && frozen && range.startContainer?.isConnected && range.endContainer?.isConnected
        && range.startContainer === frozen.startContainer && range.startOffset === frozen.startOffset
        && range.endContainer === frozen.endContainer && range.endOffset === frozen.endOffset && range.toString() === frozen.text); },
      matches() { return sourceMatches; },
      capture(snapshot) { return { selectedText: snapshot.text, rangeIdentity: snapshot.rangeIdentity, sourceRevision: snapshot.sourceRevision,
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
    messages, chips, results, resultActions, errors, accepted, statuses, appModules: app.modules, assistantPorts, vocabularyAdds, aiPersistence, assistantInterruptions,
    emptyViews, assistantAnswers, assistantUpdates, richLookups, assistantRetries,
    ready: waitForChip(1), storeStarted: storeStarted.promise,
    secondStoreStarted: secondStoreStarted.promise, waitForChip,
    resolveStore: (index = 0, result = { ok: true, stored: 1 }) => storeAcks[index].resolve(result), get stored() { return stored; },
    get cancelButtonDisabled() { return cancelButtonDisabled; },
    get hideCount() { return hideCount; }, get repositionCount() { return repositionCount; },
    get referenceInvalidations() { return referenceInvalidations; },
    stop: () => onCancel?.(), translate: () => onTranslate?.({ isTrusted: true }),
    explain: (index = 0, action = "understand") => resultActions[index]?.onExplain?.({ isTrusted: true }, action),
    save: (index = 0) => resultActions[index]?.onSave?.({ isTrusted: true }),
    stopAssistant: () => onAssistantStop?.(),
    completeAssistant(text = "AI explanation") {
      const session = assistantPorts.at(-1), start = session?.messages.find(message => message.type === "start");
      session?.emit({ protocolVersion: 1, type: "complete", requestId: start?.requestId, text,
        turn: { completionStatus: "completed", assistantAnswer: text, action: start?.action || "understand",
          turnId: start?.turnId || "turn-1", threadId: start?.threadId || "thread-1", parentTurnId: null,
          branchId: start?.branchId || "branch-1", regenerationOf: null },
        readingResult: { targetLanguage: "zh-CN", sourceLanguage: "en", provenance: { provider: "synthetic", model: "mock-model",
          promptVersion: "selection-assistant-v1", providerConfigFingerprint: "opaque" } } });
    },
    stopAt: (index) => cancelHandlers[index]?.(),
    getTask: () => app.modules.tasks.getLatestTask("selection"),
    setSelectedText(value) { selectedText = value; documentListeners.get("mouseup")({ target: {} }); },
    setRangeState({ connected = rangeConnected, text = rangeText } = {}) { rangeConnected = connected; rangeText = text; },
    changeProjection({ notify = false } = {}) { projectionRevision++; if (notify) onProjectionChange?.(); },
    invalidateProjection({ matches = true, revision = projectionRevision + 1 } = {}) {
      sourceMatches = matches; projectionRevision = revision; onProjectionChange?.(revision);
    },
    navigateTo(url, { notify = false } = {}) { location.href = url; if (notify) windowListeners.get("popstate")?.(); },
    close: () => app.modules.selectionPopover.closeHandler?.(),
    escape: () => documentListeners.get("keydown")({ key: "Escape", target: {} }),
    location, windowListeners
  };

  function waitForChip(count) {
    if (chipCount >= count) return Promise.resolve();
    return new Promise(resolve => chipWaiters.push({ count, resolve }));
  }
}

test("an unrelated projection change retains the pending result and refreshes its revision", async () => {
  const h = harness();
  await h.ready;
  const pending = h.translate();
  await h.storeStarted;
  h.invalidateProjection({ matches: true });
  h.resolveStore();
  await pending;

  assert.equal(h.hideCount, 0);
  assert.equal(h.repositionCount, 1);
  assert.equal(h.referenceInvalidations, 0);
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].primaryMeaning, "current selected text translated");
});

test("a projection change dismisses when the frozen selection or local context no longer matches", async () => {
  const h = harness();
  await h.ready;
  const pending = h.translate();
  await h.storeStarted;
  h.invalidateProjection({ matches: false });
  h.resolveStore();
  await pending;

  assert.equal(h.hideCount, 1);
  assert.equal(h.referenceInvalidations, 1);
  assert.deepEqual(h.results, []);
});

test("a pre-query projection change checks the selection-time Range endpoints and raw text", async () => {
  const h = harness();
  await h.ready;
  h.setRangeState({ text: "changed selected text" });
  h.invalidateProjection();

  assert.equal(h.hideCount, 1);
  assert.equal(h.repositionCount, 0);
  assert.equal(h.referenceInvalidations, 1);
});

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

test("a completed AI tab exposes its own Learning Center state and saves one bounded wordbook note", async () => {
  const h = harness({ resolveRoute: "local" });
  await h.ready;
  await h.translate();
  await h.explain(0, "analyze");
  h.completeAssistant("Synthetic analysis");

  const persistence = h.aiPersistence.at(-1);
  assert.equal(persistence.action, "analyze");
  assert.equal(persistence.state.reading.messageKey, "content.reading.savedAiAnswer");
  await persistence.state.onSaveVocabulary({ isTrusted: true });

  assert.equal(h.vocabularyAdds.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.vocabularyAdds[0].note)), {
    headword: "current selected text", sourceLanguage: "en", targetLanguage: "zh-CN", action: "analyze",
    text: "Synthetic analysis", turnId: h.assistantPorts.at(-1).messages[0].turnId,
    provenance: { provider: "synthetic", model: "mock-model", promptVersion: "selection-assistant-v1",
      providerConfigFingerprint: "opaque" },
    readingRef: { recordId: "record-1", artifactId: "artifact-2" }
  });
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

test("an assistant port invalidated by an extension reload tells the user to refresh the page", async () => {
  const h = harness({ resolveRoute: "local" });
  await h.ready;
  await h.translate();
  await h.explain();

  h.assistantPorts.at(-1).disconnectExternally("Extension context invalidated.");

  assert.deepEqual(h.assistantInterruptions, ["content.ai.extensionReloaded"]);
});

test("a Selection request invalidated by an extension reload tells the user to refresh the page", async () => {
  const h = harness({ runtimeFailure: "Extension context invalidated." });
  await h.ready;
  await h.translate();

  assert.deepEqual(h.errors, ["content.ai.extensionReloaded"]);
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
  assert.ok(projection.appModules.selectionController.getQuerySource());
  projection.changeProjection();
  assert.equal(projection.appModules.selectionController.getQuerySource(), null);
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

test("Selection quota warning keeps a confirmed translation visible without a second Provider call", async () => {
  const h = harness();
  await h.ready;
  const pending = h.translate();
  await h.storeStarted;
  h.resolveStore(0, { ok: true, stored: 0, cacheWarning: "CACHE_QUOTA" });
  await pending;

  assert.equal(h.getTask().state, "completed");
  assert.equal(h.stored, false);
  assert.deepEqual(h.errors, []);
  assert.equal(h.results.length, 1);
  assert.equal(h.accepted.length, 1);
  assert.equal(h.messages.filter(message => message.type === "translate-batch").length, 1);
});

test("controller capture Escape closes owned rich layers before dismissing Selection", async () => {
  const h = harness(); await h.ready; const before = h.hideCount; let layers = 2;
  h.appModules.selectionPopover.isEventInsidePanel = () => true;
  h.appModules.selectionPopover.consumeRichEscape = () => layers-- > 0;
  h.escape(); assert.equal(h.hideCount, before); h.escape(); assert.equal(h.hideCount, before);
  h.escape(); assert.equal(h.hideCount, before + 1);
});

for (const explanationAllowed of [true, false]) {
  test(`rich-first hits expose AI actions only when allowed (${explanationAllowed})`, async () => {
    const h = harness({ preferRich: true, explanationAllowed });
    await h.ready;
    await h.translate();
    assert.equal(h.getTask().state, "completed");
    assert.equal(h.emptyViews.length, 1);
    assert.equal(h.results.length, 0, "must retain the rich view instead of recreating it");
    assert.equal(h.messages.filter(value => value.type === "translate-batch").length, 0);
    assert.equal(h.assistantPorts.length, 0);
    const callback = h.emptyViews[0].onExplain;
    if (!explanationAllowed) return assert.equal(callback, null);
    for (const action of ["understand", "analyze", "usage"]) {
      await callback({ isTrusted: true }, action);
      assert.equal(h.assistantPorts.at(-1).messages[0].action, action);
      h.completeAssistant(`answer for ${action}`);
      assert.equal(h.assistantAnswers.at(-1).action, action);
    }
  });
}

for (const change of ["close", "selection"]) {
  test(`rich-first AI ignores late messages after ${change}`, async () => {
    const h = harness({ preferRich: true });
    await h.ready;
    await h.translate();
    const explain = h.emptyViews[0].onExplain;
    await explain({ isTrusted: true }, "understand");
    const old = h.assistantPorts[0], requestId = old.messages[0].requestId;
    const updateCount = h.assistantUpdates.length;
    if (change === "close") h.close();
    else h.setSelectedText("new selected text");
    await h.waitForChip(change === "close" ? 1 : 2);
    assert.equal(old.disconnected, true);
    assert.ok(old.messages.some(message => message.type === "cancel" && message.requestId === requestId));
    h.completeAssistant("stale answer");
    old.emit({ protocolVersion: 1, type: "delta", requestId, sequence: 0, text: "stale delta" });
    await explain({ isTrusted: true }, "usage");
    assert.equal(h.assistantPorts.length, 1, "old callback cannot start another request");
    assert.deepEqual(h.assistantAnswers, []);
    assert.equal(h.assistantUpdates.length, updateCount);
    assert.deepEqual(h.aiPersistence, []);
    assert.deepEqual(h.assistantInterruptions, []);
  });
}

test("same-selection rich lookup and navigation stay current across an AI request", async () => {
  const h = harness({ preferRich: true });
  await h.ready;
  await h.translate();
  const [snapshot, version, page, current] = h.richLookups[0];
  assert.equal(current(version, snapshot, page), true);
  await h.emptyViews[0].onExplain({ isTrusted: true }, "understand");
  assert.equal(current(version, snapshot, page), true);
  h.completeAssistant();
  assert.equal(current(version, snapshot, page), true);
  await h.translate();
  assert.equal(current(version, snapshot, page), false, "a fresh query capture invalidates old dictionary work");
  const next = h.richLookups.at(-1);
  h.setSelectedText("another word"); await h.waitForChip(2);
  assert.equal(next[3](next[1], next[0], next[2]), false);
});

test("starting AI during rich lookup never overwrites the AI view with cancellation", async () => {
  const h = harness({ preferRich: true, deferRich: true });
  await h.ready;
  const pending = h.translate();
  while (!h.emptyViews.length) await new Promise(resolve => setImmediate(resolve));
  await h.emptyViews[0].onExplain({ isTrusted: true }, "understand");
  const [snapshot, version, page, current, , options] = h.richLookups[0];
  assert.equal(current(version, snapshot, page), true);
  options.onSettled({ hasHit: true });
  await pending;
  assert.deepEqual(h.errors, []);
  h.completeAssistant("current answer");
  assert.equal(h.assistantAnswers.at(-1).result.explanation, "current answer");
});

test("unconfigured AI leaves a recoverable tab and can retry after configuration", async () => {
  const h = harness({ preferRich: true });
  await h.ready; await h.translate();
  h.appModules.translationClient = { requireAi: async () => false };
  await h.emptyViews[0].onExplain({ isTrusted: true }, "usage");
  assert.deepEqual(h.assistantInterruptions, ["content.basic.aiRequired"]);
  assert.equal(h.assistantPorts.length, 0);
  assert.equal(h.assistantRetries.at(-1).action, "usage");
  h.appModules.translationClient.requireAi = async () => true;
  await h.assistantRetries.at(-1).retry({ isTrusted: true });
  assert.equal(h.assistantPorts.at(-1).messages[0].action, "usage");
});

test("an AI configuration check returning after close cannot recreate a stale tab", async () => {
  const h = harness({ preferRich: true }), check = deferred();
  await h.ready; await h.translate();
  h.appModules.translationClient = { requireAi: () => check.promise };
  const pending = h.emptyViews[0].onExplain({ isTrusted: true }, "usage");
  h.close(); check.resolve(false); await pending;
  assert.deepEqual(h.assistantInterruptions, []);
  assert.equal(h.assistantPorts.length, 0);
});

for (const tokenCount of [1, 2]) {
  test(`local no-hit button preserves single-word eligibility (${tokenCount} tokens)`, async () => {
    const h = harness({ resolvedSelection: { ok: true, route: "unresolved", routeReason: "no-hit-local",
      intent: { kind: "lexical", tokenCount, sourceLanguage: "en" }, explanationAllowed: false } });
    await h.ready; await h.translate();
    assert.equal(h.emptyViews.length, 1);
    const running = h.emptyViews[0].onTranslate({ isTrusted: true });
    await h.storeStarted;
    const lookup = h.messages.find(item => item.type === "cache-lookup");
    assert.equal(lookup.browserTranslationAllowed, tokenCount === 1);
    h.resolveStore(); await running;
    assert.equal(h.results.length, 1);
  });
}
