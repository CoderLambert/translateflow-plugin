import { machineError } from "../../shared/machine-translation.js";

const states = new Map(), recent = new Map();
const key = config => `${config.sourceLanguage}:${config.targetLanguage}`;
export async function machineHealth(id) {
  const storageKey = `tfMtCooldown:${id}`;
  let saved;
  try { saved = (await globalThis.chrome?.storage?.local?.get([storageKey]))?.[storageKey]; } catch { /* memory fence survives */ }
  const memory = states.get(id);
  return [saved, memory].filter(v => Number.isFinite(v?.until)).sort((a, b) => b.until - a.until)[0] || { until: 0, failures: 0 };
}
export async function assertMachineAvailable(id) {
  const state = await machineHealth(id);
  if (state.until > Date.now()) throw machineError(state.code || "MT_NETWORK", { retryAfterMs: state.until - Date.now(), cooling: true });
}
export async function machineFailed(id, error, minimumMs = 0) {
  if (error?.cooling || !["MT_NETWORK", "MT_TIMEOUT", "MT_HTTP", "MT_RESPONSE", "MT_RATE_LIMIT", "MT_BLOCKED"].includes(error?.code)) return;
  const previous = await machineHealth(id), failures = Math.min(5, (previous.failures || 0) + 1);
  const state = { until: Date.now() + Math.max(minimumMs, Math.min(300000, 30000 * 2 ** (failures - 1))), failures, code: error.code };
  states.set(id, state);
  try { await globalThis.chrome?.storage?.local?.set({ [`tfMtCooldown:${id}`]: state }); } catch { /* memory-only */ }
}
export async function machineSucceeded(config) {
  states.set(config.provider, { until: 0, failures: 0 });
  recent.set(key(config), { id: config.provider, until: Date.now() + 600000 });
  try { await globalThis.chrome?.storage?.local?.set({ [`tfMtCooldown:${config.provider}`]: { until: 0, failures: 0 } }); } catch { /* memory-only */ }
}
export function prioritizeMachineCandidates(candidates) {
  const winner = recent.get(key(candidates[0] || {}));
  return winner?.until > Date.now() ? [...candidates].sort((a, b) => Number(b.provider === winner.id) - Number(a.provider === winner.id)) : [...candidates];
}
