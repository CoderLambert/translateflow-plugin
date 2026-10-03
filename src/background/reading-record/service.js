import { sha256 } from "../../shared/hash.js";
import { READING_ERROR as E, READING_LEARNING_CENTER_PATH, READING_METHOD as M, READING_PROTOCOL_VERSION as V } from "../../shared/reading/constants.js";
import { validateReadingRequest } from "../../shared/reading/dto.js";
import { authorizeReadingMethod } from "../../shared/reading/lifecycle.js";
import { validateReadingResponse } from "../../shared/reading/response.js";
import { ReadingContractError, bool, fail } from "../../shared/reading/validation.js";
import { createReadingAccess } from "./access.js";
import { createOperationRegistry } from "./operations.js";
import { createExportRegistry } from "./exports.js";
import { createHandoffRegistry } from "./handoffs.js";
import { getReadingMemorySite, setReadingMemorySite } from "../auto-sites.js";

const READS = new Set([M.GET_PAGE_SUMMARY, M.GET_RECORD, M.LIST_RECORDS, M.LIST_PAGES, M.GET_RECORDING_STATE,
  M.GET_SITE_RECORDING, M.LIST_RECORDING_EXCLUSIONS]);
const WRITES = new Set([M.SAVE_QUERY_RESULT, M.APPEND_ASSISTANT]);
const MANAGE = new Set([M.SET_RECORDING, M.SET_SITE_RECORDING, M.DELETE_RECORD, M.DELETE_PAGE, M.CLEAR_RECORDS]);

// repository is an injected #233 owner. No default data, consent store, empty list or success receipt.
export function createReadingService({ browser, repository = null, collector, now = Date.now, randomId = () => crypto.randomUUID(), learningCenterAvailable = false,
  siteMarkers = { get: getReadingMemorySite, set: setReadingMemorySite } } = {}) {
  const accessControl = createReadingAccess({ browser, collector, randomId });
  const operations = createOperationRegistry({ now });
  const exports = createExportRegistry({ repository, now, randomId });
  function repositoryMethod(name) {
    if (typeof repository?.[name] !== "function") fail(E.NOT_READY, "repository");
    return repository[name].bind(repository);
  }
  const handoffs = createHandoffRegistry({ browser, now, randomId, readTarget: context => repositoryMethod("readHandoffTarget")(context) });
  const assertAccess = (access) => { if (!accessControl.isCurrent(access)) fail(E.STALE_OPERATION, "access.current"); };
  async function dispatch(request, access) {
    const method = request.method;
    if (method === M.OPEN_LEARNING_CENTER) {
      if (!learningCenterAvailable || typeof browser?.tabs?.create !== "function") fail(E.NOT_READY, "learning-center");
      await browser.tabs.create({ url: browser.runtime.getURL(READING_LEARNING_CENTER_PATH) });
      return { opened: true };
    }
    if (method === M.REGISTER_DOCUMENT) {
      const handoffId = await handoffs.bindDocument(access);
      return { documentGeneration: access.documentGeneration, navigationGeneration: access.navigationGeneration,
        pageKey: access.pageKey, siteKey: access.siteKey, ...(handoffId ? { handoffId } : {}) };
    }
    const context = { request, access, assertCurrent: () => assertAccess(access) };
    if ([M.GET_SITE_MARKERS, M.SET_SITE_MARKERS].includes(method)) {
      if (access.scope === "content" && request.siteKey !== undefined) fail(E.FORBIDDEN, "siteKey");
      if (access.scope === "extension" && request.siteKey === undefined) fail(E.BAD_DTO, "siteKey");
      const origin = access.scope === "content" ? access.siteKey : request.siteKey;
      if (method === M.GET_SITE_MARKERS) return siteMarkers.get(origin);
      await accessControl.validateCurrent(access);
      const result = await siteMarkers.set(origin, request.enabled);
      if (!request.enabled) handoffs.revoke(entry => entry.target.siteKey === origin);
      return result;
    }
    if (method === M.CREATE_HANDOFF) return handoffs.create(context);
    if (method === M.CONSUME_HANDOFF) return handoffs.consume(context);
    if (READS.has(method)) {
      if (method === M.GET_SITE_RECORDING && access.scope === "content" && request.siteKey !== undefined) fail(E.FORBIDDEN, "siteKey");
      if (method === M.GET_SITE_RECORDING && access.scope === "extension" && request.siteKey === undefined) fail(E.BAD_DTO, "siteKey");
      // Repository rechecks meta/access and stored page atomically; caller recordId is never ownership.
      const result = await repositoryMethod("read")(context);
      if (method === M.GET_RECORD && (result?.record?.recordId !== request.recordId ||
          (access.scope === "content" && result.record.pageKey !== access.pageKey))) fail(E.FORBIDDEN, "record.page");
      if (method === M.GET_PAGE_SUMMARY && access.scope !== "content") fail(E.FORBIDDEN, "summary.scope");
      return result;
    }
    if (method === M.BEGIN_QUERY) {
      request = { ...request, safeReturnUrl: access.safeReturnUrl, pageTitle: access.pageTitle };
      context.request = request;
      if (request.pageKey !== access.pageKey || !access.proof.sourceSnapshot ||
          JSON.stringify(request.sourceSnapshot) !== JSON.stringify(access.proof.sourceSnapshot) ||
          JSON.stringify(request.captureSafety) !== JSON.stringify(access.proof.captureSafety)) fail(E.FORBIDDEN, "operation.source");
      const sourceSnapshot = access.proof.sourceSnapshot;
      const fingerprint = await sha256(JSON.stringify([request.purpose, access.ownerKey, access.pageKey, request.recordId, request.recordRevision, request.sourceLanguage, sourceSnapshot]));
      assertAccess(access);
      // #233 still checks live policy on registered retries; the registry reserves/coalesces before its await.
      return operations.prepare(access, request, fingerprint, sourceSnapshot,
        (reservation) => repositoryMethod("prepareOperation")({ ...context, ...reservation }), () => assertAccess(access));
    }
    if (WRITES.has(method)) {
      const registeredOperation = operations.get(access, request.token.operationId);
      if (!access.proof.sourceSnapshot || JSON.stringify(access.proof.sourceSnapshot) !== JSON.stringify(registeredOperation.sourceSnapshot) ||
          JSON.stringify(request.token) !== JSON.stringify(registeredOperation.token) || request.artifact.sourceSnapshotId !== registeredOperation.sourceSnapshot.sourceSnapshotId) fail(E.STALE_OPERATION, "operation.token");
      const artifactDigest = await sha256(JSON.stringify(request.artifact));
      const assertCurrent = () => { assertAccess(access); operations.assertCurrent(registeredOperation, access); };
      assertCurrent();
      return repositoryMethod("mutate")({ ...context, assertCurrent, registeredOperation, artifactDigest });
    }
    if (method === M.CANCEL_OPERATION) {
      const registeredOperation = operations.getForCancellation(access, request.operationId);
      const result = await repositoryMethod("cancelOperation")({ ...context, registeredOperation });
      operations.revoke((entry) => entry === registeredOperation);
      return result;
    }
    if (MANAGE.has(method)) {
      const result = await repositoryMethod("mutate")(context);
      if (method === M.DELETE_RECORD) operations.revoke((entry) => (entry.token?.recordId ?? entry.request?.recordId) === request.recordId);
      else if (method === M.DELETE_PAGE) operations.revoke((entry) => entry.access.pageKey === request.pageKey);
      else if (method === M.SET_SITE_RECORDING) operations.revoke((entry) => entry.access.siteKey === request.siteKey);
      else operations.revoke();
      exports.revoke();
      if (method === M.DELETE_RECORD) handoffs.revoke(entry => entry.target.recordId === request.recordId);
      else if (method === M.DELETE_PAGE) handoffs.revoke(entry => entry.target.pageKey === request.pageKey);
      else if (method === M.SET_SITE_RECORDING) handoffs.revoke(entry => entry.target.siteKey === request.siteKey);
      else handoffs.revoke();
      return result;
    }
    if (method === M.EXPORT_START) return exports.start(context);
    if (method === M.EXPORT_NEXT) return exports.next(context);
    if (method === M.EXPORT_FINISH) return exports.finish(context);
    if (method === M.EXPORT_CANCEL) return exports.cancel(context);
    fail(E.NOT_READY, "reading.method");
  }
  async function handle(message, sender) {
    try {
      const request = validateReadingRequest(message);
      let access = await accessControl.authorize(sender, request.method, request);
      if (access.scope === "content" && ![M.REGISTER_DOCUMENT, M.OPEN_LEARNING_CENTER].includes(request.method)) {
        const policy = await repositoryMethod("readPolicy")({ access, request, assertCurrent: () => assertAccess(access) });
        assertAccess(access);
        access = { ...access, siteExcluded: bool(policy?.siteExcluded, "policy.siteExcluded") };
        if (request.method === M.GET_PAGE_SUMMARY && access.siteExcluded) fail(E.DISABLED, "policy.site");
      }
      const resourcePageKey = access.scope === "content" && [M.BEGIN_QUERY, M.SAVE_QUERY_RESULT, M.APPEND_ASSISTANT, M.GET_RECORD, M.CONSUME_HANDOFF].includes(request.method) ? access.pageKey : null;
      if (access.scope !== "content" && [M.BEGIN_QUERY, M.SAVE_QUERY_RESULT, M.APPEND_ASSISTANT, M.GET_PAGE_SUMMARY, M.CANCEL_OPERATION, M.REGISTER_DOCUMENT, M.CONSUME_HANDOFF].includes(request.method)) fail(E.FORBIDDEN, "scope.content-only");
      authorizeReadingMethod(request.method, access, resourcePageKey);
      const data = await dispatch(request, access);
      // Opening a tab closes the browser-action Popup as part of the successful
      // operation. The sender was verified before dispatch; requiring it to
      // remain alive afterwards would turn a committed open into a false error.
      if (request.method !== M.OPEN_LEARNING_CENTER) await accessControl.validateCurrent(access);
      return validateReadingResponse(request.method, { protocolVersion: V, ok: true, data }, access.scope, request.limit);
    } catch (error) {
      // No raw URL/content/stack/error.message is sent or logged.
      return { protocolVersion: V, ok: false, error: { code: error instanceof ReadingContractError ? error.code : E.STORAGE } };
    }
  }
  function invalidateAccess(tabId) { accessControl.invalidateTab(tabId); operations.revoke(entry => entry.access.tabId === tabId); exports.revoke(session => session.tabId === tabId); }
  return { handle, accessControl, operations, exports, handoffs,
    forgetTab(tabId) { accessControl.forgetTab(tabId); operations.revoke(entry => entry.access.tabId === tabId); exports.revoke(session => session.tabId === tabId); handoffs.revoke(entry => entry.tabId === tabId); },
    invalidateTab(tabId) { invalidateAccess(tabId); handoffs.revoke(entry => entry.tabId === tabId); },
    onTabUpdated(tabId, changeInfo) { handoffs.onTabUpdated(tabId, changeInfo); invalidateAccess(tabId); },
    revoke() { accessControl.invalidateAll(); operations.revoke(); exports.revoke(); handoffs.revoke(); } };
}
