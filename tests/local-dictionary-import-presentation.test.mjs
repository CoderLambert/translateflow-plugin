import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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


test("local import duplicate protection fails closed when installed state is unavailable", async () => {
  const source = await readFile(new URL("../src/options/local-dictionary-import-ui.js", import.meta.url), "utf8");
  assert.match(source, /Promise\.allSettled/u);
  assert.match(source, /installedStateKnown = \{ rich: richKnown, packs: packsKnown \}/u);
  assert.match(source, /!duplicateStateKnown/u);
  assert.match(source, /为避免重复或误覆盖，安装已暂停/u);
  assert.doesNotMatch(source, /catch\s*\{\s*installedCandidates = \[\]/u);
});
