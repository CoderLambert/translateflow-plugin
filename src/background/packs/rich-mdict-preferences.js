import { normalizePackId } from "./rich-mdict-contract.js";

export const RICH_MDICT_PREFERENCES_KEY = "tfRichMdictPreferencesV1";
export const RICH_MDICT_PREFERENCES_VERSION = 1;

const DEFAULT_PREFERENCE = Object.freeze({
  enabled: true,
  expandedByDefault: false
});
const queuesByStorageArea = new WeakMap();

export function createRichMdictPreferencesStore({
  storageArea = globalThis.chrome?.storage?.local,
  storageKey = RICH_MDICT_PREFERENCES_KEY
} = {}) {
  if (!storageArea?.get || !storageArea?.set) {
    throw new Error("chrome.storage.local is required for rich MDict preferences");
  }
  if (typeof storageKey !== "string" || !storageKey || storageKey.length > 120) {
    throw new Error("rich MDict preferences storage key is invalid");
  }
  const queue = getQueue(storageArea, storageKey);

  function readAll() {
    return serialize(() => readStored());
  }

  function update(dictionaryId, patch) {
    const id = normalizePackId(dictionaryId);
    const normalizedPatch = normalizePatch(patch);
    return serialize(async () => {
      const state = await readStored();
      const current = normalizePreference(state.dictionaries[id]);
      state.dictionaries[id] = { ...current, ...normalizedPatch };
      await writeStored(state);
      return { ...state.dictionaries[id] };
    });
  }

  function reconcile(installedDictionaries) {
    const installed = normalizeInstalledList(installedDictionaries);
    return serialize(async () => {
      const state = await readStored();
      const nextDictionaries = {};
      for (const dictionary of installed) {
        const existing = state.dictionaries[dictionary.id];
        if (existing) {
          const preference = normalizePreference(existing);
          if (preference.order !== null) nextDictionaries[dictionary.id] = preference;
          else nextDictionaries[dictionary.id] = {
            ...preference,
            order: null
          };
        }
      }
      let nextOrder = Object.values(nextDictionaries)
        .reduce((maximum, value) => value.order === null ? maximum : Math.max(maximum, value.order), -1024) + 1024;
      for (const dictionary of installed) {
        if (nextDictionaries[dictionary.id] && nextDictionaries[dictionary.id].order !== null) continue;
        nextDictionaries[dictionary.id] = {
          ...(nextDictionaries[dictionary.id] || DEFAULT_PREFERENCE),
          order: nextOrder
        };
        nextOrder = Math.min(nextOrder + 1024, 1_000_000_000);
      }
      const orderCounts = new Map();
      for (const preference of Object.values(nextDictionaries)) {
        orderCounts.set(preference.order, (orderCounts.get(preference.order) || 0) + 1);
      }
      if ([...orderCounts.values()].some((count) => count > 1)) {
        const stableOrder = [...installed].sort((left, right) =>
          nextDictionaries[left.id].order - nextDictionaries[right.id].order ||
          left.installedAt - right.installedAt || left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
        );
        stableOrder.forEach((dictionary, index) => {
          nextDictionaries[dictionary.id].order = index * 1024;
        });
      }
      const changed = !samePreferences(state.dictionaries, nextDictionaries);
      if (changed) {
        state.dictionaries = nextDictionaries;
        await writeStored(state);
      }
      return clonePreferences(nextDictionaries);
    });
  }

  function remove(dictionaryId) {
    const id = normalizePackId(dictionaryId);
    return serialize(async () => {
      const state = await readStored();
      if (!Object.hasOwn(state.dictionaries, id)) return false;
      delete state.dictionaries[id];
      await writeStored(state);
      return true;
    });
  }

  function reorder(dictionaryIds, installedDictionaryIds) {
    const orderedIds = normalizeDictionaryIds(dictionaryIds);
    const installedIds = normalizeDictionaryIds(installedDictionaryIds);
    const installedSet = new Set(installedIds);
    if (orderedIds.length !== installedIds.length || orderedIds.some((id) => !installedSet.has(id))) {
      throw preferenceError("RICH_MDICT_PREFERENCES_ORDER", "Dictionary order must include each installed rich dictionary exactly once.");
    }
    if (orderedIds.length && (orderedIds.length - 1) * 1024 > 1_000_000_000) {
      throw preferenceError("RICH_MDICT_PREFERENCES_ORDER", "Rich dictionary order exceeds its storage limit.");
    }
    return serialize(async () => {
      const state = await readStored();
      const nextDictionaries = Object.fromEntries(Object.entries(state.dictionaries)
        .filter(([id]) => !installedSet.has(id)));
      const reordered = {};
      orderedIds.forEach((id, index) => {
        reordered[id] = { ...normalizePreference(state.dictionaries[id]), order: index * 1024 };
      });
      state.dictionaries = { ...nextDictionaries, ...reordered };
      await writeStored(state);
      return { dictionaryIds: [...orderedIds], preferences: clonePreferences(reordered) };
    });
  }

  async function readStored() {
    const stored = await storageArea.get([storageKey]);
    return normalizeState(stored?.[storageKey]);
  }

  async function writeStored(state) {
    await storageArea.set({ [storageKey]: normalizeState(state) });
  }

  function serialize(action) {
    const operation = queue.current.then(action);
    queue.current = operation.catch(() => {});
    return operation;
  }

  return Object.freeze({ readAll, update, reconcile, remove, reorder });
}

export function normalizeRichMdictPreferencesState(value) {
  return normalizeState(value);
}

function normalizeState(value) {
  const dictionaries = {};
  const input = value?.dictionaries;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [rawId, rawPreference] of Object.entries(input)) {
      try {
        const id = normalizePackId(rawId);
        dictionaries[id] = normalizePreference(rawPreference);
      } catch {
        // Malformed preference entries are ignored and pruned on the next reconcile.
      }
    }
  }
  return { version: RICH_MDICT_PREFERENCES_VERSION, dictionaries };
}

function normalizePreference(value) {
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : DEFAULT_PREFERENCE.enabled,
    order: Number.isSafeInteger(value?.order) && value.order >= 0 && value.order <= 1_000_000_000
      ? value.order
      : null,
    expandedByDefault: typeof value?.expandedByDefault === "boolean"
      ? value.expandedByDefault
      : DEFAULT_PREFERENCE.expandedByDefault
  };
}

function normalizePatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw preferenceError("RICH_MDICT_PREFERENCES_INPUT", "Rich MDict preference update is invalid.");
  }
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !["enabled", "order", "expandedByDefault"].includes(key))) {
    throw preferenceError("RICH_MDICT_PREFERENCES_INPUT", "Rich MDict preference update contains unsupported fields.");
  }
  const patch = {};
  if (Object.hasOwn(value, "enabled")) {
    if (typeof value.enabled !== "boolean") {
      throw preferenceError("RICH_MDICT_PREFERENCES_INPUT", "Rich MDict enabled preference must be boolean.");
    }
    patch.enabled = value.enabled;
  }
  if (Object.hasOwn(value, "order")) {
    if (!Number.isSafeInteger(value.order) || value.order < 0 || value.order > 1_000_000_000) {
      throw preferenceError("RICH_MDICT_PREFERENCES_INPUT", "Rich MDict order must be a bounded non-negative integer.");
    }
    patch.order = value.order;
  }
  if (Object.hasOwn(value, "expandedByDefault")) {
    if (typeof value.expandedByDefault !== "boolean") {
      throw preferenceError("RICH_MDICT_PREFERENCES_INPUT", "Rich MDict expanded preference must be boolean.");
    }
    patch.expandedByDefault = value.expandedByDefault;
  }
  return patch;
}

function normalizeInstalledList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const installed = [];
  for (const dictionary of value) {
    try {
      const id = normalizePackId(dictionary?.id);
      if (seen.has(id)) continue;
      seen.add(id);
      installed.push({
        id,
        title: String(dictionary?.title || "").slice(0, 200),
        installedAt: Number.isSafeInteger(dictionary?.installedAt) && dictionary.installedAt >= 0
          ? dictionary.installedAt
          : 0
      });
    } catch {
      // Only IDs from the installed dictionary catalog are eligible for preferences.
    }
  }
  installed.sort((left, right) => left.installedAt - right.installedAt ||
    left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  return installed;
}

function normalizeDictionaryIds(value) {
  if (!Array.isArray(value)) {
    throw preferenceError("RICH_MDICT_PREFERENCES_ORDER", "Dictionary order must be an array of installed IDs.");
  }
  const ids = [];
  const seen = new Set();
  for (const candidate of value) {
    let id;
    try {
      id = normalizePackId(candidate);
    } catch {
      throw preferenceError("RICH_MDICT_PREFERENCES_ORDER", "Dictionary order contains an invalid ID.");
    }
    if (seen.has(id)) throw preferenceError("RICH_MDICT_PREFERENCES_ORDER", "Dictionary order cannot contain duplicate IDs.");
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function samePreferences(left, right) {
  const leftIds = Object.keys(left).sort();
  const rightIds = Object.keys(right).sort();
  if (leftIds.length !== rightIds.length || leftIds.some((id, index) => id !== rightIds[index])) return false;
  return leftIds.every((id) => {
    const a = normalizePreference(left[id]);
    const b = normalizePreference(right[id]);
    return a.enabled === b.enabled && a.order === b.order && a.expandedByDefault === b.expandedByDefault;
  });
}

function clonePreferences(value) {
  return Object.fromEntries(Object.entries(value).map(([id, preference]) => [id, { ...preference }]));
}

function getQueue(storageArea, storageKey) {
  let queues = queuesByStorageArea.get(storageArea);
  if (!queues) {
    queues = new Map();
    queuesByStorageArea.set(storageArea, queues);
  }
  let queue = queues.get(storageKey);
  if (!queue) {
    queue = { current: Promise.resolve() };
    queues.set(storageKey, queue);
  }
  return queue;
}

function preferenceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
