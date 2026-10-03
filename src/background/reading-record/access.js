import { READING_ERROR as E, READING_LEARNING_CENTER_PATH, READING_METHOD as M } from "../../shared/reading/constants.js";
import { validateCaptureSafety } from "../../shared/reading/dto.js";
import { validateSourceSnapshot } from "../../shared/reading/source.js";
import { id, integer, nullable, object, fail, recordId } from "../../shared/reading/validation.js";
import { classifyPage, derivePageIdentity, requireCaptureSafety } from "./policy.js";

const ENTRY_PATHS = new Set(["/popup.html", "/options.html"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const nativeDocumentId = (value) => typeof value === "string" && (UUID.test(value) || /^[0-9a-f]{32}$/iu.test(value));
const ACTIONS = new Map([[M.BEGIN_QUERY, "begin"], [M.SAVE_QUERY_RESULT, "save"], [M.APPEND_ASSISTANT, "save"],
  [M.GET_RECORD, "detail"], [M.CANCEL_OPERATION, "cancel"]]);

export async function readOwnedCollector(browser, sender, challenge) {
  if (typeof browser?.scripting?.executeScript !== "function") fail(E.CAPABILITY_LIMITED, "collector");
  const target = sender.documentId ? { tabId: sender.tab.id, documentIds: [sender.documentId] } : { tabId: sender.tab.id, frameIds: [0] };
  let results;
  try {
    results = await browser.scripting.executeScript({ target, world: "ISOLATED", args: [JSON.stringify(challenge)],
      func: async (input) => {
        const collector = globalThis.__TRANSLATE_FLOW_CONTENT__?.modules?.readingAccessCollector;
        if (!collector || typeof collector.read !== "function") return null;
        return collector.read(JSON.parse(input));
      } });
  } catch { fail(E.FORBIDDEN, "collector"); }
  if (!Array.isArray(results) || results.length !== 1 || results[0].frameId !== 0 ||
      (sender.documentId && results[0].documentId !== sender.documentId)) fail(E.FORBIDDEN, "collector.document");
  if (results[0].result === null) fail(E.NOT_READY, "collector");
  return results[0].result;
}
function validateProof(value, nonce, action, requestedRecordId, operationId) {
  object(value, ["nonce", "documentGeneration", "selectionGeneration", "captureSafety", "sourceSnapshot", "intent"], "proof");
  if (value.nonce !== nonce) fail(E.FORBIDDEN, "proof.nonce");
  const proof = { documentGeneration: id(value.documentGeneration, "proof.documentGeneration"),
    selectionGeneration: integer(value.selectionGeneration, 1, Number.MAX_SAFE_INTEGER, "proof.selectionGeneration"),
    captureSafety: validateCaptureSafety(value.captureSafety, "proof.captureSafety"),
    sourceSnapshot: nullable(value.sourceSnapshot, validateSourceSnapshot, "proof.sourceSnapshot") };
  if (proof.sourceSnapshot && (proof.sourceSnapshot.documentGeneration !== proof.documentGeneration ||
      proof.sourceSnapshot.selectionGeneration !== proof.selectionGeneration)) fail(E.FORBIDDEN, "proof.sourceSnapshot");
  if (action !== "inspect" && action !== "register") {
    object(value.intent, ["action", "recordId", "operationId"], "proof.intent");
    if (value.intent.action !== action || value.intent.recordId !== (requestedRecordId ?? null) || value.intent.operationId !== (operationId ?? null)) fail(E.FORBIDDEN, "proof.intent");
  } else if (value.intent !== null) fail(E.BAD_DTO, "proof.intent");
  requireCaptureSafety(proof);
  return proof;
}
export function createReadingAccess({ browser, collector = readOwnedCollector, randomId = () => crypto.randomUUID() } = {}) {
  const sessions = new Map(), navigation = new Map();
  let authorityGeneration = 1;
  const epoch = (tabId) => navigation.get(tabId) || 1;
  function track(tabId) {
    if (!navigation.has(tabId)) {
      if (navigation.size >= 128) fail(E.CAPACITY, "navigation.sessions");
      navigation.set(tabId, 1);
    }
    return epoch(tabId);
  }
  function invalidateTab(tabId) {
    if (navigation.has(tabId)) navigation.set(tabId, epoch(tabId) + 1);
    for (const [key, session] of sessions) if (session.tabId === tabId) sessions.delete(key);
  }
  async function native(sender) {
    if (!browser?.runtime?.id || sender?.id !== browser.runtime.id) fail(E.FORBIDDEN, "sender.id");
    let url;
    try { url = new URL(sender.url); } catch { fail(E.FORBIDDEN, "sender.url"); }
    if (url.protocol === "chrome-extension:" && url.hostname === browser.runtime.id) {
      const learningCenter = url.pathname === `/${READING_LEARNING_CENTER_PATH}`;
      if (learningCenter && sender.url.includes("#") && !url.hash) fail(E.FORBIDDEN, "sender.hash");
      if (learningCenter && url.hash) {
        if (!url.hash.startsWith("#record=")) fail(E.FORBIDDEN, "sender.hash");
        recordId(url.hash.slice(8), "sender.hash");
      }
      if (url.search || (learningCenter ? sender.url.split("#")[0] !== browser.runtime.getURL(READING_LEARNING_CENTER_PATH) : !ENTRY_PATHS.has(url.pathname))) fail(E.FORBIDDEN, "sender.path");
      if (!nativeDocumentId(sender.documentId) || typeof browser.runtime.getContexts !== "function") fail(E.CAPABILITY_LIMITED, "sender.context");
      let contexts;
      try { contexts = await browser.runtime.getContexts({ documentIds: [sender.documentId] }); } catch { fail(E.CAPABILITY_LIMITED, "sender.context"); }
      if (!Array.isArray(contexts) || contexts.length !== 1) fail(E.FORBIDDEN, "sender.context");
      const context = contexts[0];
      // Chromium sender.url can retain the original URL after same-document hash navigation,
      // while getContexts returns the current URL. Both must still be this fixed native page.
      if (learningCenter) {
        let current;
        try { current = new URL(context.documentUrl); } catch { fail(E.FORBIDDEN, "context.url"); }
        if (current.search || context.documentUrl.split("#")[0] !== browser.runtime.getURL(READING_LEARNING_CENTER_PATH)) fail(E.FORBIDDEN, "context.url");
        if (context.documentUrl.includes("#") && !current.hash) fail(E.FORBIDDEN, "context.hash");
        if (current.hash) {
          if (!current.hash.startsWith("#record=")) fail(E.FORBIDDEN, "context.hash");
          recordId(current.hash.slice(8), "context.hash");
        }
      }
      const samePage = learningCenter ? context.documentUrl.split("#")[0] === sender.url.split("#")[0] : context.documentUrl === sender.url;
      if (!UUID.test(context.contextId || "") || context.documentId !== sender.documentId || !samePage || context.incognito !== false ||
          !["TAB", "POPUP"].includes(context.contextType) || (learningCenter && context.contextType !== "TAB") ||
          (sender.tab && (sender.tab.id !== context.tabId || sender.tab.incognito !== false)) ||
          (sender.frameId !== undefined && sender.frameId !== 0)) fail(E.FORBIDDEN, "sender.context");
      return { scope: learningCenter ? "extension" : "entry", ownerKey: `extension:${context.contextId}:${context.documentId}`,
        documentGeneration: context.documentId, nativeDocumentId: context.documentId, nativeUrl: context.documentUrl, authorityGeneration, senderVerified: true, allowlisted: learningCenter, incognito: false,
        sensitive: false, editable: false, accountPage: false, navigationGeneration: Number.isInteger(context.tabId) && context.tabId >= 0 ? track(context.tabId) : 1, tabId: context.tabId };
    }
    if (!/^https?:$/u.test(url.protocol) || !Number.isInteger(sender.tab?.id) || sender.tab.id < 0 || sender.tab.incognito !== false ||
        sender.frameId !== 0 || (sender.documentId !== undefined && !nativeDocumentId(sender.documentId)) ||
        (sender.documentLifecycle !== undefined && sender.documentLifecycle !== "active") ||
        (sender.tab.url && sender.tab.url !== sender.url)) fail(E.FORBIDDEN, "sender.content");
    const policy = classifyPage(sender.url);
    if (policy.sensitive) fail(E.FORBIDDEN, "sender.policy");
    const navigationGeneration = track(sender.tab.id);
    const currentAuthority = authorityGeneration;
    const identity = await derivePageIdentity(sender.url);
    return { scope: "content", senderVerified: true, incognito: false, sensitive: false, accountPage: false, editable: false,
      ...identity, pageTitle: typeof sender.tab.title === "string" ? sender.tab.title.slice(0, 300) : "", tabId: sender.tab.id, nativeDocumentId: sender.documentId || null,
      navigationGeneration, authorityGeneration: currentAuthority, ownerKey: `content:${sender.tab.id}:${sender.documentId || "frame0"}` };
  }
  async function authorize(sender, method, request) {
    const access = await native(sender);
    if (access.scope !== "content") return access;
    // Fixed page opening grants no record access and needs no collector session.
    // Keep the native tab/navigation guard even when a query already has a session.
    if (method === M.OPEN_LEARNING_CENTER) return { ...access, nativeEntryOnly: true };
    const generation = access.navigationGeneration;
    const action = method === M.REGISTER_DOCUMENT ? "register" : ACTIONS.get(method) || "inspect";
    const nonce = randomId();
    const operationId = request?.operationId ?? request?.token?.operationId ?? null;
    const targetRecordId = request?.recordId ?? request?.token?.recordId ?? null;
    const proof = validateProof(await collector(browser, sender, { nonce, action, recordId: targetRecordId, operationId }), nonce, action, targetRecordId, operationId);
    if (epoch(access.tabId) !== generation || access.authorityGeneration !== authorityGeneration) fail(E.STALE_OPERATION, "document.navigation");
    const previous = sessions.get(access.ownerKey);
    if (method === M.REGISTER_DOCUMENT) {
      if (proof.documentGeneration !== request.documentGeneration) fail(E.FORBIDDEN, "document.generation");
      if (!previous && sessions.size >= 128) fail(E.CAPACITY, "document.sessions");
      const session = { ...access, documentGeneration: proof.documentGeneration };
      sessions.set(access.ownerKey, session);
    } else if (!previous || previous.documentGeneration !== proof.documentGeneration || previous.pageKey !== access.pageKey ||
        previous.navigationGeneration !== generation) fail(E.STALE_OPERATION, "document.session");
    return { ...access, documentGeneration: proof.documentGeneration, selectionGeneration: proof.selectionGeneration, proof };
  }
  function isCurrent(access) { return access.authorityGeneration === authorityGeneration && (access.tabId < 0 || (navigation.has(access.tabId) && epoch(access.tabId) === access.navigationGeneration)) && (access.scope !== "content" || access.nativeEntryOnly === true || sessions.get(access.ownerKey)?.documentGeneration === access.documentGeneration); }
  return { authorize, invalidateTab, forgetTab(tabId) { invalidateTab(tabId); navigation.delete(tabId); },
    invalidateAll() { authorityGeneration++; sessions.clear(); navigation.clear(); },
    async validateCurrent(access) {
      if (!isCurrent(access)) fail(E.STALE_OPERATION, "access.current");
      if (access.scope !== "content") {
        const contexts = await browser.runtime.getContexts({ documentIds: [access.nativeDocumentId] });
        if (!Array.isArray(contexts) || contexts.length !== 1 || contexts[0].incognito !== false || contexts[0].documentUrl !== access.nativeUrl ||
            `extension:${contexts[0].contextId}:${contexts[0].documentId}` !== access.ownerKey || !isCurrent(access)) fail(E.FORBIDDEN, "access.context");
      }
    },
    isCurrent };
}
