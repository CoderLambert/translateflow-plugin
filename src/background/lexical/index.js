import { getEffectiveGlossary } from "../config.js";
import { createOpfsPackStore } from "../packs/opfs-store.js";
import { createPackStateStore } from "../packs/state.js";
import { createLexicalGateway } from "./gateway.js";
import { createOpfsTflexReader } from "./opfs-tflex-reader.js";
import { readPackageBytes } from "./package-assets.js";
import { createTflexReader } from "./tflex-reader.js";

const READER_OPTIONS = Object.freeze({
  readBytes: readPackageBytes,
  cacheMaxEntries: 4,
  cacheMaxBytes: 2 * 1024 * 1024
});

const coreReader = createTflexReader({
  ...READER_OPTIONS,
  packBasePath: "assets/lexicon/core"
});

const technicalReader = createTflexReader({
  ...READER_OPTIONS,
  packBasePath: "assets/lexicon/technical"
});

const bundledReaders = Object.freeze([coreReader, technicalReader]);
const optionalStore = createOpfsPackStore();
const optionalStateStore = createPackStateStore();
const optionalReaderCache = new Map();

const gateway = createLexicalGateway({
  packReaders: bundledReaders,
  resolvePackReaders: resolveActivePackReaders,
  resolveGlossary: getEffectiveGlossary
});

export function runLexicalLookup(input) {
  return gateway.lookup(input);
}

export function getLexicalGatewayStats() {
  return gateway.stats();
}

async function resolveActivePackReaders() {
  let state;
  try {
    state = await optionalStateStore.read();
  } catch (error) {
    console.warn("TranslateFlow optional dictionary state is unavailable; using bundled lexicons only.", error);
    return [...bundledReaders];
  }

  const readers = [...bundledReaders];
  const liveKeys = new Set();
  const entries = Object.entries(state?.packs || {}).sort(([left], [right]) => left.localeCompare(right, "en"));

  for (const [packId, entry] of entries) {
    if (packId !== "freedict-eng-zho" || entry?.status !== "healthy" || !entry?.active) continue;
    const snapshot = entry.active;
    const cacheKey = [
      packId,
      snapshot.packVersion,
      snapshot.fingerprint
    ].join("\u0000");
    liveKeys.add(cacheKey);
    let reader = optionalReaderCache.get(cacheKey);
    if (!reader) {
      reader = guardOptionalReader(
        createOpfsTflexReader({ store: optionalStore, snapshot }),
        packId
      );
      optionalReaderCache.set(cacheKey, reader);
    }
    readers.push(reader);
  }

  for (const key of [...optionalReaderCache.keys()]) {
    if (!liveKeys.has(key)) optionalReaderCache.delete(key);
  }
  return readers;
}

function guardOptionalReader(reader, packId) {
  let lastError = null;
  return Object.freeze({
    async lookup(text) {
      return (await this.lookupAll(text))[0] || null;
    },
    async lookupAll(text) {
      try {
        const hits = await reader.lookupAll(text);
        lastError = null;
        return hits;
      } catch (error) {
        lastError = {
          code: error?.code || "OPTIONAL_PACK_READ_FAILED",
          message: error?.message || String(error)
        };
        console.warn("TranslateFlow optional dictionary pack read failed; bundled lexicons remain active.", {
          packId,
          ...lastError
        });
        return [];
      }
    },
    clearCache() {
      lastError = null;
      reader.clearCache?.();
    },
    stats() {
      return {
        optional: true,
        packId,
        lastError,
        reader: reader.stats?.() || {}
      };
    }
  });
}
