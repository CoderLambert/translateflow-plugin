import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { createReadingAccess, readOwnedCollector } from "../src/background/reading-record/access.js";
import { createReadingService } from "../src/background/reading-record/service.js";
import { derivePageIdentity } from "../src/background/reading-record/policy.js";
import { request, response, snapshot } from "./fixtures/reading/contract.mjs";
import { collector, contentSender, extensionSender, nativeBrowser, repositoryDouble } from "./fixtures/reading/access.mjs";
const rejects = (fn, code) => assert.rejects(fn, (error) => error.code === code);
const code = (result) => result.error?.code;
async function setup(options = {}) {
  const service = createReadingService({ browser: nativeBrowser(), repository: repositoryDouble(), collector: collector(), now: () => 1000, ...options });
  const registered = await service.handle(request(M.REGISTER_DOCUMENT), contentSender());
  assert.equal(registered.ok, true);
  const access = await derivePageIdentity(contentSender().url);
  return { service, access };
}

test("Native extension authority handles optional tab, exact document/context and Chrome102 failclosed", async () => {
  const access = createReadingAccess({ browser: nativeBrowser() });
  assert.equal((await access.authorize(extensionSender(), M.LIST_RECORDS)).scope, "extension");
  const context = await nativeBrowser().runtime.getContexts();
  for (const override of [{ incognito: true }, { incognito: undefined }, { documentId: "other" }, { contextType: "BACKGROUND" }, { documentUrl: "https://example.test/learning-center.html" }]) {
    const browser = nativeBrowser(); browser.runtime.getContexts = async () => [{ ...context[0], ...override }];
    await rejects(() => createReadingAccess({ browser }).authorize(extensionSender(), M.LIST_RECORDS), E.FORBIDDEN);
  }
  for (const contexts of [[], [context[0], context[0]]]) {
    const browser = nativeBrowser(); browser.runtime.getContexts = async () => contexts;
    await rejects(() => createReadingAccess({ browser }).authorize(extensionSender(), M.LIST_RECORDS), E.FORBIDDEN);
  }
  await rejects(() => access.authorize(extensionSender({ tab: { id: 10, incognito: false } }), M.LIST_RECORDS), E.FORBIDDEN);
  await rejects(() => access.authorize(extensionSender({ id: "other" }), M.LIST_RECORDS), E.FORBIDDEN);
  await rejects(() => access.authorize(extensionSender({ url: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/unknown.html" }), M.LIST_RECORDS), E.FORBIDDEN);
  const old = nativeBrowser(); delete old.runtime.getContexts;
  await rejects(() => createReadingAccess({ browser: old }).authorize(extensionSender(), M.LIST_RECORDS), E.CAPABILITY_LIMITED);
});
test("No repository/genuine collector does not fabricate consent, save, empty list or export", async () => {
  const service = createReadingService({ browser: nativeBrowser(), collector: collector() });
  assert.equal(code(await service.handle(request(M.LIST_RECORDS), extensionSender())), E.NOT_READY);
  assert.equal(code(await service.handle(request(M.EXPORT_START), extensionSender())), E.NOT_READY);
  assert.equal(code(await service.handle(request(M.OPEN_LEARNING_CENTER), extensionSender())), E.NOT_READY);
  const access = createReadingAccess({ browser: nativeBrowser() });
  await rejects(() => access.authorize(contentSender(), M.REGISTER_DOCUMENT, request(M.REGISTER_DOCUMENT)), E.CAPABILITY_LIMITED);
  const browser = nativeBrowser(); browser.scripting = { executeScript: async () => [{ frameId: 0, documentId: contentSender().documentId, result: null }] };
  await rejects(() => readOwnedCollector(browser, contentSender(), { nonce: "x" }), E.NOT_READY);
});
test("Actual page identity retains article query/hash and conservative unsafe return fallback", async () => {
  const a = await derivePageIdentity("https://example.test/article?id=1#one"), b = await derivePageIdentity("https://example.test/article?id=2#one");
  assert.notEqual(a.pageKey, b.pageKey); assert.notEqual(a.pageKey, (await derivePageIdentity("https://example.test/article?id=1#two")).pageKey);
  assert.equal((await derivePageIdentity("https://example.test/article?id=1&page=2")).pageKey, (await derivePageIdentity("https://example.test/article?page=2&id=1")).pageKey);
  for (const url of ["https://u:p@example.test/article", "https://example.test/article?token=secret", "https://example.test/article?unknown=maybe-secret", "https://example.test/article#token=secret"]) assert.equal((await derivePageIdentity(url)).safeReturnUrl, null);
  assert.equal(a.safeReturnUrl, "https://example.test/article?id=1#one");
});
test("Page-scoped explicit detail denies cross-page stored records and caller safety cannot bypass collector", async () => {
  const { service } = await setup({ repository: repositoryDouble({ read: async () => response(M.GET_RECORD).data }) });
  assert.equal(code(await service.handle(request(M.GET_RECORD), contentSender())), E.FORBIDDEN);
  const { service: safe, access } = await setup();
  const begin = await safe.handle(request(M.BEGIN_QUERY, { pageKey: access.pageKey }), contentSender()); assert.equal(begin.ok, true);
  assert.equal(code(await safe.handle(request(M.BEGIN_QUERY), contentSender())), E.FORBIDDEN);
  for (const captureSafety of [{ selection: "sensitive", context: "safe", root: "light-dom" }, { selection: "safe", context: "unknown", root: "light-dom" }, { selection: "safe", context: "safe", root: "unsupported" }]) {
    const bad = createReadingService({ browser: nativeBrowser(), repository: repositoryDouble(), collector: collector({ captureSafety }) });
    assert.equal(code(await bad.handle(request(M.REGISTER_DOCUMENT), contentSender())), E.FORBIDDEN);
  }
});
test("Private and unknown sender deny every history route and fixed open never accepts arbitrary URL", async () => {
  const service = createReadingService({ browser: nativeBrowser(), repository: repositoryDouble(), collector: collector(), learningCenterAvailable: true });
  for (const method of Object.values(M)) assert.equal(code(await service.handle(request(method), contentSender({ tab: { id: 7, incognito: true } }))), E.FORBIDDEN);
  const browser = nativeBrowser(); const native = (await browser.runtime.getContexts())[0]; browser.runtime.getContexts = async () => [{ ...native, incognito: true }];
  const privateService = createReadingService({ browser, repository: repositoryDouble() });
  for (const method of Object.values(M)) assert.equal(code(await privateService.handle(request(method), extensionSender())), E.FORBIDDEN);
  for (const override of [{ tab: { id: 7 } }, { frameId: 1 }, { documentLifecycle: "cached" }, { url: "https://mail.example.test/" }, { id: "unknown" }]) assert.equal(code(await service.handle(request(M.GET_RECORD), contentSender(override))), E.FORBIDDEN);
  assert.equal(code(await service.handle(request(M.OPEN_LEARNING_CENTER, { url: "https://evil.test" }), extensionSender())), E.BAD_DTO);
  const entry = nativeBrowser(); entry.runtime.getContexts = async () => [{ ...native, documentUrl: entry.runtime.getURL("options.html") }];
  const options = createReadingService({ browser: entry, repository: repositoryDouble(), learningCenterAvailable: true });
  assert.equal((await options.handle(request(M.OPEN_LEARNING_CENTER), extensionSender({ url: entry.runtime.getURL("options.html") }))).ok, true);
  assert.equal(code(await options.handle(request(M.LIST_RECORDS), extensionSender({ url: entry.runtime.getURL("options.html") }))), E.FORBIDDEN);
});
test("Navigation, worker restart, missing trusted intent and source mismatch defeat in-flight access", async () => {
  const { service, access } = await setup();
  assert.equal((await service.handle(request(M.BEGIN_QUERY, { pageKey: access.pageKey }), contentSender())).ok, true);
  service.invalidateTab(7);
  assert.equal(code(await service.handle(request(M.GET_RECORD), contentSender())), E.STALE_OPERATION);
  const fresh = createReadingService({ browser: nativeBrowser(), repository: repositoryDouble(), collector: collector() });
  assert.equal(code(await fresh.handle(request(M.GET_RECORD), contentSender())), E.STALE_OPERATION);
  const control = createReadingAccess({ browser: nativeBrowser(), collector: collector({ intent: null }) });
  await control.authorize(contentSender(), M.REGISTER_DOCUMENT, request(M.REGISTER_DOCUMENT));
  await rejects(() => control.authorize(contentSender(), M.GET_RECORD, request(M.GET_RECORD)), E.BAD_DTO);
  const mismatch = await service.handle(request(M.BEGIN_QUERY, { pageKey: access.pageKey, sourceSnapshot: snapshot({ capturedAt: 1001 }) }), contentSender());
  assert.equal(code(mismatch), E.STALE_OPERATION);
});

test("Observed Chromium opaque 128bit-hex documentId retains exact native equality without normalization", async () => {
  const documentId = "F3CB5565B7C51621AB7D7A66791E0E33", browser = nativeBrowser();
  const context = (await browser.runtime.getContexts())[0];
  browser.runtime.getContexts = async ({ documentIds }) => documentIds[0] === documentId ? [{ ...context, documentId }] : [];
  const control = createReadingAccess({ browser, collector: collector() });
  assert.equal((await control.authorize(extensionSender({ documentId }), M.LIST_RECORDS)).nativeDocumentId, documentId);
  assert.equal((await control.authorize(contentSender({ documentId }), M.REGISTER_DOCUMENT, request(M.REGISTER_DOCUMENT))).nativeDocumentId, documentId);
  await rejects(() => control.authorize(extensionSender({ documentId: documentId.toLowerCase() }), M.LIST_RECORDS), E.FORBIDDEN);
});
