import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { createReadingService } from "../src/background/reading-record/service.js";
import { READING_METHOD as M, READING_ERROR as E } from "../src/shared/reading/constants.js";
import { ReadingContractError } from "../src/shared/reading/validation.js";
import { createReadingItemKey, createSourceDigest } from "../src/shared/reading/identity.js";
import { snapshot } from "./fixtures/reading/contract.mjs";
import { nativeBrowser, contentSender, repositoryDouble } from "./fixtures/reading/access.mjs";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const files = ["reading-contract.js", "selection/record-access.js", "selection/record-client.js", "selection/result-model.js"];
const sources = await Promise.all(files.map((file) => readFile(new URL(`../src/content/${file}`, import.meta.url), "utf8")));
const json = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function harness({ enabled = true, summaryOfWrites = false, sourceOverrides = {}, withSubscription = false, responseFilter = (value) => value } = {}) {
  let revision = 1, valid = true, savedRevision = 0, state = { enabled, consentGeneration: 1, capacityReached: false }, excluded = false;
  let siteMarkers = { state: "ready", enabled: false, permissionGranted: true };
  const messages = [], writes = [], views = [];
  const realm = vm.createContext({ crypto: webcrypto, TextEncoder, URL, Date, chrome: { runtime: {} },
    __TRANSLATE_FLOW_CONTENT__: { modules: { contentI18n: createContentI18nStub(), textProjection: { revision: () => revision },
      selectionSourceSnapshot: { documentGeneration: "doc-test" }, uiHost: { ownsNode: (node) => node === "owned-ui" } } } });
  const parse = vm.runInContext("JSON.parse", realm);
  const clone = (value) => parse(JSON.stringify(value));
  let notify = null, disconnected = null, connections = 0;
  if (withSubscription) realm.chrome.runtime.connect = () => (connections++, {
    onMessage: { addListener(listener) { notify = listener; } },
    onDisconnect: { addListener(listener) { disconnected = listener; } }, disconnect() { disconnected?.(); }
  });
  const repo = repositoryDouble({
    async read({ request, assertCurrent }) { assertCurrent();
      if (request.method === M.GET_RECORDING_STATE) return state;
      if (request.method === M.GET_SITE_RECORDING) return { excluded, sitePolicyRevision: 1 };
      if (request.method === M.GET_PAGE_SUMMARY) {
        const ids = summaryOfWrites ? [...new Set(writes.map((item) => item.recordId))] : [];
        return { items: ids.map((recordId) => ({ recordId, revision: savedRevision, itemKey: createReadingItemKey(source.selectedText, "en"),
          anchor: json(source.anchor), hasCompletedAssistant: false })),
          nextCursor: null, pageRevision: 1, pageRecordCount: ids.length };
      }
    },
    async prepareOperation(context) { if (!state.enabled) return { state: "disabled" }; return repositoryDouble().prepareOperation(context); },
    async mutate({ request, assertCurrent }) { assertCurrent();
      if (!state.enabled || excluded) throw new ReadingContractError(E.DISABLED, "test.policy");
      writes.push(request.artifact);
      return { state: "saved", recordId: request.token.recordId, revision: ++savedRevision, artifactId: request.artifact.artifactId, duplicate: writes.filter((a) => a.artifactId === request.artifact.artifactId).length > 1 }; },
    async cancelOperation({ request, registeredOperation, assertCurrent }) { assertCurrent();
      return { operationId: request.operationId, state: writes.length ? "committed" : "cancelled", recordId: writes.length ? registeredOperation.token.recordId : null, revision: writes.length ? savedRevision : null }; }
  });
  const modules = realm.__TRANSLATE_FLOW_CONTENT__.modules;
  const service = createReadingService({ browser: nativeBrowser(), repository: repo,
    collector: async (_browser, _sender, challenge) => json(await modules.readingAccessCollector.read(clone(challenge))),
    siteMarkers: { async get() { return { ...siteMarkers }; }, async set(_siteKey, enabled) {
      siteMarkers = { state: "ready", enabled, permissionGranted: true }; return { ...siteMarkers };
    } } });
  modules.runtime = { async sendRuntimeMessage(request) {
    messages.push(json(request));
    const reply = await service.handle(json(request), contentSender());
    return clone(await responseFilter(reply, request));
  } };
  for (const source of sources) vm.runInContext(source, realm);
  const client = modules.selectionRecordClient.create({ onStatus: (view) => views.push(json(view)) });
  const source = snapshot({ capturedAt: Date.now(), documentGeneration: "doc-test", ...sourceOverrides }); source.sourceDigest = await createSourceDigest(source);
  const capture = { ready: Promise.resolve(clone(source)), sourceRevision: 1, root: "document", context: { sensitive: false }, selectedText: source.selectedText };
  const selected = { text: source.selectedText, pageUrl: contentSender().url, range: { startContainer: { isConnected: true }, endContainer: { isConnected: true } } };
  const event = { isTrusted: true, target: "owned-ui" };
  const start = (extra = {}) => client.start({ snapshot: selected, capture, event, isCurrent: () => valid, ...extra });
  const draft = clone({ kind: "dictionary", targetLanguage: "zh-CN", payload: { outcome: "no-hit", headword: source.selectedText,
    phonetic: "", partOfSpeech: "", definitions: [] }, provenance: [] });
  return { modules, client, start, draft, event, capture, source, messages, writes, views,
    enable() { state = { ...state, enabled: true, consentGeneration: state.consentGeneration + 1 }; },
    pause() { state = { ...state, enabled: false, consentGeneration: state.consentGeneration + 1 }; },
    connections: () => connections,
    disconnect() { disconnected?.(); },
    notify(overrides = {}) { notify?.(clone({ protocolVersion: 2, type: "reading.invalidate", pageRevision: 1,
      dataGeneration: 1, consentGeneration: state.consentGeneration, ...overrides })); },
    notifySiteMarkers() { notify?.(clone({ protocolVersion: 2, type: "reading.site-markers.invalidate" })); },
    setSiteMarkers(value) { siteMarkers = { ...value }; },
    invalidate() { valid = false; revision++; }, exclude() { excluded = true; }, clone };
}
function assistantDraft(h, overrides = {}) {
  return h.clone({ kind: "assistant", targetLanguage: "zh-CN",
    provenance: { provider: "mock", model: "mock", promptVersion: "selection-assistant-v1", providerConfigFingerprint: "opaque" },
    payload: { userQuestion: "How is this used?", assistantAnswer: "Saved answer.", action: "usage", threadId: "thread-accepted",
      turnId: "turn-accepted", parentTurnId: null, branchId: "branch-accepted", regenerationOf: null,
      completionStatus: "completed", ...overrides } });
}

test("Reading collector rejects untrusted/page actions and forged operation intents", async () => {
  const h = await harness();
  assert.equal(h.start({ event: { isTrusted: false, target: "owned-ui" } }), null);
  assert.equal(h.start({ event: { isTrusted: true, target: "page" } }), null);
  assert.equal(h.messages.length, 0);
  const ctx = h.start(); await ctx.policyPromise;
  const op = ctx.operations[0];
  const read = (body) => h.modules.readingAccessCollector.read({ nonce: "nonce", action: "begin", recordId: null, operationId: op.operationId, ...body });
  assert.equal((await read({})).sourceSnapshot.sourceSnapshotId, h.source.sourceSnapshotId);
  assert.equal(await read({ operationId: "forged" }), null);
  assert.equal(await read({ recordId: "arbitrary" }), null);
  h.invalidate(); assert.equal(await read({}), null);
  const recordId = "11111111-1111-4111-8111-111111111111";
  assert.equal(h.modules.selectionRecordAccess.authorizePageAction({ event: { isTrusted: true, target: "page" }, action: "delete", recordId }), false);
  assert.equal(h.modules.selectionRecordAccess.authorizePageAction({ event: h.event, action: "delete", recordId }), true);
  const deleteProof = await h.modules.readingAccessCollector.read({ nonce: "delete-nonce", action: "delete", recordId, operationId: null });
  assert.deepEqual(json(deleteProof.intent), { action: "delete", recordId, operationId: null });
  assert.equal(await h.modules.readingAccessCollector.read({ nonce: "again", action: "delete", recordId, operationId: null }), null);
});

test("First consent retains one frozen card, has no BEGIN/history and uses explicit fresh token without Provider", async () => {
  const h = await harness({ enabled: false }), ctx = h.start();
  h.client.accept(ctx, h.draft); await ctx.queue;
  assert.equal(h.views.at(-1).state, "invite");
  assert.equal(h.messages.some((r) => r.method === M.BEGIN_QUERY), false); assert.equal(h.writes.length, 0);
  h.enable(); await h.client.refresh(); assert.equal(h.views.at(-1).state, "manual"); assert.equal(h.writes.length, 0);
  await h.client.save(h.event);
  assert.equal(h.views.at(-1).state, "saved"); assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].sourceSnapshotId, h.source.sourceSnapshotId);
  assert.equal(h.messages.filter((r) => r.method === M.BEGIN_QUERY).length, 1);
  assert.equal(h.messages.some((r) => r.method === M.SET_RECORDING || r.type), false);
});

test("A completed AI answer explains why it is unsaved and can be explicitly saved after enabling records", async () => {
  const h = await harness({ enabled: false }), ctx = h.start();
  h.client.accept(ctx, h.draft); await ctx.queue;
  const operation = h.client.assistant(ctx, h.event);
  h.client.accept(ctx, h.clone({ kind: "assistant", targetLanguage: "zh-CN",
    provenance: { provider: "mock", model: "mock", promptVersion: "selection-assistant-v1", providerConfigFingerprint: "opaque" },
    payload: { userQuestion: "How is this used?", assistantAnswer: "Saved answer.", action: "usage", threadId: "thread-1",
      turnId: "turn-1", parentTurnId: null, branchId: "branch-1", regenerationOf: null, completionStatus: "completed" } }),
  { key: operation.operationId, operation });
  await ctx.queue;
  assert.deepEqual(h.views.at(-1), { state: "invite", messageKey: "content.reading.aiPaused", messageArgs: {}, retryAvailable: false });
  assert.equal(h.writes.length, 0); assert.equal(h.messages.some((request) => request.method === M.BEGIN_QUERY), false);

  h.enable(); await h.client.refresh();
  assert.equal(h.views.at(-1).state, "manual");
  await h.client.save(h.event);
  assert.deepEqual(h.writes.map((artifact) => artifact.kind), ["dictionary", "assistant"]);
  assert.equal(h.messages.filter((request) => request.method === M.APPEND_ASSISTANT).length, 1);
});

test("Storage/lost-ACK retry keeps the exact operation/artifact and performs no second result request", async () => {
  const h = await harness({ responseFilter(value, request) {
    if (request.method === M.SAVE_QUERY_RESULT && !h.lost) { h.lost = true; throw new Error("synthetic lost ack"); }
    return value;
  } }), ctx = h.start();
  h.client.accept(ctx, h.draft); await ctx.queue;
  assert.deepEqual(h.views.at(-1), { state: "not-saved", messageKey: "content.reading.interrupted", messageArgs: {}, retryAvailable: true });
  await h.client.retry(h.event);
  assert.equal(h.views.at(-1).state, "saved"); assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[0], h.writes[1]); assert.equal(h.messages.filter((r) => r.method === M.BEGIN_QUERY).length, 1);
});

test("Basic, late Rich and duplicate callbacks use one lookup token and immutable distinct artifacts", async () => {
  const h = await harness(), ctx = h.start();
  h.client.accept(ctx, h.draft); await ctx.queue;
  h.client.accept(ctx, h.draft, { key: "rich:synthetic" }); await ctx.queue;
  h.client.accept(ctx, h.draft, { key: "rich:synthetic" }); await ctx.queue;
  assert.equal(h.writes.length, 2); assert.notEqual(h.writes[0].artifactId, h.writes[1].artifactId);
  assert.equal(h.writes[0].operationId, h.writes[1].operationId);
  assert.equal(h.messages.filter((r) => r.method === M.BEGIN_QUERY).length, 1);
});

test("A completed assistant accept survives immediate close and duplicate accept reuses its exact acknowledged artifact", async () => {
  const h = await harness(), ctx = h.start(), operation = h.client.assistant(ctx, h.event), draft = assistantDraft(h);
  const accepted = h.client.accept(ctx, draft, { key: operation.operationId, operation });
  assert.equal(h.client.accept(ctx, draft, { key: operation.operationId, operation }), accepted);
  const closed = h.client.close(ctx), receipt = await accepted;
  assert.equal((await closed).recordId, receipt.recordId);
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].artifactId, receipt.artifactId);
  assert.equal(h.messages.filter(request => request.method === M.APPEND_ASSISTANT).length, 1);
  assert.equal(h.messages.filter(request => request.method === M.CANCEL_OPERATION).length, 0);
  assert.equal(h.views.some(view => view.state === "saved"), false, "a closed card cannot receive the old ACK");
});

test("A completed assistant keeps its frozen identity across a new selection and the old ACK cannot overwrite the new card", async () => {
  const entered = deferred(), release = deferred(); let delayed = true;
  const h = await harness({ summaryOfWrites: true, async responseFilter(value, request) {
    if (request.method === M.APPEND_ASSISTANT && delayed) { delayed = false; entered.resolve(); await release.promise; }
    return value;
  } });
  let oldCurrent = true;
  const first = h.start({ isCurrent: () => oldCurrent }), operation = h.client.assistant(first, h.event);
  const accepted = h.client.accept(first, assistantDraft(h), { key: operation.operationId, operation });
  await entered.promise; oldCurrent = false;
  const second = h.start({ isCurrent: () => true });
  h.client.accept(second, h.draft); release.resolve();
  const receipt = await accepted; await second.queue;
  assert.equal(h.writes.filter(item => item.kind === "assistant").length, 1);
  assert.equal(h.writes.find(item => item.kind === "assistant").artifactId, receipt.artifactId);
  assert.equal(h.messages.filter(request => request.method === M.APPEND_ASSISTANT).length, 1);
  assert.equal(h.client.getCurrent(), second); assert.equal(h.views.at(-1).state, "saved");
  const begins = h.messages.filter(request => request.method === M.BEGIN_QUERY);
  assert.equal(begins.at(-1).recordId, receipt.recordId); assert.equal(begins.at(-1).recordRevision, receipt.revision);
});

test("An accepted assistant waits for pending policy after close, while an unauthorized close never begins or writes", async () => {
  for (const enabled of [true, false]) {
    const entered = deferred(), release = deferred(); let delayed = true;
    const h = await harness({ enabled, async responseFilter(value, request) {
      if (request.method === M.GET_RECORDING_STATE && delayed) { delayed = false; entered.resolve(); await release.promise; }
      return value;
    } });
    const ctx = h.start(), operation = h.client.assistant(ctx, h.event);
    const accepted = h.client.accept(ctx, assistantDraft(h), { key: operation.operationId, operation });
    await entered.promise; const closed = h.client.close(ctx); release.resolve();
    if (enabled) {
      const receipt = await accepted; assert.equal(receipt.artifactId, h.writes[0].artifactId);
    } else {
      await assert.rejects(accepted, value => value?.code === E.DISABLED);
    }
    await closed;
    assert.equal(h.writes.length, enabled ? 1 : 0);
    assert.equal(h.messages.filter(request => request.method === M.BEGIN_QUERY).length, enabled ? 1 : 0);
  }
});

test("A persisted assistant with a delayed or lost ACK stays committed after close and retries only the same artifact", async () => {
  for (const mode of ["delayed", "lost"]) {
    const entered = deferred(), release = deferred(); let first = true;
    const h = await harness({ async responseFilter(value, request) {
      if (request.method !== M.APPEND_ASSISTANT || !first) return value;
      first = false; entered.resolve();
      if (mode === "delayed") { await release.promise; return value; }
      throw new Error("synthetic lost assistant ack");
    } });
    const ctx = h.start(), operation = h.client.assistant(ctx, h.event);
    const accepted = h.client.accept(ctx, assistantDraft(h), { key: operation.operationId, operation });
    await entered.promise; const closed = h.client.close(ctx); release.resolve();
    const receipt = await accepted; await closed;
    assert.equal(receipt.artifactId, h.writes[0].artifactId);
    assert.equal(h.writes.length, mode === "lost" ? 2 : 1);
    assert.ok(h.writes.every(item => item.artifactId === receipt.artifactId && item.operationId === operation.operationId));
  }
});

test("Navigation, pause and exclusion before an accepted assistant append still fail closed", async () => {
  for (const change of ["navigation", "pause", "exclude"]) {
    const entered = deferred(), release = deferred(); let delayed = true;
    const h = await harness({ async responseFilter(value, request) {
      if (request.method === M.BEGIN_QUERY && delayed) { delayed = false; entered.resolve(); await release.promise; }
      return value;
    } });
    const ctx = h.start(), operation = h.client.assistant(ctx, h.event);
    const accepted = h.client.accept(ctx, assistantDraft(h), { key: operation.operationId, operation });
    await entered.promise;
    if (change === "navigation") { h.client.invalidateReference(); h.invalidate(); }
    if (change === "pause") h.pause();
    if (change === "exclude") h.exclude();
    const closed = h.client.close(ctx); release.resolve();
    await assert.rejects(accepted, undefined, change); await closed;
    assert.equal(h.writes.length, 0, change);
  }
});

test("Closing during BEGIN cancels its arrived token; late ACK cannot replace the next card", async () => {
  const entered = deferred(), release = deferred();
  const h = await harness({ async responseFilter(value, request) {
    if (request.method === M.BEGIN_QUERY) { entered.resolve(); await release.promise; }
    return value;
  } }), ctx = h.start(); h.client.accept(ctx, h.draft);
  await entered.promise;
  const closed = h.client.close(); h.invalidate(); release.resolve(); await closed; await ctx.queue;
  assert.equal(h.writes.length, 0); assert.equal(h.messages.filter((r) => r.method === M.CANCEL_OPERATION).length, 1);
  assert.equal(h.views.some((v) => v.state === "saved"), false);
});

test("Close before consent, exclusion and unknown transport versions do not create records", async () => {
  const h = await harness({ enabled: false }), ctx = h.start(); h.client.accept(ctx, h.draft); await ctx.queue;
  await h.client.close(); h.enable(); await h.client.refresh(); await h.client.save(h.event); assert.equal(h.writes.length, 0);
  const excluded = await harness(); excluded.exclude(); const other = excluded.start(); excluded.client.accept(other, excluded.draft); await other.queue;
  assert.equal(excluded.writes.length, 0); assert.equal(excluded.views.at(-1).state, "disabled");
  const old = await harness({ responseFilter(value) { return { ...value, protocolVersion: 1 }; } });
  const obsolete = old.start(); old.client.accept(obsolete, old.draft); await obsolete.queue;
  assert.equal(old.writes.length, 0); assert.equal(old.views.at(-1).messageKey, "content.reading.unsupportedVersion");
});

test("An invalidated saved reference and late page-summary reply cannot attach to the new card", async () => {
  const entered = deferred(), release = deferred(); let waiting = true;
  const h = await harness({ summaryOfWrites: true, async responseFilter(value, request) {
    if (request.method === M.GET_PAGE_SUMMARY && waiting) { waiting = false; entered.resolve(); await release.promise; }
    return value;
  } });
  const first = h.start(); h.client.accept(first, h.draft); await first.queue; await h.client.close(first);
  const stale = h.start(); h.client.accept(stale, h.draft); await entered.promise;
  h.client.invalidateReference(); const closed = h.client.close(stale);
  const current = h.start(); h.client.accept(current, h.draft); await current.queue;
  release.resolve(); await closed; await stale.queue;
  assert.equal(stale.ref, null); assert.equal(h.writes.length, 2);
  assert.equal(h.messages.filter((value) => value.method === M.BEGIN_QUERY).at(-1).recordId, null);
  assert.equal(h.client.getCurrent(), current); assert.equal(h.views.at(-1).state, "saved");
  assert.equal(h.messages.filter((value) => value.method === M.BEGIN_QUERY).length, 2);
});

test("Committed snapshot remains saved across viewed metadata revisions without changing its operation token", async () => {
  let revision = 2;
  const h = await harness({ summaryOfWrites: true, responseFilter(value, request) {
    if (request.method === M.GET_PAGE_SUMMARY) value.data.items[0].revision = revision;
    return value;
  } }), ctx = h.start(); h.client.accept(ctx, h.draft); await ctx.queue;
  const originalToken = json(ctx.operations[0].token);
  await h.client.refresh(true);
  assert.equal(h.views.at(-1).state, "saved"); assert.equal(ctx.ref.revision, 2);
  assert.deepEqual(json(ctx.operations[0].token), originalToken); assert.equal(h.writes.length, 1);
  revision = 1; await h.client.refresh(true);
  assert.equal(ctx.ref.revision, 2); assert.equal(h.views.at(-1).state, "saved");
  const closed = await h.client.close(ctx);
  assert.equal(closed.revision, 2, "a late committed cancellation ACK cannot reduce the known record revision");
});

test("A delayed first-enable notification agrees with the accepted policy; later pause still revokes", async () => {
  const h = await harness({ enabled: false, summaryOfWrites: true, withSubscription: true }), ctx = h.start();
  h.client.accept(ctx, h.draft); await ctx.queue; h.notify(); await h.client.refresh();
  h.enable(); await h.client.refresh(); assert.equal(h.views.at(-1).state, "manual");
  h.notify(); assert.equal(ctx.blocked, false, "the already accepted first consent is not a revocation");
  await h.client.save(h.event); h.notify({ pageRevision: 2 }); await h.client.refresh(true);
  assert.equal(h.views.at(-1).state, "saved"); assert.equal(h.writes.length, 1);
  h.pause(); h.notify({ pageRevision: 3 }); await h.client.refresh(true);
  assert.equal(ctx.blocked, true); assert.equal(ctx.ref, null); assert.equal(h.views.at(-1).state, "not-saved");
});

test("Site-marker invalidation leaves the saved card unchanged and does not block a follow-up append", async () => {
  const h = await harness({ summaryOfWrites: true, withSubscription: true }), ctx = h.start();
  h.client.accept(ctx, h.draft); await ctx.queue;
  const before = json(h.views.at(-1));
  assert.equal(before.state, "saved"); assert.equal("siteMarkerStatus" in before, false);

  h.setSiteMarkers({ state: "ready", enabled: true, permissionGranted: true });
  h.notifySiteMarkers();
  assert.equal(ctx.blocked, false); assert.ok(ctx.ref);
  assert.deepEqual(h.views.at(-1), before);
  assert.equal(h.messages.filter((request) => request.method === M.GET_SITE_MARKERS).length, 0);

  const operation = h.client.assistant(ctx, h.event);
  assert.ok(operation);
  h.client.accept(ctx, h.clone({ kind: "assistant", targetLanguage: "zh-CN", provenance: { provider: "mock", model: "mock",
    promptVersion: "selection-assistant-v1", providerConfigFingerprint: "opaque" }, payload: { userQuestion: "Why?", assistantAnswer: "Because.",
    action: "follow-up", threadId: "thread-1", turnId: "turn-2", parentTurnId: "turn-1", branchId: "branch-1",
    regenerationOf: null, completionStatus: "completed" } }), { key: "follow-up", operation });
  await ctx.queue;
  assert.equal(ctx.blocked, false); assert.equal(h.views.at(-1).state, "saved");
  assert.equal(h.writes.length, 2); assert.equal(h.writes.at(-1).kind, "assistant");
  assert.equal(h.messages.filter((request) => request.method === M.APPEND_ASSISTANT).length, 1);
});

test("Invalidation disconnect with a saved ref reconnects and refreshes through the current local summary path", async () => {
  const refreshed = deferred();
  const h = await harness({ summaryOfWrites: true, withSubscription: true, responseFilter(value, request) {
    if (request.method === M.GET_PAGE_SUMMARY) refreshed.resolve();
    return value;
  } }), ctx = h.start();
  h.client.accept(ctx, h.draft); await ctx.queue;
  assert.equal(h.connections(), 1); assert.ok(ctx.ref);

  assert.doesNotThrow(() => h.disconnect());
  await refreshed.promise;
  assert.equal(h.connections(), 2); assert.equal(ctx.blocked, false); assert.ok(ctx.ref);
  assert.equal(h.messages.filter((request) => request.method === M.GET_PAGE_SUMMARY).length, 1);
});

test("An unchanged unsupported anchor preserves its committed snapshot without becoming resolved", async () => {
  const anchor = { ...snapshot().anchor, status: "unsupported", position: null, blockDigest: null };
  const h = await harness({ summaryOfWrites: true, sourceOverrides: { anchor }, responseFilter(value, request) {
    if (request.method === M.GET_PAGE_SUMMARY) value.data.items[0].revision = 2;
    return value;
  } }), ctx = h.start(); h.client.accept(ctx, h.draft); await ctx.queue;
  const originalToken = json(ctx.operations[0].token);
  await h.client.refresh(true);
  assert.equal(h.views.at(-1).state, "saved"); assert.equal(ctx.ref.revision, 2);
  assert.deepEqual(json(ctx.ref.source.anchor), anchor);
  assert.equal(h.modules.readingContract.sameProvenLocation(
    { pageKey: ctx.ref.pageKey, documentGeneration: h.source.documentGeneration, anchor },
    { pageKey: ctx.ref.pageKey, documentGeneration: h.source.documentGeneration, anchor }), false);
  assert.deepEqual(json(ctx.operations[0].token), originalToken); assert.equal(h.writes.length, 1);
});

test("Missing records and changed anchors still revoke the saved reference", async () => {
  for (const deleted of [true, false]) {
    const h = await harness({ summaryOfWrites: true, responseFilter(value, request) {
      if (request.method === M.GET_PAGE_SUMMARY) {
        if (deleted) { value.data.items = []; value.data.pageRecordCount = 0; }
        else { value.data.items[0].revision = 2; value.data.items[0].anchor.blockDigest = "d".repeat(64); }
      }
      return value;
    } }), ctx = h.start(); h.client.accept(ctx, h.draft); await ctx.queue;
    await h.client.refresh(true);
    assert.equal(ctx.ref, null); assert.equal(ctx.blocked, true);
    assert.equal(h.views.at(-1).state, "not-saved"); assert.equal(h.writes.length, 1);
  }
});

test("Result adapters preserve actual types and bounded provenance while dropping raw/private dictionary data", async () => {
  const h = await harness(), model = h.modules.selectionResultModel;
  const record = { id: "synthetic", packVersion: "v1", headword: "React", text: "synthetic reliable summary", richRecord: { rawRecord: "PRIVATE_RAW", styleSheetRules: [] }, privatePath: "/home/private/dictionary.mdx" };
  const rich = model.readingRich(record, { id: "synthetic", packVersion: "v1", fileName: "/home/private" });
  assert.equal(rich.kind, "dictionary"); assert.equal(JSON.stringify(rich).includes("PRIVATE_RAW"), false);
  assert.equal(JSON.stringify(rich).includes("/home"), false);
  const richVocabulary = model.vocabularyDraftFromRich({ ...record, text: "React\n持久的用户界面库" },
    { id: "synthetic", packVersion: "v1", fileName: "/home/private" }, "en");
  assert.deepEqual(json(richVocabulary.definitions), ["持久的用户界面库"]);
  assert.deepEqual(json(richVocabulary.sources), [{ sourceId: "local-rich-mdict", packId: "synthetic",
    packVersion: "v1", sourceEntryId: "React" }]);
  const cleanedRich = model.readingRich({ ...record, text: ["React", "BrE /riˈækt/ 播放英音", "图片 · Ox5000 key_L",
    "牛津5000词汇表", "用于构建用户界面的 JavaScript 库"].join("\n") }, { id: "synthetic", packVersion: "v1" });
  assert.deepEqual(json(cleanedRich.payload.definitions), ["用于构建用户界面的 JavaScript 库"]);
  const englishDefinitions = model.readingRich({ ...record, text: ["React", "image of a person", "surname and given name"].join("\n") },
    { id: "synthetic", packVersion: "v1" });
  assert.deepEqual(json(englishDefinitions.payload.definitions), ["image of a person", "surname and given name"]);
  assert.deepEqual(json(model.vocabularyDraftFromRich({ ...record, text: ["React", "image of a person", "surname and given name"].join("\n") },
    { id: "synthetic", packVersion: "v1" }, "en").definitions), ["image of a person", "surname and given name"]);
  const shortDefinitions = model.readingRich({ ...record, headword: "photo", text: ["photo", "图片", "image"].join("\n") },
    { id: "synthetic", packVersion: "v1" });
  assert.deepEqual(json(shortDefinitions.payload.definitions), ["图片", "image"]);
  assert.deepEqual(json(model.vocabularyDraftFromRich({ ...record, headword: "photo", text: ["photo", "图片", "image"].join("\n") },
    { id: "synthetic", packVersion: "v1" }, "en").definitions), ["图片", "image"]);
  assert.equal(JSON.stringify(richVocabulary).includes("PRIVATE_RAW"), false);
  assert.equal(model.readingRich({ ...record, text: "sound://private.mp3" }, { id: "synthetic", packVersion: "v1" }), null);
  assert.equal(model.readingRich({ ...record, text: "" }, { id: "synthetic", packVersion: "v1" }), null);
  assert.equal(model.readingDictionary({ routeReason: "no-hit-local" }, "missing").payload.outcome, "no-hit");
  assert.equal(model.readingTranslation("actual translation", { targetLanguage: "zh-CN", provenance: {} }).kind, "translation");
  const assistant = model.readingAssistant({ generatedMeaning: "displayed meaning", explanation: "displayed answer" },
    { userQuestion: "这里是什么意思？", action: "understand", targetLanguage: "zh-CN", provenance: {} });
  assert.equal(assistant.kind, "assistant"); assert.equal(assistant.payload.assistantAnswer, "displayed meaning\ndisplayed answer");
});

test("Excluded sites keep the disabled card without opening a denied invalidation subscription", async () => {
  const h = await harness({ withSubscription: true }); h.exclude();
  const ctx = h.start(); h.client.accept(ctx, h.draft); await ctx.queue;
  assert.equal(h.connections(), 0);
  assert.equal(h.views.at(-1).state, "disabled");
  assert.equal(h.writes.length, 0);
  assert.equal(h.messages.some(message => message.method === M.BEGIN_QUERY), false);
});

test("A completed AI answer on an excluded site reports the exact policy and offers the management route", async () => {
  const h = await harness({ withSubscription: true }); h.exclude();
  const ctx = h.start(); h.client.accept(ctx, h.draft); await ctx.queue;
  const operation = h.client.assistant(ctx, h.event);
  h.client.accept(ctx, h.clone({ kind: "assistant", targetLanguage: "zh-CN",
    provenance: { provider: "mock", model: "mock", promptVersion: "selection-assistant-v1", providerConfigFingerprint: "opaque" },
    payload: { userQuestion: "Why?", assistantAnswer: "Because.", action: "analyze", threadId: "thread-2", turnId: "turn-2",
      parentTurnId: null, branchId: "branch-2", regenerationOf: null, completionStatus: "completed" } }),
  { key: operation.operationId, operation });
  await ctx.queue;
  assert.deepEqual(h.views.at(-1), { state: "disabled", messageKey: "content.reading.aiSiteExcluded", messageArgs: {},
    retryAvailable: false, openAvailable: true });
  assert.equal(h.connections(), 0); assert.equal(h.writes.length, 0);
  assert.equal(h.messages.some(message => message.method === M.BEGIN_QUERY), false);
});
