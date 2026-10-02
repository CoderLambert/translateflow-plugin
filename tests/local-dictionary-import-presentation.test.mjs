import test from "node:test";
import assert from "node:assert/strict";
import { resolveAssociatedMddFiles } from "../src/options/local-dictionary-import-presentation.js";
import {
  isInstalledStateKnownForFamily,
  readInstalledDictionaryState
} from "../src/options/local-dictionary-installed-state.js";

function namedBlob(name) {
  return Object.assign(new Blob(["synthetic MDD"]), { name });
}

test("MDD attachment resolves sanitized preflight labels to one exact selected file", () => {
  const mdx = namedBlob("book\u202Eword.mdx");
  const mdd = namedBlob("book\u202Eword.mdd");
  assert.deepEqual(
    resolveAssociatedMddFiles([{ fileName: "book_word.mdd" }], [mdx, mdd]),
    [mdd]
  );
});

test("MDD attachment refuses ambiguous sanitized filename matches", () => {
  const mdx = namedBlob("book.mdx");
  const bidiName = namedBlob("book\u202Eword.mdd");
  const plainName = namedBlob("book_word.mdd");
  assert.equal(
    resolveAssociatedMddFiles([{ fileName: "book_word.mdd" }], [mdx, bidiName, plainName]),
    null
  );
  assert.deepEqual(resolveAssociatedMddFiles([], [mdx]), []);
});


test("installed-state refresh preserves the healthy source and fails closed only for the unavailable family", async () => {
  const state = await readInstalledDictionaryState({
    async sendMessage(message) {
      if (message.type === "RICH_MDICT_LIST") throw new Error("rich state unavailable");
      if (message.type === "DICTIONARY_PACK_STATUS") {
        return {
          state: {
            packs: {
              "local-fixture": {
                active: { packVersion: "v1", totalBytes: 12 },
                display: { name: "Fixture", format: "tflex" }
              }
            }
          }
        };
      }
      throw new Error("unexpected message");
    }
  });

  assert.equal(state.known.rich, false);
  assert.equal(state.known.packs, true);
  assert.equal(state.candidates.length, 1);
  assert.equal(state.candidates[0].packId, "local-fixture");
  assert.equal(isInstalledStateKnownForFamily("mdict-rich", state.known), false);
  assert.equal(isInstalledStateKnownForFamily("stardict", state.known), true);
  assert.equal(isInstalledStateKnownForFamily("tflex", state.known), true);
});
