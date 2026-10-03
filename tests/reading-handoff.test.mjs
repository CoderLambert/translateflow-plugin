import test from "node:test";
import assert from "node:assert/strict";
import { createHandoffRegistry } from "../src/background/reading-record/handoffs.js";
import { createReadingService } from "../src/background/reading-record/service.js";
import { READING_ERROR as E, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { derivePageIdentity } from "../src/background/reading-record/policy.js";
import { record } from "./fixtures/reading/contract.mjs";
import { contentSender, extensionSender, nativeBrowser, repositoryDouble } from "./fixtures/reading/access.mjs";

const RECORD = record();
const IDENTITY = await derivePageIdentity(RECORD.safeReturnUrl);
function target(overrides = {}) {
  return { recordId: RECORD.recordId, recordRevision: RECORD.revision, pageKey: IDENTITY.pageKey,
    siteKey: IDENTITY.siteKey, safeReturnUrl: RECORD.safeReturnUrl, consentGeneration: 1,
    dataGeneration: 1, sitePolicyRevision: 1, pageGeneration: 1,
    summary: { recordId: RECORD.recordId, revision: RECORD.revision, anchor: RECORD.anchor, hasCompletedAssistant: false }, ...overrides };
}
function setup({ permitted = true, currentTarget = target(), clock = 1000 } = {}) {
  let permission = permitted, created = 0, tab = null, value = currentTarget;
  const browser = { permissions: { contains: async ({ origins }) => permission && origins[0] === `${value.siteKey}/*` },
    tabs: { async create({ url }) { created++; tab = { id: 41, incognito: false, pendingUrl: url }; return tab; },
      async get() { return { id: 41, incognito: false, url: value.safeReturnUrl }; } } };
  const registry = createHandoffRegistry({ browser, now: () => clock, randomId: () => "handoff-test",
    async readTarget(context) {
      context.assertCurrent();
      if (context.handoffTarget) {
        for (const key of ["recordId", "recordRevision", "pageKey", "siteKey", "safeReturnUrl", "consentGeneration", "dataGeneration", "sitePolicyRevision", "pageGeneration"]) {
          if (context.handoffTarget[key] !== value[key]) throw Object.assign(new Error(E.STALE_OPERATION), { code: E.STALE_OPERATION });
        }
      }
      return value;
    } });
  const extension = { request: { method: M.CREATE_HANDOFF, recordId: value.recordId, expectedRevision: value.recordRevision },
    access: { scope: "extension" }, assertCurrent() {} };
  const contentAccess = { scope: "content", tabId: 41, pageKey: value.pageKey, siteKey: value.siteKey,
    documentGeneration: "doc-target", nativeDocumentId: "native-target", navigationGeneration: 1, incognito: false };
  return { registry, extension, contentAccess, created: () => created, setPermission(next) { permission = next; },
    setTarget(next) { value = next; }, advance(ms) { clock += ms; } };
}

test("handoff creates one exact target tab, binds its native document and consumes only once", async () => {
  const h = setup(), created = await h.registry.create(h.extension);
  assert.equal(created.state, "ready"); assert.equal(created.handoff.tabId, 41); assert.equal(h.created(), 1);
  h.registry.onTabUpdated(41, { status: "loading", url: RECORD.safeReturnUrl });
  assert.equal(await h.registry.bindDocument(h.contentAccess), created.handoff.handoffId);
  const summary = await h.registry.consume({ request: { method: M.CONSUME_HANDOFF, handoffId: created.handoff.handoffId },
    access: h.contentAccess, assertCurrent() {} });
  assert.equal(summary.recordId, RECORD.recordId);
  await assert.rejects(() => h.registry.consume({ request: { handoffId: created.handoff.handoffId }, access: h.contentAccess, assertCurrent() {} }),
    error => error.code === E.HANDOFF_EXPIRED);
});

test("an early Content registration waits for the real tabs.create identity instead of losing the handoff", async () => {
  const value = target(); let release, markEntered;
  const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { markEntered = resolve; });
  const browser = { permissions: { contains: async () => true }, tabs: {
    async create({ url }) { markEntered(); await gate; return { id: 41, incognito: false, pendingUrl: url }; },
    async get() { return { id: 41, incognito: false, url: value.safeReturnUrl }; }
  } };
  const registry = createHandoffRegistry({ browser, now: () => 1000, randomId: () => "handoff-race",
    readTarget: async context => { context.assertCurrent(); return value; } });
  const creating = registry.create({ request: { recordId: value.recordId, expectedRevision: value.recordRevision }, access: {}, assertCurrent() {} });
  await entered;
  const access = { tabId: 41, pageKey: value.pageKey, siteKey: value.siteKey, documentGeneration: "doc-target",
    nativeDocumentId: "native-target", navigationGeneration: 1 };
  const binding = registry.bindDocument(access); release();
  const created = await creating;
  assert.equal(await binding, created.handoff.handoffId);
});

test("permission denial and unsafe locator never create a target tab", async () => {
  const denied = setup({ permitted: false });
  assert.deepEqual(await denied.registry.create(denied.extension), { state: "permission-required" }); assert.equal(denied.created(), 0);
  const unsupported = setup({ currentTarget: target({ safeReturnUrl: null }) });
  assert.deepEqual(await unsupported.registry.create(unsupported.extension), { state: "unsupported" }); assert.equal(unsupported.created(), 0);
});

test("redirect, permission revoke, record generation change and expiry invalidate a handoff", async () => {
  const redirected = setup(), first = await redirected.registry.create(redirected.extension);
  redirected.registry.onTabUpdated(41, { url: "https://example.test/redirected" });
  assert.equal(await redirected.registry.bindDocument(redirected.contentAccess), null);
  await assert.rejects(() => redirected.registry.consume({ request: { handoffId: first.handoff.handoffId }, access: redirected.contentAccess, assertCurrent() {} }),
    error => error.code === E.HANDOFF_EXPIRED);

  const revoked = setup(), second = await revoked.registry.create(revoked.extension);
  await revoked.registry.bindDocument(revoked.contentAccess); revoked.setPermission(false);
  await assert.rejects(() => revoked.registry.consume({ request: { handoffId: second.handoff.handoffId }, access: revoked.contentAccess, assertCurrent() {} }),
    error => error.code === E.FORBIDDEN);

  const changed = setup(), third = await changed.registry.create(changed.extension);
  await changed.registry.bindDocument(changed.contentAccess); changed.setTarget(target({ dataGeneration: 2 }));
  await assert.rejects(() => changed.registry.consume({ request: { handoffId: third.handoff.handoffId }, access: changed.contentAccess, assertCurrent() {} }),
    error => error.code === E.STALE_OPERATION);

  const expired = setup(), fourth = await expired.registry.create(expired.extension);
  await expired.registry.bindDocument(expired.contentAccess); expired.advance(60000);
  await assert.rejects(() => expired.registry.consume({ request: { handoffId: fourth.handoff.handoffId }, access: expired.contentAccess, assertCurrent() {} }),
    error => error.code === E.HANDOFF_EXPIRED);
});

test("production service allows only learning-center create and the bound target Content consume", async () => {
  const value = target(), browser = nativeBrowser();
  browser.permissions = { contains: async ({ origins }) => origins[0] === `${value.siteKey}/*` };
  browser.tabs = {
    create: async ({ url }) => ({ id: 41, incognito: false, pendingUrl: url }),
    get: async () => ({ id: 41, incognito: false, url: value.safeReturnUrl })
  };
  const repository = repositoryDouble({ async readHandoffTarget(context) { context.assertCurrent(); return value; } });
  const collector = async (_browser, _sender, challenge) => ({ nonce: challenge.nonce, documentGeneration: "doc-target",
    selectionGeneration: 1, captureSafety: { selection: "safe", context: "safe", root: "light-dom" }, sourceSnapshot: null, intent: null });
  const service = createReadingService({ browser, repository, collector, now: () => 1000, randomId: () => "handoff-service" });
  const created = await service.handle({ protocolVersion: 2, method: M.CREATE_HANDOFF, recordId: value.recordId,
    expectedRevision: value.recordRevision }, extensionSender());
  assert.equal(created.ok, true); assert.equal(created.data.state, "ready");
  const sender = contentSender({ url: value.safeReturnUrl, documentId: "44444444-4444-4444-8444-444444444444",
    tab: { id: 41, incognito: false, url: value.safeReturnUrl } });
  const registered = await service.handle({ protocolVersion: 2, method: M.REGISTER_DOCUMENT, documentGeneration: "doc-target" }, sender);
  assert.equal(registered.ok, true); assert.equal(registered.data.handoffId, created.data.handoff.handoffId);
  const consumed = await service.handle({ protocolVersion: 2, method: M.CONSUME_HANDOFF, handoffId: registered.data.handoffId }, sender);
  assert.equal(consumed.ok, true); assert.equal(consumed.data.recordId, value.recordId);
  assert.equal((await service.handle({ protocolVersion: 2, method: M.CONSUME_HANDOFF, handoffId: registered.data.handoffId }, extensionSender())).error.code, E.FORBIDDEN);
  assert.equal((await service.handle({ protocolVersion: 2, method: M.CREATE_HANDOFF, recordId: value.recordId,
    expectedRevision: value.recordRevision }, sender)).error.code, E.FORBIDDEN);

  const restarted = createReadingService({ browser, repository, collector, now: () => 1000, randomId: () => "after-restart" });
  const afterRestart = await restarted.handle({ protocolVersion: 2, method: M.REGISTER_DOCUMENT, documentGeneration: "doc-target" }, sender);
  assert.equal(afterRestart.ok, true); assert.equal(afterRestart.data.handoffId, undefined);
});
