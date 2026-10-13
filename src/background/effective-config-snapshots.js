import { getEffectiveConfig } from "./config.js";

const snapshots = new Map();
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_SNAPSHOTS = 256;

export async function createEffectiveConfigSnapshot(pageUrl) {
  prune();
  const id = crypto.randomUUID();
  const config = await getEffectiveConfig(pageUrl);
  snapshots.set(id, { pageUrl: String(pageUrl || ""), config, createdAt: Date.now() });
  if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value);
  return { id, config };
}

export async function resolveEffectiveConfigSnapshot(id, pageUrl) {
  prune();
  const key = String(id || "");
  if (!key) return getEffectiveConfig(pageUrl);
  const snapshot = snapshots.get(key);
  if (!snapshot || snapshot.pageUrl !== String(pageUrl || "")) {
    const error = new Error("翻译配置快照已失效，请重新开始翻译。");
    error.code = "CONFIG_SNAPSHOT_EXPIRED";
    throw error;
  }
  return snapshot.config;
}

export function releaseEffectiveConfigSnapshot(id) { snapshots.delete(String(id || "")); }

function prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, value] of snapshots) if (value.createdAt < cutoff) snapshots.delete(id);
}
