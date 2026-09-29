import { LEXICAL_ERROR_CODES } from "../../shared/lexical.js";
import { createOpfsPackStore } from "../packs/opfs-store.js";
import { createPackStateStore } from "../packs/state.js";
import { createOpfsIndexedTflexReader } from "./opfs-indexed-reader.js";

export function createActiveOpfsPackReader({
  stateStore,
  store = createOpfsPackStore(),
  readerFactory = createOpfsIndexedTflexReader,
  cryptoProvider = globalThis.crypto,
  readerVersion = 1,
  cacheMaxEntries = 64,
  cacheMaxBytes = 2 * 1024 * 1024
} = {}) {
  const resolvedStateStore = stateStore || createDefaultStateStore();
  if (!resolvedStateStore?.read) throw new Error("active OPFS reader requires a pack state store");
  if (!store?.readFile || !store?.readFileRange) {
    throw new Error("active OPFS reader requires an OPFS pack store");
  }
  if (typeof readerFactory !== "function") {
    throw new Error("active OPFS reader requires a reader factory");
  }

  const readers = new Map();
  const lastErrors = new Map();
  let lastStateError = null;

  async function activeEntries() {
    let state;
    try {
      state = await resolvedStateStore.read();
      lastStateError = null;
    } catch (error) {
      lastStateError = makeDiagnostic("", error, LEXICAL_ERROR_CODES.STORAGE);
      return [];
    }

    const entries = [];
    const observedPackIds = new Set();
    for (const [packId, entry] of Object.entries(state?.packs || {})) {
      if (entry?.status !== "healthy") continue;
      observedPackIds.add(packId);
      const snapshot = entry?.active;
      if (
        !snapshot ||
        snapshot.packId !== packId ||
        !snapshot.packVersion ||
        !snapshot.fingerprint ||
        !Array.isArray(snapshot.files)
      ) {
        lastErrors.set(packId, {
          packId,
          code: LEXICAL_ERROR_CODES.CORRUPT,
          message: "Healthy dictionary pack has malformed active snapshot metadata.",
          path: "manifest.json"
        });
        continue;
      }
      entries.push({ packId, snapshot });
    }
    entries.sort((a, b) => compareText(a.packId, b.packId));

    const liveKeys = new Set(entries.map(({ snapshot }) => snapshotKey(snapshot)));
    for (const [key, reader] of readers) {
      if (liveKeys.has(key)) continue;
      reader.clearCache?.();
      readers.delete(key);
    }
    for (const packId of lastErrors.keys()) {
      if (!observedPackIds.has(packId)) lastErrors.delete(packId);
    }
    return entries;
  }

  function readerFor(snapshot) {
    const key = snapshotKey(snapshot);
    let reader = readers.get(key);
    if (!reader) {
      reader = readerFactory({
        store,
        snapshot,
        cryptoProvider,
        readerVersion,
        cacheMaxEntries,
        cacheMaxBytes
      });
      readers.set(key, reader);
    }
    return reader;
  }

  async function lookupAll(text) {
    const hits = [];
    for (const { packId, snapshot } of await activeEntries()) {
      try {
        const reader = readerFor(snapshot);
        const packHits = typeof reader.lookupAll === "function"
          ? await reader.lookupAll(text)
          : [await reader.lookup(text)].filter(Boolean);
        lastErrors.delete(packId);
        hits.push(...packHits);
      } catch (error) {
        if (!isTypedLexicalError(error)) throw error;
        lastErrors.set(packId, makeDiagnostic(packId, error));
      }
    }
    return hits;
  }

  return Object.freeze({
    lookupAll,
    async lookup(text) {
      return (await lookupAll(text))[0] || null;
    },
    async inspect() {
      const packs = [];
      for (const { packId, snapshot } of await activeEntries()) {
        try {
          const metadata = await readerFor(snapshot).inspect();
          lastErrors.delete(packId);
          packs.push({ status: "ready", ...metadata });
        } catch (error) {
          if (!isTypedLexicalError(error)) throw error;
          const diagnostic = makeDiagnostic(packId, error);
          lastErrors.set(packId, diagnostic);
          packs.push({ status: "error", packId, ...diagnostic });
        }
      }
      return { packs, stateError: lastStateError };
    },
    clearCache() {
      for (const reader of readers.values()) reader.clearCache?.();
      readers.clear();
      lastErrors.clear();
      lastStateError = null;
    },
    stats() {
      return {
        profile: "active-opfs-indexed",
        readerCount: readers.size,
        stateError: lastStateError,
        errors: [...lastErrors.values()]
          .sort((a, b) => compareText(a.packId, b.packId)),
        readers: [...readers.entries()]
          .sort((a, b) => compareText(a[0], b[0]))
          .map(([key, reader]) => ({
            key,
            ...(typeof reader.stats === "function" ? reader.stats() : {})
          }))
      };
    }
  });
}

function createDefaultStateStore() {
  const storageArea = globalThis.chrome?.storage?.local;
  if (storageArea?.get && storageArea?.set) {
    return createPackStateStore({ storageArea });
  }
  return Object.freeze({
    async read() {
      return {
        version: 1,
        catalogSequences: {},
        packs: {}
      };
    }
  });
}

function snapshotKey(snapshot) {
  return [
    String(snapshot.packId || ""),
    String(snapshot.packVersion || ""),
    String(snapshot.fingerprint || "")
  ].join("@");
}

function isTypedLexicalError(error) {
  return Object.values(LEXICAL_ERROR_CODES).includes(error?.code);
}

function makeDiagnostic(packId, error, fallbackCode = "") {
  return {
    packId: String(packId || error?.packId || ""),
    code: String(error?.code || fallbackCode || ""),
    message: String(error?.message || error || ""),
    path: String(error?.path || "")
  };
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}
