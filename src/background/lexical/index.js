import { getEffectiveGlossary } from "../config.js";
import { createActiveOpfsPackReader } from "./active-opfs-reader.js";
import { createLexicalGateway } from "./gateway.js";
import { readPackageBytes } from "./package-assets.js";
import { createTflexReader } from "./tflex-reader.js";
import { LEXICAL_ERROR_CODES } from "../../shared/lexical.js";

const READER_OPTIONS = Object.freeze({
  readBytes: readPackageBytes,
  cacheMaxEntries: 4,
  cacheMaxBytes: 2 * 1024 * 1024
});

const BUNDLED_PACKS = Object.freeze([
  Object.freeze({
    id: "core",
    label: "Core Semantic",
    path: "assets/lexicon/core",
    probe: "persistent"
  }),
  Object.freeze({
    id: "technical",
    label: "Technical Concepts",
    path: "assets/lexicon/technical",
    probe: "tmux"
  })
]);

const readers = Object.fromEntries(BUNDLED_PACKS.map((pack) => [
  pack.id,
  createTflexReader({
    ...READER_OPTIONS,
    packBasePath: pack.path
  })
]));

const activeOpfsReader = createActiveOpfsPackReader();

const gateway = createLexicalGateway({
  packReaders: [
    ...BUNDLED_PACKS.map((pack) => readers[pack.id]),
    activeOpfsReader
  ],
  resolveGlossary: getEffectiveGlossary
});

export function runLexicalLookup(input) {
  return gateway.lookup(input);
}

export async function getBundledLexiconStatus() {
  return {
    packs: await Promise.all(BUNDLED_PACKS.map(async (pack) => {
      const reader = readers[pack.id];
      try {
        const metadata = await reader.inspect();
        const probe = await reader.lookup(pack.probe);
        if (!probe) {
          return {
            id: pack.id,
            label: pack.label,
            status: "unhealthy",
            errorCode: "LEXICON_PROBE_MISS",
            message: `Required health probe is missing: ${pack.probe}`
          };
        }
        return {
          id: pack.id,
          label: pack.label,
          status: "ready",
          probe: pack.probe,
          ...metadata
        };
      } catch (error) {
        return {
          id: pack.id,
          label: pack.label,
          status: bundledStatusFromError(error),
          errorCode: error?.code || "",
          message: error?.message || String(error),
          packId: error?.packId || "",
          path: error?.path || ""
        };
      }
    }))
  };
}

export function getLexicalGatewayStats() {
  return gateway.stats();
}

function bundledStatusFromError(error) {
  if (error?.code === LEXICAL_ERROR_CODES.STORAGE) return "unavailable";
  if (error?.code === LEXICAL_ERROR_CODES.CORRUPT) return "corrupt";
  if (error?.code === LEXICAL_ERROR_CODES.INCOMPATIBLE) return "incompatible";
  return "error";
}
