import { READING_ERROR as E, READING_LIMITS as L } from "../../shared/reading/constants.js";
import { fail } from "../../shared/reading/validation.js";
import { validateHandoff } from "../../shared/reading/lifecycle.js";
import { classifyPage, derivePageIdentity } from "./policy.js";

// Worker-local only: restart intentionally loses all capabilities. Tokens never enter a URL.
export function createHandoffRegistry({ browser, readTarget, now = Date.now, randomId = () => crypto.randomUUID() }) {
  const entries = new Map(), earlyUpdates = new Map();
  let generation = 1;
  const pending = () => [...entries.values()].some(entry => entry.tabId === null);
  function prune() { for (const [key, entry] of entries) if (now() < entry.issuedAt || now() >= entry.expiresAt) entries.delete(key); }
  function current(entry) {
    prune();
    if (entries.get(entry.handoffId) !== entry) fail(E.HANDOFF_EXPIRED, "handoff");
  }
  async function permission(siteKey) {
    if (typeof browser?.permissions?.contains !== "function") return false;
    return await browser.permissions.contains({ origins: [`${new URL(siteKey).origin}/*`] }) === true;
  }
  function update(entry, change) {
    if (entry.documentGeneration !== null || (Object.hasOwn(change, "url") && change.url !== entry.target.safeReturnUrl) ||
        (change.status === "loading" && entry.loadingSeen)) {
      entries.delete(entry.handoffId); return;
    }
    if (change.status === "loading") entry.loadingSeen = true;
  }
  function onTabUpdated(tabId, changeInfo) {
    if (changeInfo?.status !== "loading" && !Object.hasOwn(changeInfo || {}, "url")) return;
    prune();
    for (const entry of entries.values()) if (entry.tabId === tabId) update(entry, changeInfo);
    // tabs.onUpdated may precede resolution of tabs.create. Keep bounded native events
    // during creation so an early redirect cannot be mistaken for the expected load.
    if (pending()) {
      if (!earlyUpdates.has(tabId) && earlyUpdates.size >= L.operationsGlobal) {
        revoke(entry => entry.tabId === null); return;
      }
      const updates = earlyUpdates.get(tabId) || [];
      if (updates.length >= 4) { updates.push({ url: null }); } else updates.push({ ...changeInfo });
      earlyUpdates.set(tabId, updates.slice(0, 5));
    }
  }
  function bindCurrentDocument(access) {
    prune();
    for (const entry of entries.values()) if (entry.tabId === access.tabId) {
      if (!access.nativeDocumentId || access.pageKey !== entry.target.pageKey || access.siteKey !== entry.target.siteKey ||
          (entry.documentGeneration !== null && (entry.documentGeneration !== access.documentGeneration || entry.nativeDocumentId !== access.nativeDocumentId ||
          entry.navigationGeneration !== access.navigationGeneration))) {
        entries.delete(entry.handoffId); continue;
      }
      entry.documentGeneration = access.documentGeneration; entry.nativeDocumentId = access.nativeDocumentId;
      entry.navigationGeneration = access.navigationGeneration;
      return entry.handoffId;
    }
    return null;
  }
  function waitForTab(entriesToWait) {
    return new Promise(resolve => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(finish, 250);
      for (const entry of entriesToWait) entry.tabReady.then(finish, finish);
    });
  }
  async function bindDocument(access) {
    let handoffId = bindCurrentDocument(access);
    if (handoffId) return handoffId;
    // Native Content can register before tabs.create resolves in the worker.
    // Wait only while an actual create call is pending, then bind by the real
    // tab/document identity; ordinary page registrations never poll.
    for (let attempt = 0; attempt < 4; attempt++) {
      const waiting = [...entries.values()].filter(entry => entry.tabId === null);
      if (!waiting.length) break;
      await waitForTab(waiting);
      handoffId = bindCurrentDocument(access);
      if (handoffId) return handoffId;
    }
    return null;
  }
  function revoke(predicate = () => true) {
    for (const [key, entry] of entries) if (predicate(entry)) entries.delete(key);
    if (!pending()) earlyUpdates.clear();
  }
  async function create(context) {
    const target = await readTarget(context);
    context.assertCurrent();
    if (!target.safeReturnUrl || classifyPage(target.safeReturnUrl).sensitive || typeof browser?.tabs?.create !== "function" ||
        typeof browser?.tabs?.get !== "function") return { state: "unsupported" };
    const identity = await derivePageIdentity(target.safeReturnUrl);
    if (identity.safeReturnUrl !== target.safeReturnUrl || identity.pageKey !== target.pageKey || identity.siteKey !== target.siteKey) return { state: "unsupported" };
    if (!await permission(target.siteKey)) return { state: "permission-required" };
    context.assertCurrent(); prune();
    if (entries.size >= L.operationsGlobal) fail(E.CAPACITY, "handoffs");
    const issuedAt = now(), handoffId = randomId();
    let resolveTab;
    const tabReady = new Promise(resolve => { resolveTab = resolve; });
    const entry = { handoffId, target, tabId: null, documentGeneration: null, nativeDocumentId: null, navigationGeneration: null,
      generation: generation++, issuedAt, expiresAt: issuedAt + L.handoffTtlMs, loadingSeen: false, busy: false };
    Object.assign(entry, { tabReady, resolveTab });
    entries.set(handoffId, entry);
    try {
      const tab = await browser.tabs.create({ url: target.safeReturnUrl });
      current(entry); context.assertCurrent();
      if (!Number.isInteger(tab?.id) || tab.id < 0 || tab.incognito !== false ||
          (tab.url && tab.url !== "about:blank" && tab.url !== target.safeReturnUrl) || (tab.pendingUrl && tab.pendingUrl !== target.safeReturnUrl)) fail(E.FORBIDDEN, "handoff.tab");
      entry.tabId = tab.id;
      entry.resolveTab();
      for (const change of earlyUpdates.get(tab.id) || []) update(entry, change);
      earlyUpdates.delete(tab.id); if (!pending()) earlyUpdates.clear();
      const assertCurrent = () => { context.assertCurrent(); current(entry); };
      await readTarget({ ...context, handoffTarget: target, assertCurrent });
      if (!await permission(target.siteKey)) fail(E.FORBIDDEN, "handoff.permission");
      assertCurrent();
      return { state: "ready", handoff: validateHandoff({ handoffId, recordId: target.recordId, recordRevision: target.recordRevision,
        tabId: tab.id, pageKey: target.pageKey, documentGeneration: `pending:${handoffId}`, generation: entry.generation,
        issuedAt, expiresAt: entry.expiresAt, consumed: false }) };
    } catch (error) { entry.resolveTab(); entries.delete(handoffId); if (!pending()) earlyUpdates.clear(); throw error; }
  }
  async function consume(context) {
    prune(); const entry = entries.get(context.request.handoffId), access = context.access;
    if (!entry || entry.busy) fail(E.HANDOFF_EXPIRED, "handoff");
    if (entry.tabId !== access.tabId || access.pageKey !== entry.target.pageKey || access.siteKey !== entry.target.siteKey ||
        !access.nativeDocumentId || !entry.documentGeneration || entry.documentGeneration !== access.documentGeneration ||
        entry.nativeDocumentId !== access.nativeDocumentId || entry.navigationGeneration !== access.navigationGeneration || access.incognito !== false) fail(E.FORBIDDEN, "handoff.document");
    entry.busy = true; // Reserve before the first await: concurrent requests cannot consume twice.
    const assertCurrent = () => { context.assertCurrent(); current(entry); };
    try {
      const tab = await browser.tabs.get(entry.tabId);
      if (tab?.id !== entry.tabId || tab.incognito !== false || tab.url !== entry.target.safeReturnUrl ||
          (tab.pendingUrl && tab.pendingUrl !== entry.target.safeReturnUrl) || !await permission(entry.target.siteKey)) fail(E.FORBIDDEN, "handoff.access");
      assertCurrent();
      const target = await readTarget({ ...context, handoffTarget: entry.target, assertCurrent });
      if (!await permission(entry.target.siteKey)) fail(E.FORBIDDEN, "handoff.permission");
      assertCurrent(); return target.summary;
    } finally { entries.delete(entry.handoffId); }
  }
  return { create, consume, bindDocument, onTabUpdated, revoke };
}
