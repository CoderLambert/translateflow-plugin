import { PACK_MANAGER_STATE_KEY } from "../../shared/pack-manager.js";

export function createPackStateStore({
  storageArea = globalThis.chrome?.storage?.local
} = {}) {
  if (!storageArea?.get || !storageArea?.set) throw new Error("chrome.storage.local is required");
  let mutationQueue = Promise.resolve();

  async function read() {
    const stored = await storageArea.get([PACK_MANAGER_STATE_KEY]);
    return normalizeState(stored?.[PACK_MANAGER_STATE_KEY]);
  }

  async function write(state) {
    const normalized = normalizeState(state);
    await storageArea.set({ [PACK_MANAGER_STATE_KEY]: normalized });
    return normalized;
  }

  function update(mutator) {
    const operation = mutationQueue.then(async () => {
      const current = await read();
      const next = await mutator(clone(current));
      return write(next);
    });
    mutationQueue = operation.catch(() => {});
    return operation;
  }

  return Object.freeze({ read, write, update });
}

export function normalizeState(value) {
  const catalogSequences = value?.catalogSequences && typeof value.catalogSequences === "object"
    ? { ...value.catalogSequences }
    : {};
  const packs = value?.packs && typeof value.packs === "object"
    ? { ...value.packs }
    : {};
  return {
    version: 1,
    catalogSequences,
    packs
  };
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
