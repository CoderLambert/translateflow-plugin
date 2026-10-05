import { READING_ERROR as E } from "../../shared/reading/constants.js";
import { fail } from "../../shared/reading/validation.js";

const UNCLAIMED_MS = 15_000;
const BOUND_MS = 5 * 60_000;
const CLAIMS_PER_SESSION = 8;
const SESSIONS_GLOBAL = 128;

function ownerAccess(access) {
  return { scope: "content", senderVerified: true, incognito: false, sensitive: false, editable: false, accountPage: false,
    siteExcluded: false, tabId: access.tabId, ownerKey: access.ownerKey, authorityGeneration: access.authorityGeneration,
    navigationGeneration: access.navigationGeneration, documentGeneration: access.documentGeneration,
    nativeDocumentId: access.nativeDocumentId, pageKey: access.pageKey, siteKey: access.siteKey };
}

export function createReadingPreviewRegistry({ now = Date.now, randomId = () => crypto.randomUUID() } = {}) {
  const sessions = new Map(), owners = new Map();

  function remove(previewId) {
    const entry = sessions.get(previewId);
    if (!entry) return false;
    sessions.delete(previewId);
    if (owners.get(entry.ownerKey) === previewId) owners.delete(entry.ownerKey);
    return true;
  }
  function prune() {
    for (const [previewId, entry] of sessions) if (now() >= entry.expiresAt) remove(previewId);
  }
  function get(previewId) {
    prune();
    return sessions.get(previewId) || null;
  }
  function create({ access, target }) {
    prune();
    if (access?.scope !== "content" || access.incognito !== false || !access.documentGeneration || !access.nativeDocumentId || !access.ownerKey ||
        !target || target.siteKey !== access.siteKey || target.pageKey !== access.pageKey || !target.recordId ||
        !Number.isSafeInteger(target.revision) || !Number.isSafeInteger(target.dataGeneration) ||
        !Number.isSafeInteger(target.consentGeneration) || !Number.isSafeInteger(target.pageGeneration) ||
        !Number.isSafeInteger(target.pageRevision) || !Number.isSafeInteger(target.sitePolicyRevision)) fail(E.FORBIDDEN, "preview.owner");
    const existing = owners.get(access.ownerKey);
    if (existing) remove(existing);
    if (sessions.size >= SESSIONS_GLOBAL) fail(E.CAPACITY, "preview.sessions");
    const previewId = randomId();
    if (!previewId || sessions.has(previewId)) fail(E.CAPACITY, "preview.id");
    const entry = { previewId, ownerKey: access.ownerKey, ownerAccess: ownerAccess(access), tabId: access.tabId,
      nativeDocumentId: access.nativeDocumentId, documentGeneration: access.documentGeneration,
      navigationGeneration: access.navigationGeneration, authorityGeneration: access.authorityGeneration,
      pageKey: target.pageKey, siteKey: target.siteKey, recordId: target.recordId, recordRevision: target.revision,
      dataGeneration: target.dataGeneration, consentGeneration: target.consentGeneration,
      pageGeneration: target.pageGeneration, pageRevision: target.pageRevision, sitePolicyRevision: target.sitePolicyRevision,
      expiresAt: now() + UNCLAIMED_MS, bound: null, claims: new Map() };
    sessions.set(previewId, entry); owners.set(entry.ownerKey, previewId);
    return { previewId, expiresAt: entry.expiresAt };
  }
  function claim(previewId, frame) {
    const entry = get(previewId);
    if (!entry || entry.bound || frame?.tabId !== entry.tabId || !expectedUrl(frame.documentUrl, previewId) ||
        !Number.isInteger(frame.frameId) || frame.frameId <= 0 || !frame.documentId) fail(E.FORBIDDEN, "preview.claim");
    if (entry.claims.size >= CLAIMS_PER_SESSION) fail(E.CAPACITY, "preview.claims");
    const claimId = randomId();
    if (!claimId || entry.claims.has(claimId)) fail(E.CAPACITY, "preview.claim-id");
    entry.claims.set(claimId, { ...frame, claimId });
    return { claimId };
  }
  function getClaim(previewId, claimId) {
    const entry = get(previewId);
    return entry && !entry.bound ? entry.claims.get(claimId) || null : null;
  }
  function bind(access, previewId, claimId) {
    const entry = get(previewId), claim = entry?.claims.get(claimId);
    if (!entry || entry.bound || !claim || access?.scope !== "content" || access.ownerKey !== entry.ownerKey ||
        access.tabId !== entry.tabId || access.nativeDocumentId !== entry.nativeDocumentId ||
        access.documentGeneration !== entry.documentGeneration || access.navigationGeneration !== entry.navigationGeneration ||
        access.authorityGeneration !== entry.authorityGeneration || access.pageKey !== entry.pageKey) fail(E.FORBIDDEN, "preview.bind");
    entry.bound = claim;
    entry.claims.clear();
    entry.expiresAt = now() + BOUND_MS;
    return { bound: true };
  }
  function forFrame(previewId, frame) {
    const entry = get(previewId), bound = entry?.bound;
    if (!entry || !bound || frame?.tabId !== entry.tabId || frame.frameId !== bound.frameId ||
        frame.documentId !== bound.documentId || frame.documentUrl !== bound.documentUrl ||
        frame.contextId !== bound.contextId) fail(E.FORBIDDEN, "preview.frame");
    return entry;
  }
  function closeByOwner(access, previewId) {
    const entry = get(previewId);
    if (!entry || access?.scope !== "content" || access.ownerKey !== entry.ownerKey ||
        access.tabId !== entry.tabId || access.documentGeneration !== entry.documentGeneration) fail(E.FORBIDDEN, "preview.close-owner");
    return { closed: remove(previewId) };
  }
  function closeByFrame(previewId, frame) {
    const entry = forFrame(previewId, frame);
    return { closed: remove(entry.previewId) };
  }
  function revoke(predicate = () => true) {
    let count = 0;
    for (const [previewId, entry] of [...sessions]) if (predicate(entry)) { remove(previewId); count++; }
    return count;
  }
  return Object.freeze({ create, claim, getClaim, bind, forFrame, closeByOwner, closeByFrame, get,
    revokeAll() { return revoke(); },
    revokeTab(tabId) { return revoke(entry => entry.tabId === tabId); },
    revokeSite(siteKey) { return revoke(entry => entry.siteKey === siteKey); },
    revokePage(pageKey) { return revoke(entry => entry.pageKey === pageKey); },
    revokeRecord(recordId) { return revoke(entry => entry.recordId === recordId); },
    get size() { prune(); return sessions.size; } });
}

export const READING_PREVIEW_TTL = Object.freeze({ unclaimedMs: UNCLAIMED_MS, boundMs: BOUND_MS, claimsPerSession: CLAIMS_PER_SESSION,
  sessionsGlobal: SESSIONS_GLOBAL });

function expectedUrl(raw, previewId) {
  try {
    const url = new URL(raw);
    return url.pathname === "/reading-preview.html" && url.search === `?previewId=${encodeURIComponent(previewId)}` && !url.hash;
  } catch { return false; }
}
