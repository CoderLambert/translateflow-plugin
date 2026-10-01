import test from "node:test";
import assert from "node:assert/strict";
import { resolveAssociatedMddFiles } from "../src/options/local-dictionary-import-presentation.js";

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
