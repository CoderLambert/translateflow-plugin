import { sha256 } from "../../shared/hash.js";
import { validateResultArtifact } from "../../shared/reading/artifact.js";
import { READING_ERROR as E, READING_LEARNING_CENTER_PATH, READING_METHOD as M, READING_PROTOCOL_VERSION as V } from "../../shared/reading/constants.js";
import { validateReadingRequest } from "../../shared/reading/dto.js";
import { authorizeReadingMethod } from "../../shared/reading/lifecycle.js";
import { validateReadingResponse } from "../../shared/reading/response.js";
import { ReadingContractError, bool, fail, pageKey as validatePageKey, siteKey as validateSiteKey } from "../../shared/reading/validation.js";
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
  const assistantSessions = new Set();
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
      const path = `${READING_LEARNING_CENTER_PATH}${request.recordId ? `#record=${request.recordId}` : ""}`;
      await browser.tabs.create({ url: browser.runtime.getURL(path) });
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
  async function prepareAssistantTurn(sender, input, ground, { signal = null } = {}) {
    assertNotAborted(signal);
    const request = { method: M.GET_RECORD, recordId: input.recordId };
    const nativeAccess = await accessControl.authorize(sender, M.GET_RECORD, request);
    assertNotAborted(signal);
    if (nativeAccess.scope !== "extension" || typeof ground !== "function") fail(E.FORBIDDEN, "assistant.sender");
    const nativeCurrent = () => { assertNotAborted(signal); assertAccess(nativeAccess); };
    const target = await repositoryMethod("readAssistantTarget")({ request, access: nativeAccess,
      assertCurrent: nativeCurrent, signal });
    nativeCurrent();
    const trustedSiteKey = validateSiteKey(target?.siteKey, "assistant.siteKey");
    const trustedPageKey = validatePageKey(target?.detail?.record?.pageKey, "assistant.pageKey");
    if (target.detail.record.revision !== input.recordRevision) fail(E.REVISION_CONFLICT, "assistant.revision");
    if (target.siteExcluded) fail(E.DISABLED, "assistant.site");
    const grounded = ground(target.detail);
    const sourceSnapshot = target.detail.snapshots.find(value => value.sourceSnapshotId === grounded?.sourceSnapshotId);
    if (!sourceSnapshot) fail(E.BAD_DTO, "assistant.source");
    const access = { ...nativeAccess, pageKey: trustedPageKey, siteKey: trustedSiteKey,
      safeReturnUrl: target.detail.record.safeReturnUrl, pageTitle: target.detail.record.pageTitle,
      documentGeneration: sourceSnapshot.documentGeneration, selectionGeneration: sourceSnapshot.selectionGeneration,
      siteExcluded: false };
    const operationId = `assistant-${randomId()}`;
    const begin = { method: M.BEGIN_QUERY, operationId, purpose: "assistant", sourceSnapshot,
      pageKey: access.pageKey, safeReturnUrl: access.safeReturnUrl, pageTitle: access.pageTitle,
      itemText: sourceSnapshot.selectedText, sourceLanguage: target.detail.record.sourceLanguage,
      recordId: target.detail.record.recordId, recordRevision: target.detail.record.revision,
      captureSafety: { selection: "safe", context: "safe", root: "light-dom" } };
    const fingerprint = await sha256(JSON.stringify(["assistant", access.ownerKey, access.pageKey,
      begin.recordId, begin.recordRevision, begin.sourceLanguage, sourceSnapshot]));
    const assertPrepared = () => { assertNotAborted(signal); assertAccess(access); };
    assertPrepared();
    const prepared = await operations.prepare(access, begin, fingerprint, sourceSnapshot,
      reservation => repositoryMethod("prepareOperation")({ request: begin, access,
        assertCurrent: assertPrepared, signal, ...reservation }), assertPrepared);
    if (prepared?.state !== "ready") fail(E.DISABLED, "assistant.recording");
    await accessControl.validateCurrent(nativeAccess);
    assertPrepared();
    const session = { access, operation: operations.get(access, operationId), grounded, signal, active: true };
    assistantSessions.add(session);
    return { session, grounded, sourceSnapshot, record: target.detail.record,
      routingIdentity: { siteKey: trustedSiteKey, pageKey: trustedPageKey } };
  }
  async function commitAssistantTurn(session, draft, { signal = session?.signal || null } = {}) {
    if (!assistantSessions.has(session) || !session.active) fail(E.STALE_OPERATION, "assistant.session");
    assertNotAborted(signal);
    const { access, operation } = session, token = operation.token;
    const artifact = validateResultArtifact({ ...draft, recordId: token.recordId, operationId: token.operationId,
      sourceSnapshotId: operation.sourceSnapshot.sourceSnapshotId });
    const request = { method: M.APPEND_ASSISTANT, token, artifact };
    const assertCurrent = () => { assertNotAborted(signal); assertAccess(access); operations.assertCurrent(operation, access); };
    try {
      await accessControl.validateCurrent(access);
      assertCurrent();
      const artifactDigest = await sha256(JSON.stringify(artifact)); assertCurrent();
      const saved = await repositoryMethod("mutate")({ request, access, assertCurrent, signal,
        registeredOperation: operation, artifactDigest });
      // The repository resolves only after the IndexedDB transaction commits.
      // Do not turn that durable success into a false failure if the native page closes immediately afterwards.
      return { saved, artifact };
    } finally {
      session.active = false; assistantSessions.delete(session); operations.revoke(value => value === operation);
    }
  }
  async function cancelAssistantTurn(session) {
    if (!assistantSessions.has(session) || !session.active) return;
    session.active = false; assistantSessions.delete(session);
    const { access, operation } = session;
    try { await repositoryMethod("cancelOperation")({ request: { method: M.CANCEL_OPERATION, operationId: operation.token.operationId },
      access, registeredOperation: operation, assertCurrent: () => assertAccess(access) }); }
    finally { operations.revoke(value => value === operation); }
  }
  function invalidateAccess(tabId) { accessControl.invalidateTab(tabId); operations.revoke(entry => entry.access.tabId === tabId); exports.revoke(session => session.tabId === tabId); }
  return { handle, prepareAssistantTurn, commitAssistantTurn, cancelAssistantTurn, accessControl, operations, exports, handoffs,
    forgetTab(tabId) { accessControl.forgetTab(tabId); operations.revoke(entry => entry.access.tabId === tabId); exports.revoke(session => session.tabId === tabId); handoffs.revoke(entry => entry.tabId === tabId); },
    invalidateTab(tabId) { invalidateAccess(tabId); handoffs.revoke(entry => entry.tabId === tabId); },
    onTabUpdated(tabId, changeInfo) { handoffs.onTabUpdated(tabId, changeInfo); invalidateAccess(tabId); },
    revoke() { accessControl.invalidateAll(); for (const session of assistantSessions) session.active = false;
      assistantSessions.clear(); operations.revoke(); exports.revoke(); handoffs.revoke(); } };
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError", code: "CANCELLED" });
}
