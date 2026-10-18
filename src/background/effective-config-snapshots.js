import { getEffectiveConfig } from "./config.js";
import { translationConfig } from "./browser-translation.js";
import { MACHINE_ENGINE, machineTranslationSettings, rawTranslationSite } from "../shared/machine-translation.js";

const snapshots = new Map();
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_SNAPSHOTS = 256;

export async function createEffectiveConfigSnapshot(pageUrl, options = {}, sender = null) {
  prune();
  const config = await translationConfig(pageUrl, options);
  const machine = config.engine === MACHINE_ENGINE;
  const owner = machine ? machineSnapshotOwner(sender, pageUrl) : null;
  const id = (machine ? "mt:" : "") + crypto.randomUUID();
  snapshots.set(id, { pageUrl: String(pageUrl || ""), config, owner, tabId: sender?.tab?.id, createdAt: Date.now() });
  if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value);
  return { id, config };
}

export async function resolveEffectiveConfigSnapshot(id, pageUrl, sender = null) {
  prune();
  const key = String(id || "");
  if (!key) {
    const stored = await chrome.storage.local.get(["machineTranslation", "siteProfiles"]);
    if (machineTranslationSettings(stored, rawTranslationSite(stored, pageUrl))?.mode === "free-online") throw expired();
    return getEffectiveConfig(pageUrl); // Preserve legacy callers; never select AI for free mode.
  }
  const snapshot = snapshots.get(key);
  if (!snapshot || snapshot.pageUrl !== String(pageUrl || "")) throw expired();
  if (snapshot.config.engine === MACHINE_ENGINE && snapshot.owner !== machineSnapshotOwner(sender, pageUrl)) throw expired();
  return snapshot.config;
}

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
