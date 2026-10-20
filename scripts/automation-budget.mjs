import { existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync } from "node:fs";
import { dirname } from "node:path";

// The campaign runner holds an exclusive lock. Reserve synchronously and persist
// before forwarding; interrupted attempts remain charged, never reset on retry.
export function openRequestBudget(path, { campaignId, maxRequests }) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 20) throw new Error("Invalid request limit");
  const state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { campaignId, maxRequests, attempts: [] };
  if (state.campaignId !== campaignId || state.maxRequests !== maxRequests || !Array.isArray(state.attempts) ||
      state.attempts.length > maxRequests || state.attempts.some((item, i) => item.id !== i + 1)) throw new Error("Invalid persistent request ledger");
  const save = () => {
    const file=openSync(`${path}.tmp`,"w",0o600);
    try{writeFileSync(file,JSON.stringify(state,null,2)+"\n");fsyncSync(file);}finally{closeSync(file);}
    renameSync(`${path}.tmp`,path);
    const directory=openSync(dirname(path),"r");try{fsyncSync(directory);}finally{closeSync(directory);}
  };
  save();
  return {
    reserve() {
      if (state.attempts.length >= maxRequests) throw Object.assign(new Error("Configured request budget exhausted"), { code: "TEST_BUDGET" });
      const item = { id: state.attempts.length + 1, at: new Date().toISOString(), status: "reserved" };
      state.attempts.push(item); save(); return item.id;
    },
    settle(id, status, usage = null) {
      const item = state.attempts.find(item => item.id === id);
      if (!item) throw new Error("Unknown reserved attempt");
      item.status = status;
      if (usage) item.usage = Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"].filter(k => Number.isSafeInteger(usage[k])).map(k => [k, usage[k]]));
      save();
    },
    count: () => state.attempts.length,
    summary: () => structuredClone(state)
  };
}
