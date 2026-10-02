import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { createReadingService } from "../src/background/reading-record/service.js";
import { classifyPage, derivePageIdentity } from "../src/background/reading-record/policy.js";
import { fail } from "../src/shared/reading/validation.js";
import { request } from "./fixtures/reading/contract.mjs";
import { collector, contentSender, extensionSender, nativeBrowser, repositoryDouble } from "./fixtures/reading/access.mjs";

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function senderForOwner(index) {
  return contentSender({ documentId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    tab: { id: 100 + index, incognito: false, url: contentSender().url } });
}
test("Sensitive app host matching covers actual Slack client and remains exact for lookalike hosts", async () => {
  const url = "https://app.slack.com/client/T123/C123";
  assert.equal(classifyPage(url).sensitive, true);
  for (const host of ["app.slack.com.evil.test", "app-slack.com", "notapp.slack.com"]) assert.equal(classifyPage(`https://${host}/client/T123`).sensitive, false);
  const sender = contentSender({ url, tab: { id: 7, incognito: false, url } });
  const service = createReadingService({ browser: nativeBrowser(), collector: collector(), repository: repositoryDouble() });
  for (const method of Object.values(M)) assert.equal((await service.handle(request(method), sender)).error.code, E.FORBIDDEN);
});

test("Options/Popup native exact URLs accept controlled hash for fixed open only; learning center stays exact", async () => {
  for (const page of ["options.html#general", "popup.html#reading"]) {
    const browser = nativeBrowser(), native = (await browser.runtime.getContexts())[0], url = browser.runtime.getURL(page);
    browser.runtime.getContexts = async () => [{ ...native, documentUrl: url }];
    const sender = extensionSender({ url });
    const service = createReadingService({ browser, repository: repositoryDouble(), learningCenterAvailable: true });
    assert.equal((await service.handle(request(M.OPEN_LEARNING_CENTER), sender)).ok, true);
    for (const method of Object.values(M).filter((value) => value !== M.OPEN_LEARNING_CENTER)) {
      assert.equal((await service.handle(request(method), sender)).error.code, E.FORBIDDEN);
    }
    browser.runtime.getContexts = async () => [{ ...native, documentUrl: browser.runtime.getURL(page.split("#")[0]) }];
    assert.equal((await service.handle(request(M.OPEN_LEARNING_CENTER), sender)).error.code, E.FORBIDDEN);
  }
  for (const page of ["learning-center.html#general", "learning-center.html?view=all", "learning-center.html#", "learning-center.html?", "options.html?redirect=external#general", "options.html.extra#general"]) {
    const browser = nativeBrowser(), native = (await browser.runtime.getContexts())[0], url = browser.runtime.getURL(page);
    browser.runtime.getContexts = async () => [{ ...native, documentUrl: url }];
    const service = createReadingService({ browser, learningCenterAvailable: true });
    assert.equal((await service.handle(request(M.OPEN_LEARNING_CENTER), extensionSender({ url }))).error.code, E.FORBIDDEN);
  }
});

test("BEGIN reserves owner/global capacity before delayed repository preparation", async (t) => {
  for (const scope of ["owner", "global"]) await t.test(scope, async () => {
    const limit = scope === "owner" ? 16 : 128, entered = deferred(), release = deferred(); let preparations = 0;
    const defaultPrepare = repositoryDouble().prepareOperation;
    const service = createReadingService({ browser: nativeBrowser(), collector: collector(), now: () => 1000,
      repository: repositoryDouble({ async prepareOperation(context) {
        if (++preparations === limit) entered.resolve(); await release.promise; return defaultPrepare(context);
      } }) });
    const senders = Array.from({ length: scope === "owner" ? 1 : 9 }, (_, index) => senderForOwner(index));
    for (const sender of senders) assert.equal((await service.handle(request(M.REGISTER_DOCUMENT), sender)).ok, true);
    const { pageKey } = await derivePageIdentity(contentSender().url);
    const pending = Array.from({ length: limit + 1 }, (_, index) => service.handle(request(M.BEGIN_QUERY,
      { pageKey, operationId: `pending-${index}` }), senders[scope === "owner" ? 0 : Math.floor(index / 16)]));
    await entered.promise; release.resolve(); const results = await Promise.all(pending);
    assert.equal(preparations, limit); assert.equal(service.operations.size, limit);
    assert.equal(results.filter((result) => result.ok && result.data.state === "ready").length, limit);
    assert.equal(results.filter((result) => result.error?.code === E.CAPACITY).length, 1);
  });
});

test("Identical pending BEGIN retries share preparation; fingerprint conflict rejects and registered retries preserve token/source/TTL/cancel", async () => {
  const entered = deferred(), release = deferred(), joined = deferred(); let now = 1000, calls = 0, admissions = 0;
  const contexts = [], defaultPrepare = repositoryDouble().prepareOperation;
  const service = createReadingService({ browser: nativeBrowser(), collector: collector(), now: () => now,
    repository: repositoryDouble({ async prepareOperation(context) {
      calls++; contexts.push(context); entered.resolve(); await release.promise; return defaultPrepare(context);
    } }) });
  const realPrepare = service.operations.prepare;
  service.operations.prepare = (...args) => { const result = realPrepare(...args); if (++admissions === 2) joined.resolve(); return result; }; // Observe only; delegate the real reservation algorithm.
  const sender = contentSender(); await service.handle(request(M.REGISTER_DOCUMENT), sender);
  const { pageKey } = await derivePageIdentity(sender.url), input = request(M.BEGIN_QUERY, { pageKey });
  const first = service.handle(input, sender); await entered.promise;
  const retry = service.handle(input, sender); await joined.promise;
  assert.equal((await service.handle({ ...input, sourceLanguage: "fr" }, sender)).error.code, E.STALE_OPERATION);
  assert.equal(calls, 1); assert.equal(service.operations.size, 1);
  now = 5000; release.resolve(); const [a, b] = await Promise.all([first, retry]);
  assert.equal(a.ok, true); assert.deepEqual(b, a); assert.equal(a.data.token.issuedAt, 1000); assert.equal(a.data.token.expiresAt, 601000);
  const registeredRetry = await service.handle(input, sender);
  assert.deepEqual(registeredRetry, a); assert.equal(calls, 2); assert.equal(contexts[1].issuedAt, 1000); assert.equal(contexts[1].expiresAt, 601000);
  assert.deepEqual(contexts[1].previous, a.data.token); assert.deepEqual(contexts[1].sourceSnapshot, contexts[0].sourceSnapshot);
  assert.equal((await service.handle(request(M.CANCEL_OPERATION), sender)).data.state, "cancelled");
  assert.equal((await service.handle(input, sender)).error.code, E.STALE_OPERATION);
  assert.equal((await service.handle(request(M.CANCEL_OPERATION), sender)).data.state, "cancelled");
});

test("New pending BEGIN releases capacity after disabled/error/navigation/revoke/expiry/invalid token without late registration", async (t) => {
  for (const mode of ["disabled", "error", "navigation", "revoke", "expiry", "invalid-token"]) await t.test(mode, async () => {
    const entered = deferred(), release = deferred(); let now = 1000, calls = 0;
    const defaultPrepare = repositoryDouble().prepareOperation;
    const service = createReadingService({ browser: nativeBrowser(), collector: collector(), now: () => now,
      repository: repositoryDouble({ async prepareOperation(context) {
        if (++calls === 1) {
          entered.resolve(); await release.promise; context.assertCurrent();
          if (mode === "disabled") return { state: "disabled" };
          if (mode === "error") fail(E.STORAGE, "synthetic repository error");
          if (mode === "invalid-token") { const prepared = await defaultPrepare(context); return { ...prepared, token: { ...prepared.token, operationId: "wrong-op" } }; }
        }
        return defaultPrepare(context);
      } }) });
    const sender = contentSender(); await service.handle(request(M.REGISTER_DOCUMENT), sender);
    const { pageKey } = await derivePageIdentity(sender.url);
    const pending = service.handle(request(M.BEGIN_QUERY, { pageKey }), sender); await entered.promise;
    assert.equal(service.operations.size, 1);
    if (mode === "navigation") service.invalidateTab(sender.tab.id);
    if (mode === "revoke") service.revoke();
    if (mode === "expiry") now = 601000;
    release.resolve(); const result = await pending;
    if (mode === "disabled") assert.deepEqual(result.data, { state: "disabled" });
    else assert.equal(result.error.code, mode === "error" ? E.STORAGE : mode === "invalid-token" ? E.BAD_DTO : E.STALE_OPERATION);
    assert.equal(service.operations.size, 0);
    await service.handle(request(M.REGISTER_DOCUMENT), sender);
    const valid = await service.handle(request(M.BEGIN_QUERY, { pageKey, operationId: "fresh-op" }), sender);
    assert.equal(valid.ok, true); assert.equal(valid.data.state, "ready"); assert.equal(calls, 2); assert.equal(service.operations.size, 1);
  });
});
