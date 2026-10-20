import { normalizeUrl } from "../shared/url.js";
import { translationConfig } from "./browser-translation.js";
import { MACHINE_ENGINE } from "../shared/machine-translation.js";
import { ensureConfigInitialized } from "./config.js";

const snapshots = new Map();
let revision = crypto.randomUUID();
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_SNAPSHOTS = 256;

export async function createEffectiveConfigSnapshot(pageUrl, options = {}, sender = null) {
  prune();
  if (options?.configRevision && options.configRevision !== revision) throw expired();
  await ensureConfigInitialized();
  if (options?.configRevision && options.configRevision !== revision) throw expired();
  const expected = revision;
  const resolved = await translationConfig(pageUrl, options);
  if (expected !== revision) throw expired();
  const config = Object.freeze({ ...resolved, preferenceSurface: options?.surface || "page" });
  const machine = config.engine === MACHINE_ENGINE;
  const owner = machine ? machineSnapshotOwner(sender, pageUrl) : null;
  const id = (machine ? "mt:" : "") + crypto.randomUUID();
  snapshots.set(id, { pageUrl: String(pageUrl || ""), config, owner, tabId: sender?.tab?.id, createdAt: Date.now(), routes: new Map(), sources: new Map(), writable: true });
  if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value);
  return { id, config, revision };
}

export async function resolveEffectiveConfigSnapshot(id, pageUrl, sender = null) {
  prune();
  const key = String(id || "");
  if (!key) {
    const config = await translationConfig(pageUrl);
    if (config.engine === MACHINE_ENGINE || config.engine === "browser-translator") throw expired();
    return config;
  }
  const snapshot = snapshots.get(key);
  if (!snapshot || snapshot.pageUrl !== String(pageUrl || "")) throw expired();
  if (snapshot.config.engine === MACHINE_ENGINE && snapshot.owner !== machineSnapshotOwner(sender, pageUrl)) throw expired();
  return snapshot.config;
}

export function invalidateTranslationSnapshots() { revision = crypto.randomUUID(); snapshots.clear(); }
export function releaseEffectiveConfigSnapshot(id) { snapshots.delete(String(id || "")); }
export function invalidateMachineSnapshots(tabId = null) {
  for (const [id, entry] of snapshots) if (entry.config.engine === MACHINE_ENGINE && (tabId === null || entry.tabId === tabId)) snapshots.delete(id);
}
function machineSnapshotOwner(sender, pageUrl) {
  if (sender?.id !== globalThis.chrome?.runtime?.id || !sender?.id || !Number.isInteger(sender?.tab?.id) || (sender.frameId ?? 0) !== 0 ||
      !/^https?:\/\//u.test(String(pageUrl)) || sender.url !== pageUrl) throw expired();
  return `${sender.tab.id}:${sender.frameId || 0}:${sender.documentId || "legacy"}`;
}
function expired() { return Object.assign(new Error("翻译配置快照已失效，请重新开始翻译。"), { code: "CONFIG_SNAPSHOT_EXPIRED" }); }
function prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, value] of snapshots) if (value.createdAt < cutoff) snapshots.delete(id);
}

// Route state belongs to the same bounded, owner-checked snapshot lifecycle.
export async function machineRouteSnapshot(id, pageUrl, sender) {
  const config = await resolveEffectiveConfigSnapshot(id, pageUrl, sender);
  if (config.engine !== MACHINE_ENGINE || config.routing !== "auto") return null;
  return snapshots.get(String(id));
}
export function fenceMachineRouteWrites(pageUrl = null) {
  for (const entry of snapshots.values()) if (pageUrl === null || normalizeUrl(entry.pageUrl) === normalizeUrl(pageUrl)) {
    entry.writable = false;
    for (const source of entry.sources.values()) for (const candidate of source.candidates) candidate.hit = undefined;
  }
}
