import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E, READING_INVALIDATION_PORT, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { createReadingAccess } from "../src/background/reading-record/access.js";
import { createReadingSubscriptions } from "../src/background/reading-record/subscriptions.js";
import { validateReadingSiteMarkersInvalidation } from "../src/shared/reading/invalidations.js";
import { READING_SITE_MARKERS_INVALIDATION } from "../src/shared/reading/constants.js";
import { createReadingService } from "../src/background/reading-record/service.js";
import { createExportRegistry } from "../src/background/reading-record/exports.js";
import { fail } from "../src/shared/reading/validation.js";
import { recordingState, request } from "./fixtures/reading/contract.mjs";
import { extensionSender, nativeBrowser, repositoryDouble } from "./fixtures/reading/access.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function port(sender = extensionSender()) {
  const disconnectListeners = [], messageListeners = [], messages = [];
  return { name: READING_INVALIDATION_PORT, sender, messages, disconnected: false,
    onDisconnect: { addListener: (listener) => disconnectListeners.push(listener) },
    onMessage: { addListener: (listener) => messageListeners.push(listener) },
    postMessage(message) { messages.push(message); },
    disconnect() { this.disconnected = true; for (const listener of disconnectListeners) listener(); },
    callerMessage() { for (const listener of messageListeners) listener({ scope: "extension" }); } };
}
const invalidation = () => ({ protocolVersion: 2, type: "reading.invalidate", catalogRevision: 1, dataGeneration: 1, consentGeneration: 1 });

test("Subscriptions reserve pending native-authorized connects before repository await; 129th is CAPACITY", async () => {
  const entered = deferred(), release = deferred(); let reads = 0;
  const subscriptions = createReadingSubscriptions({ accessControl: createReadingAccess({ browser: nativeBrowser() }),
    repository: { async readInvalidationState({ assertCurrent }) {
      if (++reads === 128) entered.resolve();
      await release.promise; assertCurrent(); return invalidation();
    } } });
  const ports = Array.from({ length: 129 }, () => port());
  const pending = ports.map((item) => subscriptions.connect(item));
  await entered.promise; release.resolve(); await Promise.all(pending);
  assert.equal(reads, 128);
  assert.equal(subscriptions.size, 128);
  assert.equal(ports.filter((item) => item.messages.some((message) => message.type === "reading.invalidate")).length, 128);
  assert.equal(ports.filter((item) => item.messages.some((message) => message.error?.code === E.CAPACITY)).length, 1);
  subscriptions.close(); assert.equal(subscriptions.size, 0);
  const reused = port(); await subscriptions.connect(reused);
  assert.equal(reused.messages[0].type, "reading.invalidate"); subscriptions.close();
});

test("Site-marker changes publish a separate validated settings signal without changing DB revisions", async () => {
  let reads = 0;
  const subscriptions = createReadingSubscriptions({ accessControl: createReadingAccess({ browser: nativeBrowser() }),
    repository: { async readInvalidationState({ assertCurrent }) { assertCurrent(); reads++; return invalidation(); } } });
  const item = port(); await subscriptions.connect(item);
  assert.equal(reads, 1); assert.deepEqual(item.messages[0], invalidation());
  await subscriptions.publishSiteMarkers();
  assert.equal(reads, 1);
  assert.deepEqual(item.messages[1], { protocolVersion: 2, type: READING_SITE_MARKERS_INVALIDATION });
  assert.deepEqual(validateReadingSiteMarkersInvalidation(item.messages[1]), item.messages[1]);
  assert.throws(() => validateReadingSiteMarkersInvalidation({ ...item.messages[1], dataGeneration: 2 }));
  subscriptions.close();
});

test("Pending/active subscription reservations release on disconnect, caller message, global close and refusal", async () => {
  for (const action of ["disconnect", "callerMessage", "close"]) {
    const entered = deferred(), release = deferred(); let reads = 0;
    const subscriptions = createReadingSubscriptions({ accessControl: createReadingAccess({ browser: nativeBrowser() }),
      repository: { async readInvalidationState({ assertCurrent }) {
        reads++; entered.resolve(); await release.promise; assertCurrent(); return invalidation();
      } } });
    const item = port(), pending = subscriptions.connect(item);
    await entered.promise;
    assert.equal(subscriptions.size, 1); await subscriptions.publish(); assert.equal(reads, 1);
    if (action === "close") subscriptions.close(); else item[action]();
    release.resolve(); await pending;
    assert.equal(subscriptions.size, 0); assert.equal(item.messages.length, 0);
  }
  const browser = nativeBrowser(), release = deferred(), entered = deferred();
  const nativeContexts = browser.runtime.getContexts;
  browser.runtime.getContexts = async (query) => { entered.resolve(); await release.promise; return nativeContexts(query); };
  const early = createReadingSubscriptions({ accessControl: createReadingAccess({ browser }),
    repository: { async readInvalidationState({ assertCurrent }) { assertCurrent(); return invalidation(); } } });
  const item = port(), pending = early.connect(item); await entered.promise; item.disconnect(); release.resolve(); await pending;
  assert.equal(early.size, 0); assert.equal(item.messages.length, 0);
  for (const repository of [null, { async readInvalidationState() { fail(E.STORAGE, "fixture"); } },
    { async readInvalidationState() { return { ...invalidation(), pageUrl: "forbidden" }; } }]) {
    const subscriptions = createReadingSubscriptions({ accessControl: createReadingAccess({ browser: nativeBrowser() }), repository });
    const rejected = port(); await subscriptions.connect(rejected);
    assert.equal(subscriptions.size, 0); assert.equal(rejected.disconnected, true);
    assert.equal(rejected.messages.length, 1); assert.equal(rejected.messages[0].ok, false);
  }
  const refused = createReadingSubscriptions({ accessControl: createReadingAccess({ browser: nativeBrowser() }),
    repository: { async readInvalidationState() { return invalidation(); } } });
  const privateBrowser = nativeBrowser(), native = (await privateBrowser.runtime.getContexts())[0];
  privateBrowser.runtime.getContexts = async () => [{ ...native, incognito: true }];
  const privateSubscriptions = createReadingSubscriptions({ accessControl: createReadingAccess({ browser: privateBrowser }) });
  const privatePort = port(); await privateSubscriptions.connect(privatePort);
  assert.equal(privatePort.messages[0].error.code, E.FORBIDDEN); assert.equal(privateSubscriptions.size, 0);
  const raced = port(); raced.postMessage = () => { throw new Error("synthetic disconnected port"); };
  await refused.connect(raced); assert.equal(refused.size, 0); assert.equal(raced.disconnected, true);
});

test("Tab navigation/removal revoke only native export owners; unrelated tabs preserve both and global revoke interrupts", async () => {
  for (const action of ["invalidateTab", "forgetTab"]) {
    const browser = nativeBrowser(), first = (await browser.runtime.getContexts())[0];
    const second = { ...first, contextId: "44444444-4444-4444-8444-444444444444", documentId: "55555555-5555-4555-8555-555555555555", tabId: 10 };
    browser.runtime.getContexts = async ({ documentIds }) => [first, second].filter((item) => documentIds.includes(item.documentId));
    const service = createReadingService({ browser, repository: repositoryDouble(), now: () => 1000 });
    const senders = [extensionSender(), extensionSender({ documentId: second.documentId })];
    const opened = await Promise.all(senders.map((sender) => service.handle(request(M.EXPORT_START), sender)));
    assert.equal(opened.every((result) => result.ok), true);
    const requests = opened.map((result) => request(M.EXPORT_NEXT, { exportId: result.data.exportId, cursor: result.data.nextCursor }));
    const before = await Promise.all(senders.map((sender, i) => service.handle(requests[i], sender)));
    assert.equal(before.every((result) => result.ok && result.data.sequence === 0), true);
    service[action](99);
    const unrelated = await Promise.all(senders.map((sender, i) => service.handle(requests[i], sender)));
    assert.deepEqual(unrelated, before);
    service[action](9);
    const next = requests.map((input, i) => ({ ...input, cursor: before[i].data.nextCursor }));
    assert.equal((await service.handle(next[0], senders[0])).error.code, E.INTERRUPTED);
    assert.equal((await service.handle(next[1], senders[1])).ok, true);
    service.revoke();
    assert.equal((await service.handle(next[1], senders[1])).error.code, E.INTERRUPTED);
  }
  const service = createReadingService({ browser: nativeBrowser(), repository: repositoryDouble(), now: () => 1000 });
  const opened = await service.handle(request(M.EXPORT_START), extensionSender());
  assert.equal((await service.handle(request(M.SET_RECORDING, { enabled: false }), extensionSender())).ok, true);
  assert.equal((await service.handle(request(M.EXPORT_NEXT, { exportId: opened.data.exportId, cursor: opened.data.nextCursor }), extensionSender())).error.code, E.INTERRUPTED);
});

test("Buffered export retry cannot return a different cursor chunk after concurrent next/cancel/revoke/revision", async () => {
  for (const change of ["advance", "cancel", "revoke", "revision", "unchanged"]) {
    const entered = deferred(), release = deferred(); let revision = 1, nonce = 0;
    const repository = repositoryDouble({ async checkExport({ exportRevision, assertCurrent }) {
      entered.resolve(); await release.promise; assertCurrent();
      if (revision !== exportRevision) fail(E.INTERRUPTED, "fixture.revision");
    } });
    const registry = createExportRegistry({ repository, now: () => 1000, randomId: () => `cursor-${nonce++}` });
    const context = { access: { ownerKey: "native-owner", tabId: 9, navigationGeneration: 1 }, request: {}, assertCurrent() {} };
    const opened = await registry.start(context);
    const c0 = { ...context, request: { exportId: opened.exportId, cursor: opened.nextCursor } };
    const chunk0 = await registry.next(c0); assert.equal(chunk0.sequence, 0);
    const oldRetry = registry.next(c0);
    const outcome = change === "unchanged" ? oldRetry : assert.rejects(oldRetry, (error) => error.code === E.INTERRUPTED);
    await entered.promise;
    let cancellation;
    if (change === "advance") {
      const chunk1 = await registry.next({ ...c0, request: { ...c0.request, cursor: chunk0.nextCursor } });
      assert.equal(chunk1.sequence, 1); assert.notEqual(chunk1.jsonChunk, chunk0.jsonChunk);
    } else if (change === "cancel") cancellation = registry.cancel({ ...context, request: { exportId: opened.exportId } });
    else if (change === "revoke") registry.revoke();
    else if (change === "revision") revision++;
    release.resolve();
    const result = await outcome;
    if (cancellation) assert.equal((await cancellation).state, "cancelled");
    if (change === "unchanged") assert.deepEqual(result, chunk0);
  }
});

test("Pending export start cannot revive after pause, cancel, owner navigation, removal, permission revoke or expiry", async (t) => {
  for (const change of ["pause", "cancel", "navigation", "removal", "permission", "expiry", "unchanged"]) await t.test(change, async () => {
    const entered = deferred(), release = deferred(); let now = 1000, nonce = 0;
    const service = createReadingService({ browser: nativeBrowser(), now: () => now, randomId: () => `reserved-${++nonce}`,
      repository: repositoryDouble({ async openExport({ assertCurrent }) {
        entered.resolve(); await release.promise; assertCurrent(); return { exportRevision: 1, exportedAt: 1000, position: 0 };
      }, async mutate({ request: input, assertCurrent }) {
        assertCurrent(); assert.equal(input.method, M.SET_RECORDING);
        return recordingState("extension", { enabled: input.enabled, consentGeneration: 2 });
      } }) });
    const starting = service.handle(request(M.EXPORT_START), extensionSender());
    await entered.promise;
    if (change === "pause") {
      const paused = await service.handle(request(M.SET_RECORDING, { enabled: false }), extensionSender());
      assert.equal(paused.ok, true); assert.equal(paused.data.enabled, false);
    } else if (change === "cancel") {
      const cancelled = await service.handle(request(M.EXPORT_CANCEL, { exportId: "reserved-1" }), extensionSender());
      assert.equal(cancelled.ok, true); assert.equal(cancelled.data.state, "cancelled");
    } else if (change === "navigation") service.invalidateTab(9);
    else if (change === "removal") service.forgetTab(9);
    else if (change === "permission") service.revoke();
    else if (change === "expiry") now = 601000;
    release.resolve();
    const result = await starting;
    if (change === "unchanged") {
      assert.equal(result.ok, true);
      assert.equal((await service.handle(request(M.EXPORT_NEXT, { exportId: result.data.exportId, cursor: result.data.nextCursor }), extensionSender())).data.sequence, 0);
    } else {
      assert.equal(result.ok, false, `${change} must not resurrect a starting export`);
      assert.equal(result.error.code, ["navigation", "removal", "permission"].includes(change) ? E.STALE_OPERATION : E.INTERRUPTED);
      if (change === "cancel") {
        const retry = await service.handle(request(M.EXPORT_CANCEL, { exportId: "reserved-1" }), extensionSender());
        assert.equal(retry.ok, true); assert.equal(retry.data.state, "cancelled");
      }
    }
  });
});

test("Finish refuses cancellation while pending; revoked pre-commit finish cannot deliver and delivered receipt stays finished", async () => {
  for (const interrupt of [true, false]) {
    const entered = deferred(), release = deferred(); let nonce = 0;
    const registry = createExportRegistry({ now: () => 1000, randomId: () => `finish-${nonce++}`,
      repository: repositoryDouble({ async finishExport({ assertCurrent }) {
        entered.resolve(); await release.promise; assertCurrent(); // Synthetic short-transaction commit boundary, not real IDB.
      } }) });
    const context = { access: { ownerKey: "native-owner", tabId: 9, navigationGeneration: 1 }, request: {}, assertCurrent() {} };
    const opened = await registry.start(context);
    const first = await registry.next({ ...context, request: { exportId: opened.exportId, cursor: opened.nextCursor } });
    const last = await registry.next({ ...context, request: { exportId: opened.exportId, cursor: first.nextCursor } });
    const finishContext = { ...context, request: { exportId: opened.exportId, sequence: last.sequence } };
    const cancelContext = { ...context, request: { exportId: opened.exportId } };
    const pending = registry.finish(finishContext);
    const outcome = interrupt ? assert.rejects(pending, (error) => error.code === E.INTERRUPTED) : pending;
    await entered.promise;
    await assert.rejects(() => registry.cancel(cancelContext), (error) => error.code === E.INTERRUPTED);
    if (interrupt) registry.revoke();
    release.resolve(); const receipt = await outcome;
    if (!interrupt) {
      assert.equal(receipt.state, "finished"); registry.revoke();
      assert.equal((await registry.cancel(cancelContext)).state, "finished");
      assert.deepEqual(await registry.finish(finishContext), receipt);
    }
  }
});

test("Unacknowledged export finish/cancel reserves per-owner and global export capacity", async (t) => {
  for (const phase of ["finishing", "cancelling"]) for (const limit of ["owner", "global"]) await t.test(`${phase}/${limit}`, async () => {
    const entered = deferred(), release = deferred(); let nonce = 0;
    const terminal = async ({ assertCurrent }) => { entered.resolve(); await release.promise; assertCurrent(); };
    const registry = createExportRegistry({ now: () => 1000, randomId: () => `capacity-${nonce++}`,
      repository: repositoryDouble({ [phase === "finishing" ? "finishExport" : "cancelExport"]: terminal }) });
    const context = (owner) => ({ access: { ownerKey: `native-owner-${owner}`, tabId: 9 + owner, navigationGeneration: 1 }, request: {}, assertCurrent() {} });
    const a = context(0), opened = await registry.start(a);
    if (limit === "global") await registry.start(context(1));
    let sequence = 0;
    if (phase === "finishing") {
      const first = await registry.next({ ...a, request: { exportId: opened.exportId, cursor: opened.nextCursor } });
      const last = await registry.next({ ...a, request: { exportId: opened.exportId, cursor: first.nextCursor } }); sequence = last.sequence;
    }
    const endContext = { ...a, request: { exportId: opened.exportId, ...(phase === "finishing" ? { sequence } : {}) } };
    const pending = phase === "finishing" ? registry.finish(endContext) : registry.cancel(endContext);
    await entered.promise;
    try {
      await assert.rejects(() => registry.start(limit === "owner" ? a : context(2)), (error) => error.code === E.CAPACITY);
      if (limit === "owner") assert.ok((await registry.start(context(1))).exportId);
    } finally { release.resolve(); await pending; }
    assert.ok((await registry.start(limit === "owner" ? a : context(2))).exportId); // Terminal acknowledgement releases the active slot.
  });
});

test("Invalid export-start repository metadata releases its reservation before a valid retry", async () => {
  let calls = 0, nonce = 0;
  const registry = createExportRegistry({ now: () => 1000, randomId: () => `metadata-${nonce++}`,
    repository: repositoryDouble({ async openExport({ assertCurrent }) {
      assertCurrent(); calls++;
      return calls === 1 ? { exportedAt: 1000, position: 0 } : { exportRevision: 1, exportedAt: 1000, position: 0 };
    } }) });
  const context = { access: { ownerKey: "native-owner", tabId: 9, navigationGeneration: 1 }, request: {}, assertCurrent() {} };
  await assert.rejects(() => registry.start(context), (error) => error.code === E.BAD_DTO);
  let opened;
  await assert.doesNotReject(async () => { opened = await registry.start(context); },
    `Valid retry must reach the repository after rejected metadata (calls=${calls}, retained sessions=${registry.size})`);
  assert.equal(calls, 2); assert.equal(registry.size, 1);
  assert.equal((await registry.next({ ...context, request: { exportId: opened.exportId, cursor: opened.nextCursor } })).sequence, 0);
});
