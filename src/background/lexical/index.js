import { getEffectiveGlossary } from "../config.js";
import { createActiveOpfsPackReader } from "./active-opfs-reader.js";
import { createLexicalGateway } from "./gateway.js";

const gateway = createLexicalGateway({
  packReaders: [createActiveOpfsPackReader()],
  resolveGlossary: getEffectiveGlossary
});

export function runLexicalLookup(input) {
  return gateway.lookup(input);
}
