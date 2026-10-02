import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E, READING_INVALIDATION_PORT, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { createReadingAccess } from "../src/background/reading-record/access.js";
import { createReadingSubscriptions } from "../src/background/reading-record/subscriptions.js";
import { createReadingService } from "../src/background/reading-record/service.js";
import { createExportRegistry } from "../src/background/reading-record/exports.js";
import { fail } from "../src/shared/reading/validation.js";
import { request } from "./fixtures/reading/contract.mjs";
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
    if (change === "advance") {
      const chunk1 = await registry.next({ ...c0, request: { ...c0.request, cursor: chunk0.nextCursor } });
      assert.equal(chunk1.sequence, 1); assert.notEqual(chunk1.jsonChunk, chunk0.jsonChunk);
    } else if (change === "cancel") await registry.cancel({ ...context, request: { exportId: opened.exportId } });
    else if (change === "revoke") registry.revoke();
    else if (change === "revision") revision++;
    release.resolve();
    const result = await outcome;
    if (change === "unchanged") assert.deepEqual(result, chunk0);
  }
});
