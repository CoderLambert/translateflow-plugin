import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { createOperationRegistry } from "../src/background/reading-record/operations.js";
import { createReadingService } from "../src/background/reading-record/service.js";
import { createExportRegistry } from "../src/background/reading-record/exports.js";
import { artifact, request, token } from "./fixtures/reading/contract.mjs";
import { collector, contentSender, extensionSender, nativeBrowser, repositoryDouble } from "./fixtures/reading/access.mjs";
import { derivePageIdentity } from "../src/background/reading-record/policy.js";
const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code);
const asyncRejects = (fn, code) => assert.rejects(fn, (error) => error.code === code);
const owner = (n = 0) => ({ ownerKey: `owner-${n}`, documentGeneration: "doc-1", navigationGeneration: 1, pageKey: token().pageKey, selectionGeneration: 1 });

test("Operation cap is backend-registered, immutable, owner-bound, fixed TTL and capacity bounded", () => {
  let now = 1000; const ops = createOperationRegistry({ now: () => now });
  const a = owner(), req = request(M.BEGIN_QUERY), saved = ops.register(a, req, "fingerprint", token(), req.sourceSnapshot);
  assert.equal(ops.register(a, req, "fingerprint", token({ issuedAt: 1001, expiresAt: 601001 }), req.sourceSnapshot), saved);
  assert.equal(saved.token.expiresAt, 601000); assert.equal(ops.size, 1);
  rejects(() => ops.retry(a, req, "changed-source"), E.STALE_OPERATION);
  rejects(() => ops.get(owner(1), req.operationId), E.STALE_OPERATION);
  rejects(() => ops.assertCurrent(saved, { ...a, selectionGeneration: 2 }), E.STALE_OPERATION);
  for (let i = 1; i < L.operationsPerOwner; i++) ops.register(a, { ...req, operationId: `owner-op-${i}` }, `f${i}`, token({ operationId: `owner-op-${i}` }), req.sourceSnapshot);
  rejects(() => ops.register(a, { ...req, operationId: "over-owner" }, "f", token({ operationId: "over-owner" }), req.sourceSnapshot), E.CAPACITY);
  for (let n = 1; n < 8; n++) for (let i = 0; i < L.operationsPerOwner; i++) ops.register(owner(n), { ...req, operationId: `op-${n}-${i}` }, "f", token({ operationId: `op-${n}-${i}` }), req.sourceSnapshot);
  assert.equal(ops.size, 128);
  rejects(() => ops.register(owner(9), req, "f", token(), req.sourceSnapshot), E.CAPACITY);
  now = 601000; rejects(() => ops.get(a, req.operationId), E.STALE_OPERATION); assert.equal(ops.size, 0);
});
test("Synthetic repository cancellation receipts are retried, navigation/pause final guards reject late writes", async () => {
  let cancellations = 0, pauses = false;
  const repository = repositoryDouble({ cancelOperation: async ({ request, assertCurrent }) => {
    assertCurrent(); cancellations++; return { operationId: request.operationId, state: "cancelled", recordId: null, revision: null };
  }, mutate: async ({ assertCurrent }) => {
    assertCurrent(); if (pauses) { const error = new Error(); error.code = E.DISABLED; throw error; }
    return { state: "saved", recordId: token().recordId, revision: 1, artifactId: artifact().artifactId, duplicate: false };
  } });
  const service = createReadingService({ browser: nativeBrowser(), repository, collector: collector(), now: () => 1000 });
  await service.handle(request(M.REGISTER_DOCUMENT), contentSender());
  const page = await derivePageIdentity(contentSender().url);
  const begin = await service.handle(request(M.BEGIN_QUERY, { pageKey: page.pageKey }), contentSender()); assert.equal(begin.ok, true);
  const cancel = request(M.CANCEL_OPERATION);
  assert.equal((await service.handle(cancel, contentSender())).ok, true);
  assert.equal((await service.handle(cancel, contentSender())).ok, true); assert.equal(cancellations, 2);
  assert.equal((await service.handle(request(M.SAVE_QUERY_RESULT, { token: begin.data.token }), contentSender())).error.code, E.STALE_OPERATION);
  assert.equal((await service.handle(cancel, contentSender({ documentId: "44444444-4444-4444-8444-444444444444" }))).error.code, E.STALE_OPERATION);
  // Actual persistent cancellation/commit ordering is NOT tested by this synthetic double (#233 acceptance).
});
function exportSetup(repo = repositoryDouble()) {
  let now = 1000, nonce = 0;
  const registry = createExportRegistry({ repository: repo, now: () => now, randomId: () => `cursor-${nonce++}` });
  const context = (access = owner()) => ({ access, request: {}, assertCurrent() {} });
  return { registry, context, advance: (value) => { now = value; } };
}
test("Export owner caps, TTL, backpressure and single buffered retry chunk remain bounded", async () => {
  const { registry, context, advance } = exportSetup(); const a = context(), started = await registry.start(a);
  await asyncRejects(() => registry.start(a), E.CAPACITY);
  const second = await registry.start(context(owner(1))); assert.notEqual(second.exportId, started.exportId);
  await asyncRejects(() => registry.start(context(owner(2))), E.CAPACITY);
  const next = { ...a, request: { exportId: started.exportId, cursor: started.nextCursor } };
  await asyncRejects(() => registry.next({ ...next, access: owner(1) }), E.INTERRUPTED);
  const first = await registry.next(next); assert.equal(first.done, false);
  assert.deepEqual(await registry.next(next), first);
  const last = await registry.next({ ...next, request: { ...next.request, cursor: first.nextCursor } }); assert.equal(last.done, true);
  await asyncRejects(() => registry.next(next), E.INTERRUPTED);
  const finish = { ...a, request: { exportId: started.exportId, sequence: last.sequence } };
  const receipt = await registry.finish(finish); assert.deepEqual(await registry.finish(finish), receipt);
  assert.equal((await registry.cancel({ ...a, request: { exportId: started.exportId } })).state, "finished");
  advance(started.expiresAt); await asyncRejects(() => registry.finish(finish), E.INTERRUPTED);
});
test("Export EOF is not finished, mutation interrupts retry/finish, and failed chunks do not advance cursor", async () => {
  let revision = 1;
  const { registry, context } = exportSetup(repositoryDouble({
    checkExport({ exportRevision }) { if (revision !== exportRevision) { const e = new Error(); e.code = E.INTERRUPTED; throw e; } },
    async finishExport({ exportRevision }) { if (revision !== exportRevision) { const e = new Error(); e.code = E.INTERRUPTED; throw e; } }
  }));
  const a = context(), start = await registry.start(a), next = { ...a, request: { exportId: start.exportId, cursor: start.nextCursor } };
  await asyncRejects(() => registry.finish({ ...a, request: { exportId: start.exportId, sequence: 0 } }), E.INTERRUPTED);
  const first = await registry.next(next); revision = 2;
  await asyncRejects(() => registry.next(next), E.INTERRUPTED);
  const last = await registry.next({ ...next, request: { ...next.request, cursor: first.nextCursor } });
  await asyncRejects(() => registry.finish({ ...a, request: { exportId: start.exportId, sequence: last.sequence } }), E.INTERRUPTED);
  let valid = false;
  const bad = exportSetup(repositoryDouble({ async readExportChunk({ position, exportRevision }) {
    return { position: position + 1, exportRevision, jsonChunk: valid ? "ok" : "\u0001".repeat(L.exportChunkBytes), done: true };
  } }));
  const b = bad.context(), opened = await bad.registry.start(b), request = { ...b, request: { exportId: opened.exportId, cursor: opened.nextCursor } };
  await asyncRejects(() => bad.registry.next(request), E.LIMIT); valid = true;
  assert.equal((await bad.registry.next(request)).sequence, 0);
});
