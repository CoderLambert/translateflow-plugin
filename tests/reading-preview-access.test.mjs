import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { createReadingService } from "../src/background/reading-record/service.js";
import { request, response } from "./fixtures/reading/contract.mjs";
import { collector, contentSender, extensionSender, nativeBrowser } from "./fixtures/reading/access.mjs";
import { derivePageIdentity } from "../src/background/reading-record/policy.js";

const SITE = "https://example.test";
const recordId = request(M.GET_RECORD).recordId;
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function frameSender(browser, { previewId, tabId = 7, frameId = 5, documentId = "33333333-3333-4333-8333-333333333333",
  contextId = "44444444-4444-4444-8444-444444444444" } = {}) {
  const url = browser.runtime.getURL(`reading-preview.html?previewId=${encodeURIComponent(previewId)}`);
  return { id: browser.runtime.id, url, documentId, frameId, documentLifecycle: "active",
    tab: { id: tabId, incognito: false, url: contentSender().url }, contextId };
}
async function setup({ delayTarget = null } = {}) {
  const browser = nativeBrowser(), contexts = new Map(), native = (await browser.runtime.getContexts())[0];
  browser.runtime.getContexts = async ({ documentIds } = {}) => {
    const all = [native, ...contexts.values()];
    return documentIds ? all.filter(context => documentIds.includes(context.documentId)) : all;
  };
  const access = await derivePageIdentity(contentSender().url);
  const savedDetail = response(M.GET_RECORD).data;
  savedDetail.record.pageKey = access.pageKey;
  let enabled = true, permissionGranted = true, reads = 0, delayedTarget = delayTarget;
  const target = async ({ assertCurrent }) => {
    assertCurrent(); reads++;
    if (delayedTarget) { delayedTarget.entered.resolve(); await delayedTarget.release.promise; }
    assertCurrent();
    return { detail: savedDetail, recordId, siteKey: access.siteKey, pageKey: access.pageKey, revision: savedDetail.record.revision,
      dataGeneration: 1, consentGeneration: 1, pageGeneration: 1, pageRevision: 1, sitePolicyRevision: 1 };
  };
  const repository = {
    async readPolicy({ assertCurrent }) { assertCurrent(); return { siteExcluded: false }; },
    async readPreviewTarget(context) { return target(context); }
  };
  const siteMarkers = {
    async get(siteKey) { return { state: enabled && !permissionGranted ? "permission-required" : "ready", enabled, permissionGranted, siteKey }; },
    async set(_siteKey, next) { enabled = next; return { state: "ready", enabled, permissionGranted }; }
  };
  const service = createReadingService({ browser, repository, collector: collector(), siteMarkers, now: () => 1000,
    randomId: (() => { let value = 0; return () => `preview-${++value}`; })() });
  assert.equal((await service.handle(request(M.REGISTER_DOCUMENT), contentSender())).ok, true);
  const created = await service.handle(request(M.PREVIEW_CREATE), contentSender());
  assert.equal(created.ok, true);
  const previewId = created.data.previewId;
  function addFrame(sender) {
    const context = { contextId: sender.contextId, documentId: sender.documentId, documentUrl: sender.url, contextType: "TAB",
      incognito: false, tabId: sender.tab.id, frameId: sender.frameId };
    contexts.set(sender.documentId, context); return sender;
  }
  async function claim(sender) {
    const result = await service.handle(request(M.PREVIEW_CLAIM, { previewId }), sender);
    return result;
  }
  async function bind(claimId) { return service.handle(request(M.PREVIEW_BIND, { previewId, claimId }), contentSender()); }
  return { browser, service, access, previewId, addFrame, claim, bind, siteMarkers,
    holdTarget(gate) { delayedTarget = gate; }, get reads() { return reads; } };
}

test("Preview detail is scoped to the one exact claimed iframe and URL ids are not authority", async () => {
  const env = await setup();
  const trueFrame = env.addFrame(frameSender(env.browser, { previewId: env.previewId }));
  const sibling = env.addFrame(frameSender(env.browser, { previewId: env.previewId, frameId: 6,
    documentId: "55555555-5555-4555-8555-555555555555", contextId: "66666666-6666-4666-8666-666666666666" }));
  const siblingClaim = await env.claim(sibling); assert.equal(siblingClaim.ok, true);
  const trueClaim = await env.claim(trueFrame); assert.equal(trueClaim.ok, true);
  assert.equal((await env.bind(trueClaim.data.claimId)).data.bound, true);
  const allowed = await env.service.handle(request(M.PREVIEW_READ, { previewId: env.previewId }), trueFrame);
  const expectedDetail = response(M.PREVIEW_READ).data; expectedDetail.record.pageKey = env.access.pageKey;
  assert.equal(allowed.ok, true); assert.deepEqual(allowed.data, expectedDetail);
  assert.equal(env.reads, 3); // create, bind recheck, then readonly read; the preview read never marks viewed.
  const deniedSibling = await env.service.handle(request(M.PREVIEW_READ, { previewId: env.previewId }), sibling);
  assert.equal(deniedSibling.error.code, E.FORBIDDEN);
  const otherTab = env.addFrame(frameSender(env.browser, { previewId: env.previewId, tabId: 8, frameId: 5,
    documentId: "77777777-7777-4777-8777-777777777777", contextId: "88888888-8888-4888-8888-888888888888" }));
  assert.equal((await env.service.handle(request(M.PREVIEW_READ, { previewId: env.previewId }), otherTab)).error.code, E.FORBIDDEN);
  assert.equal((await env.service.handle(request(M.PREVIEW_READ, { previewId: env.previewId }), contentSender())).error.code, E.FORBIDDEN);
  assert.equal((await env.service.handle(request(M.PREVIEW_READ, { previewId: env.previewId }), extensionSender())).error.code, E.FORBIDDEN);
  const wrongUrl = { ...trueFrame, url: env.browser.runtime.getURL("reading-preview.html?previewId=copied") };
  assert.equal((await env.service.handle(request(M.PREVIEW_READ, { previewId: env.previewId }), wrongUrl)).error.code, E.FORBIDDEN);
});

test("Late readonly response is discarded after site-marker revocation", async () => {
  const env = await setup();
  const frame = env.addFrame(frameSender(env.browser, { previewId: env.previewId }));
  const claim = await env.claim(frame); assert.equal(claim.ok, true);
  assert.equal((await env.bind(claim.data.claimId)).data.bound, true);
  const gate = { entered: deferred(), release: deferred() }; env.holdTarget(gate);
  const pending = env.service.handle(request(M.PREVIEW_READ, { previewId: env.previewId }), frame);
  await gate.entered.promise;
  const revoked = await env.service.handle(request(M.SET_SITE_MARKERS, { siteKey: SITE, enabled: false }), extensionSender());
  assert.equal(revoked.ok, true); assert.equal(revoked.data.enabled, false);
  gate.release.resolve();
  const late = await pending;
  assert.equal(late.ok, false); assert.equal(late.error.code, E.STALE_OPERATION);
});
