import { LEXICAL_ERROR_CODES } from "../../shared/lexical.js";
import { createOpfsPackStore } from "../packs/opfs-store.js";
import { createPackStateStore } from "../packs/state.js";
import { createOpfsIndexedTflexReader } from "./opfs-indexed-reader.js";

export function createActiveOpfsPackReader({
  stateStore = createPackStateStore(),
  store = createOpfsPackStore(),
  readerFactory = createOpfsIndexedTflexReader,
  cryptoProvider = globalThis.crypto,
  readerVersion = 1,
  cacheMaxEntries = 64,
  cacheMaxBytes = 2 * 1024 * 1024
} = {}) {
  if (!stateStore?.read) throw new Error("active OPFS reader requires a pack state store");
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
      state = await stateStore.read();
      lastStateError = null;
    } catch (error) {
      lastStateError = makeDiagnostic("", error, LEXICAL_ERROR_CODES.STORAGE);
      return [];
    }

    const entries = Object.entries(state?.packs || {})
      .filter(([, entry]) => entry?.status === "healthy" && entry?.active)
      .map(([packId, entry]) => ({
        packId,
        snapshot: entry.active
      }))
      .filter(({ packId, snapshot }) =>
        snapshot?.packId === packId &&
        snapshot?.packVersion &&
        snapshot?.fingerprint &&
        Array.isArray(snapshot?.files)
      )
      .sort((a, b) => compareText(a.packId, b.packId));

    const liveKeys = new Set(entries.map(({ snapshot }) => snapshotKey(snapshot)));
    for (const key of readers.keys()) {
      if (!liveKeys.has(key)) readers.delete(key);
    }
    for (const packId of lastErrors.keys()) {
      if (!entries.some((entry) => entry.packId === packId)) lastErrors.delete(packId);
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
