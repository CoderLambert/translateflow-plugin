import { getEffectiveGlossary } from "../config.js";
import { createLexicalGateway } from "./gateway.js";
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

const gateway = createLexicalGateway({
  packReaders: [coreReader, technicalReader],
  resolveGlossary: getEffectiveGlossary
});

export function runLexicalLookup(input) {
  return gateway.lookup(input);
}

export function getLexicalGatewayStats() {
  return gateway.stats();
}
