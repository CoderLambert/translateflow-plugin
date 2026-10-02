import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E, READING_INVALIDATION_PORT, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { configureReadingRuntime, handleReadingPort, onReadingTabUpdated, onReadingTabRemoved } from "../src/background/reading-record/runtime.js";
import { createReadingService } from "../src/background/reading-record/service.js";
import { createExportRegistry } from "../src/background/reading-record/exports.js";
import { createReadingAccess } from "../src/background/reading-record/access.js";
import { createReadingSubscriptions } from "../src/background/reading-record/subscriptions.js";
import { fail } from "../src/shared/reading/validation.js";
import { request, artifact } from "./fixtures/reading/contract.mjs";
import { collector, contentSender, extensionSender, nativeBrowser, repositoryDouble } from "./fixtures/reading/access.mjs";
import { derivePageIdentity } from "../src/background/reading-record/policy.js";

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function port(sender) {
  const disconnect = [], message = [], first = deferred();
  return { name: READING_INVALIDATION_PORT, sender, messages: [], disconnected: false, first: first.promise,
    onDisconnect: { addListener: (fn) => disconnect.push(fn) }, onMessage: { addListener: (fn) => message.push(fn) },
    postMessage(value) { this.messages.push(value); first.resolve(value); },
    disconnect() { this.disconnected = true; first.resolve(null); for (const fn of disconnect) fn(); } };
}
const invalidation = () => ({ protocolVersion: 2, type: "reading.invalidate", catalogRevision: 1, dataGeneration: 1, consentGeneration: 1 });
function browserWithTwoTabs() {
  const browser = nativeBrowser();
  const contexts = [{ contextId: "33333333-3333-4333-8333-333333333333", documentId: extensionSender().documentId,
    documentUrl: extensionSender().url, contextType: "TAB", incognito: false, tabId: 9 },
  { contextId: "44444444-4444-4444-8444-444444444444", documentId: "55555555-5555-4555-8555-555555555555",
    documentUrl: extensionSender().url, contextType: "TAB", incognito: false, tabId: 10 }];
  browser.runtime.getContexts = async ({ documentIds }) => contexts.filter((value) => documentIds.includes(value.documentId));
  return { browser, contexts };
}

test("Production runtime closes tab subscriptions immediately on same-document URL/loading/removal, preserves unrelated tabs and recovers all 128 slots", async () => {
  const original = globalThis.chrome, { browser, contexts } = browserWithTwoTabs(); globalThis.chrome = browser;
  try {
    configureReadingRuntime({ repository: { async readInvalidationState({ assertCurrent }) { assertCurrent(); return invalidation(); } } });
    const other = port(extensionSender({ documentId: contexts[1].documentId })); handleReadingPort(other); await other.first;
    for (const change of [() => onReadingTabUpdated(9, { url: "same-document-url" }), () => onReadingTabUpdated(9, { status: "loading" }), () => onReadingTabRemoved(9)]) {
      const ports = Array.from({ length: 127 }, () => port(extensionSender()));
      for (const item of ports) handleReadingPort(item);
      await Promise.all(ports.map((item) => item.first));
      assert.ok(ports.every((item) => item.messages[0]?.type === "reading.invalidate"));
      onReadingTabUpdated(99, { url: "unrelated" }); onReadingTabRemoved(99); onReadingTabUpdated(9, { status: "complete" });
      assert.ok(ports.every((item) => !item.disconnected)); assert.equal(other.disconnected, false);
      change();
      assert.ok(ports.every((item) => item.disconnected), "Navigation must release old native ports without waiting for publish");
      assert.equal(other.disconnected, false);
    }
  } finally { configureReadingRuntime(); globalThis.chrome = original; }
});

test("Validated BEGIN sourceLanguage survives through registeredOperation into SAVE and is immutable on retry", async () => {
  let registered;
  const service = createReadingService({ browser: nativeBrowser(), collector: collector(), now: () => 1000,
    repository: repositoryDouble({ async mutate({ registeredOperation, assertCurrent }) { assertCurrent(); registered = registeredOperation;
      return { state: "saved", recordId: registeredOperation.token.recordId, revision: 1, artifactId: artifact().artifactId, duplicate: false }; } }) });
  await service.handle(request(M.REGISTER_DOCUMENT), contentSender());
  const page = await derivePageIdentity(contentSender().url);
  const beginRequest = request(M.BEGIN_QUERY, { pageKey: page.pageKey, sourceLanguage: "fr-CA" });
  const begin = await service.handle(beginRequest, contentSender()); assert.equal(begin.ok, true);
  const saved = await service.handle(request(M.SAVE_QUERY_RESULT, { token: begin.data.token }), contentSender()); assert.equal(saved.ok, true);
  assert.equal(registered.sourceLanguage, "fr-CA", "Saving cannot guess sourceLanguage from an artifact, token or snapshot");
  assert.throws(() => { registered.sourceLanguage = "en"; }, TypeError);
  const retry = await service.handle(beginRequest, contentSender()); assert.deepEqual(retry, begin);
  assert.equal(service.operations.get(registered.access, "op-1"), registered);
  const changed = await service.handle({ ...beginRequest, sourceLanguage: "en" }, contentSender()); assert.equal(changed.error.code, E.STALE_OPERATION);
});

test("EXPORT_CANCEL cannot ACK or free capacity while its native repository chunk is still pending", async () => {
  const entered = deferred(), release = deferred(), cancelledInRepository = deferred(); let nonce = 0, reads = 0, settled = false;
  const registry = createExportRegistry({ now: () => 1000, randomId: () => `postmerge-${nonce++}`,
    repository: repositoryDouble({ async readExportChunk({ assertCurrent }) { reads++; entered.resolve(); await release.promise; assertCurrent(); return { exportRevision: 1, position: 1, jsonChunk: "{}", done: true }; },
      async cancelExport({ assertCurrent }) { assertCurrent(); cancelledInRepository.resolve(); } }) });
  const context = (n) => ({ access: { ownerKey: `owner-${n}`, tabId: n + 9, navigationGeneration: 1 }, request: {}, assertCurrent() {} });
  const a = context(0), opened = await registry.start(a); await registry.start(context(1));
  const chunk = registry.next({ ...a, request: { exportId: opened.exportId, cursor: opened.nextCursor } });
  const rejectedChunk = assert.rejects(chunk, (error) => error.code === E.INTERRUPTED);
  await entered.promise;
  const cancellation = registry.cancel({ ...a, request: { exportId: opened.exportId } }).then((value) => { settled = true; return value; });
  await cancelledInRepository.promise;
  try {
    await assert.rejects(() => registry.start(context(2)), (error) => error.code === E.CAPACITY,
      "An early cancel ACK must not admit a third repository export while the old chunk is blocked");
    assert.equal(settled, false); assert.equal(reads, 1);
  } finally { release.resolve(); await rejectedChunk; await cancellation; }
  assert.equal((await cancellation).state, "cancelled");
  assert.ok((await registry.start(context(2))).exportId);
});

test("Pending native/repository subscription authorization cannot resurrect after tab URL/loading/removal; unrelated tab stays open", async (t) => {
  for (const phase of ["native-known-tab", "native-unknown-tab", "repository"]) for (const change of ["url", "loading", "removal"]) await t.test(`${phase}/${change}`, async () => {
    const original = globalThis.chrome, { browser } = browserWithTwoTabs(), entered = deferred(), release = deferred(), complete = deferred();
    const native = browser.runtime.getContexts;
    if (phase.startsWith("native")) browser.runtime.getContexts = async (query) => { entered.resolve(); await release.promise; return native(query); };
    globalThis.chrome = browser;
    try {
      configureReadingRuntime({ repository: { async readInvalidationState({ assertCurrent }) {
        if (phase === "repository") { entered.resolve(); await release.promise; }
        assertCurrent(); return invalidation();
      } } });
      const sender = phase === "native-known-tab" ? extensionSender({ tab: { id: 9, incognito: false } }) : extensionSender();
      const item = port(sender);
      const post = item.postMessage, disconnect = item.disconnect;
      item.postMessage = function (value) { post.call(this, value); complete.resolve(); };
      item.disconnect = function () { disconnect.call(this); complete.resolve(); };
      handleReadingPort(item); await entered.promise;
      onReadingTabUpdated(99, { url: "unrelated" }); onReadingTabRemoved(99); onReadingTabUpdated(-1, { status: "loading" });
      assert.equal(item.disconnected, false);
      if (change === "removal") onReadingTabRemoved(9); else onReadingTabUpdated(9, change === "url" ? { url: "same-document" } : { status: "loading" });
      if (phase !== "native-unknown-tab") assert.equal(item.disconnected, true, "Native known-tab slot must release synchronously");
      release.resolve(); await complete.promise;
      // Let the original pending authorization finish, rather than hiding resurrection with another configure.
      await native({ documentIds: [sender.documentId] }); await Promise.resolve(); await Promise.resolve();
      assert.equal(item.disconnected, true);
      assert.equal(item.messages.some((value) => value.type === "reading.invalidate"), false);
    } finally { release.resolve(); configureReadingRuntime(); globalThis.chrome = original; }
  });
});

test("Unresolved native ownership remembers bounded tab barriers without closing unrelated known owners", async () => {
  const entered = deferred(), release = deferred(), { browser, contexts } = browserWithTwoTabs();
  const native = browser.runtime.getContexts;
  browser.runtime.getContexts = async (query) => { entered.resolve(); await release.promise; return native(query); };
  const subscriptions = createReadingSubscriptions({ accessControl: createReadingAccess({ browser }),
    repository: { async readInvalidationState({ assertCurrent }) { assertCurrent(); return invalidation(); } } });
  const item = port(extensionSender()), pending = subscriptions.connect(item); await entered.promise;
  for (let id = 100; id < 228; id++) subscriptions.closeTab(id);
  assert.equal(subscriptions.size, 1); assert.equal(item.disconnected, false);
  subscriptions.closeTab(228); assert.equal(subscriptions.size, 0); assert.equal(item.disconnected, true);
  release.resolve(); await pending; assert.equal(item.messages.length, 0);
  const known = port(extensionSender({ documentId: contexts[1].documentId })); await subscriptions.connect(known);
  for (let id = 100; id < 300; id++) subscriptions.closeTab(id);
  assert.equal(known.disconnected, false); subscriptions.close();
});

test("In-flight chunk reservations survive cancellation error, revoke and TTL expiry until reads settle", async (t) => {
  for (const outcome of ["cancel-error", "revoke", "expiry"]) await t.test(outcome, async () => {
    const entered = deferred(), release = deferred(), cancelEntered = deferred(); let now = 1000, nonce = 0, settled = false;
    const registry = createExportRegistry({ now: () => now, randomId: () => `lifecycle-${nonce++}`,
      repository: repositoryDouble({ async readExportChunk({ assertCurrent }) { entered.resolve(); await release.promise; assertCurrent(); return { exportRevision: 1, position: 1, jsonChunk: "{}", done: true }; },
        async cancelExport({ assertCurrent }) { assertCurrent(); cancelEntered.resolve(); if (outcome === "cancel-error") fail(E.STORAGE, "fixture.cancel"); } }) });
    const context = (n) => ({ access: { ownerKey: `owner-${n}`, tabId: n + 9, navigationGeneration: 1 }, request: {}, assertCurrent() {} });
    const a = context(0), opened = await registry.start(a), second = await registry.start(context(1));
    const chunk = assert.rejects(registry.next({ ...a, request: { exportId: opened.exportId, cursor: opened.nextCursor } }), (error) => error.code === E.INTERRUPTED);
    await entered.promise;
    const cancellation = assert.rejects(registry.cancel({ ...a, request: { exportId: opened.exportId } }), (error) => {
      settled = true; return error.code === (outcome === "cancel-error" ? E.STORAGE : E.INTERRUPTED);
    });
    await cancelEntered.promise;
    if (outcome === "revoke") registry.revoke();
    if (outcome === "expiry") now = opened.expiresAt;
    try {
      assert.equal(settled, false);
      await assert.rejects(() => registry.start(a), (error) => error.code === E.CAPACITY);
      if (outcome === "cancel-error") await assert.rejects(() => registry.start(context(2)), (error) => error.code === E.CAPACITY);
      if (outcome === "revoke" || outcome === "expiry") assert.ok((await registry.start(context(2))).exportId); // Other idle/revoked slot has no work.
    } finally { release.resolve(); await chunk; await cancellation; }
    assert.ok((await registry.start(a)).exportId);
    assert.ok(second.exportId);
  });
});

test("Rejected pending chunk still permits real cancellation ACK only after settlement and preserves terminal retry", async () => {
  const entered = deferred(), release = deferred(), cancelEntered = deferred(); let nonce = 0, cancelled = false;
  const registry = createExportRegistry({ now: () => 1000, randomId: () => `rejected-${nonce++}`,
    repository: repositoryDouble({ async readExportChunk() { entered.resolve(); await release.promise; fail(E.STORAGE, "fixture.chunk"); },
      async cancelExport({ assertCurrent }) { assertCurrent(); cancelEntered.resolve(); } }) });
  const context = { access: { ownerKey: "owner", tabId: 9, navigationGeneration: 1 }, request: {}, assertCurrent() {} };
  const opened = await registry.start(context), cancelledContext = { ...context, request: { exportId: opened.exportId } };
  const chunk = assert.rejects(registry.next({ ...context, request: { exportId: opened.exportId, cursor: opened.nextCursor } }), (error) => error.code === E.STORAGE);
  await entered.promise;
  const cancellation = registry.cancel(cancelledContext).then((value) => { cancelled = true; return value; });
  await cancelEntered.promise;
  try { assert.equal(cancelled, false); await assert.rejects(() => registry.start(context), (error) => error.code === E.CAPACITY); }
  finally { release.resolve(); await chunk; }
  assert.deepEqual(await cancellation, { exportId: opened.exportId, state: "cancelled" });
  assert.deepEqual(await registry.cancel(cancelledContext), await cancellation);
  assert.ok((await registry.start(context)).exportId);
});

test("Expired/revoked pending export-open work keeps owner admission until repository settlement", async (t) => {
  for (const change of ["expiry", "revoke", "cancel"]) await t.test(change, async () => {
    const entered = deferred(), release = deferred(); let now = 1000, nonce = 0;
    const registry = createExportRegistry({ now: () => now, randomId: () => `opening-${nonce++}`,
      repository: repositoryDouble({ async openExport({ assertCurrent }) { entered.resolve(); await release.promise; assertCurrent(); return { exportRevision: 1, exportedAt: 1000, position: 0 }; } }) });
    const context = { access: { ownerKey: "owner", tabId: 9, navigationGeneration: 1 }, request: {}, assertCurrent() {} };
    const opening = assert.rejects(registry.start(context), (error) => error.code === E.INTERRUPTED); await entered.promise;
    if (change === "expiry") now = 601000;
    else if (change === "revoke") registry.revoke();
    else assert.equal((await registry.cancel({ ...context, request: { exportId: "opening-0" } })).state, "cancelled");
    try { await assert.rejects(() => registry.start(context), (error) => error.code === E.CAPACITY); }
    finally { release.resolve(); await opening; }
    assert.ok((await registry.start(context)).exportId);
  });
});
