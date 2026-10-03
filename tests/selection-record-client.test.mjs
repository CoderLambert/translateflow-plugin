import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { createReadingService } from "../src/background/reading-record/service.js";
import { READING_METHOD as M, READING_ERROR as E } from "../src/shared/reading/constants.js";
import { createSourceDigest } from "../src/shared/reading/identity.js";
import { snapshot } from "./fixtures/reading/contract.mjs";
import { nativeBrowser, contentSender, repositoryDouble } from "./fixtures/reading/access.mjs";

const files = ["reading-contract.js", "selection/record-access.js", "selection/record-client.js", "selection/result-model.js"];
const sources = await Promise.all(files.map((file) => readFile(new URL(`../src/content/${file}`, import.meta.url), "utf8")));
const json = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function harness({ enabled = true, summaryOfWrites = false, sourceOverrides = {}, withSubscription = false, responseFilter = (value) => value } = {}) {
  let revision = 1, valid = true, savedRevision = 0, state = { enabled, consentGeneration: 1, capacityReached: false }, excluded = false;
  const messages = [], writes = [], views = [];
  const realm = vm.createContext({ crypto: webcrypto, TextEncoder, URL, Date, chrome: { runtime: {} },
    __TRANSLATE_FLOW_CONTENT__: { modules: { textProjection: { revision: () => revision }, uiHost: { ownsNode: (node) => node === "owned-ui" } } } });
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
        return { items: ids.map((recordId) => ({ recordId, revision: savedRevision, anchor: json(source.anchor), hasCompletedAssistant: false })),
          nextCursor: null, pageRevision: 1, pageRecordCount: ids.length };
      }
    },
    async prepareOperation(context) { if (!state.enabled) return { state: "disabled" }; return repositoryDouble().prepareOperation(context); },
    async mutate({ request, assertCurrent }) { assertCurrent(); writes.push(request.artifact);
      return { state: "saved", recordId: request.token.recordId, revision: ++savedRevision, artifactId: request.artifact.artifactId, duplicate: writes.filter((a) => a.artifactId === request.artifact.artifactId).length > 1 }; },
    async cancelOperation({ request, registeredOperation, assertCurrent }) { assertCurrent();
      return { operationId: request.operationId, state: writes.length ? "committed" : "cancelled", recordId: writes.length ? registeredOperation.token.recordId : null, revision: writes.length ? savedRevision : null }; }
  });
  const modules = realm.__TRANSLATE_FLOW_CONTENT__.modules;
  const service = createReadingService({ browser: nativeBrowser(), repository: repo,
    collector: async (_browser, _sender, challenge) => json(await modules.readingAccessCollector.read(clone(challenge))) });
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
    notify(overrides = {}) { notify?.(clone({ protocolVersion: 2, type: "reading.invalidate", pageRevision: 1,
      dataGeneration: 1, consentGeneration: state.consentGeneration, ...overrides })); },
    invalidate() { valid = false; revision++; }, exclude() { excluded = true; }, clone };
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

test("Storage/lost-ACK retry keeps the exact operation/artifact and performs no second result request", async () => {
  const h = await harness({ responseFilter(value, request) {
    if (request.method === M.SAVE_QUERY_RESULT && !h.lost) { h.lost = true; throw new Error("synthetic lost ack"); }
    return value;
  } }), ctx = h.start();
  h.client.accept(ctx, h.draft); await ctx.queue;
  assert.deepEqual(h.views.at(-1), { state: "not-saved", message: "保存确认中断，当前结果仍可复制；可重试确认保存。", retryAvailable: true });
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
  assert.equal(old.writes.length, 0); assert.match(old.views.at(-1).message, /刷新网页/);
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
