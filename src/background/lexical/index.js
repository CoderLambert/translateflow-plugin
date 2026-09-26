import { getEffectiveGlossary } from "../config.js";
import { createLexicalGateway } from "./gateway.js";
import { readPackageBytes } from "./package-assets.js";
import { createTflexReader } from "./tflex-reader.js";

const coreReader = createTflexReader({
  packBasePath: "assets/lexicon/core",
  readBytes: readPackageBytes,
  cacheMaxEntries: 4,
  cacheMaxBytes: 2 * 1024 * 1024
});

const gateway = createLexicalGateway({
  packReaders: [coreReader],
  resolveGlossary: getEffectiveGlossary
});

export function runLexicalLookup(input) {
  return gateway.lookup(input);
}

export function getLexicalGatewayStats() {
  return gateway.stats();
}
