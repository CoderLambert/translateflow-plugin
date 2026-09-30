import { PACK_MANAGER_STATE_KEY } from "../../shared/pack-manager.js";

export function createPackStateStore({
  storageArea = globalThis.chrome?.storage?.local,
  stateKey = PACK_MANAGER_STATE_KEY
} = {}) {
  if (!storageArea?.get || !storageArea?.set) throw new Error("chrome.storage.local is required");
  if (typeof stateKey !== "string" || !stateKey || stateKey.length > 120) {
    throw new Error("dictionary state key is invalid");
  }
  let mutationQueue = Promise.resolve();

  async function read() {
    const stored = await storageArea.get([stateKey]);
    return normalizeState(stored?.[stateKey]);
  }

  async function write(state) {
    const normalized = normalizeState(state);
    await storageArea.set({ [stateKey]: normalized });
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
  const state = {
    version: 1,
    catalogSequences,
    packs
  };
  if (value?.reservations && typeof value.reservations === "object") {
    state.reservations = { ...value.reservations };
  }
  return state;
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
