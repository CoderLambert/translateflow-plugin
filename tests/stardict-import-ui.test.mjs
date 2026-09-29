import test from "node:test";
import assert from "node:assert/strict";
import {
  collectStarDictFileSet,
  createStarDictProductRecipe,
  inspectStarDictFiles,
  userMessageForStarDictError
} from "../src/options/stardict-import-ui.js";

function fakeFile(name, bytes) {
  const data = bytes instanceof Uint8Array
    ? bytes
    : new TextEncoder().encode(String(bytes));
  return {
    name,
    size: data.byteLength,
    async arrayBuffer() {
      return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      );
    }
  };
}

function fixture({ syn = false } = {}) {
  const word = new TextEncoder().encode("localword");
  const translation = new TextEncoder().encode("本地释义");
  const idx = new Uint8Array(word.byteLength + 1 + 8);
  idx.set(word, 0);
  const view = new DataView(idx.buffer);
  view.setUint32(word.byteLength + 1, 0, false);
  view.setUint32(
    word.byteLength + 5,
    translation.byteLength,
    false
  );
  const ifo = [
    "StarDict's dict ifo file",
    "version=2.4.2",
    "bookname=Issue 165 Fixture",
    "wordcount=1",
    "idxfilesize=" + idx.byteLength,
    ...(syn ? ["synwordcount=1"] : []),
    "sametypesequence=m",
    ""
  ].join("\n");
  return [
    fakeFile("fixture.ifo", ifo),
    fakeFile("fixture.idx", idx),
    fakeFile("fixture.dict", translation)
  ];
}

test("StarDict Settings groups one coherent file set", () => {
  const result = collectStarDictFileSet(fixture());
  assert.equal(result.baseName, "fixture");
  assert.equal(result.format, "plain");
  assert.equal(result.ifoFile.name, "fixture.ifo");
  assert.equal(result.idxFile.name, "fixture.idx");
  assert.equal(result.dictFile.name, "fixture.dict");
});

test("StarDict Settings rejects missing, duplicate and ambiguous file sets", () => {
  assert.throws(
    () => collectStarDictFileSet(fixture().slice(0, 2)),
    /文件不完整/
  );
  assert.throws(
    () => collectStarDictFileSet([
      ...fixture(),
      fakeFile("fixture.DICT", "duplicate")
    ]),
    /重复/
  );
  assert.throws(
    () => collectStarDictFileSet([
      ...fixture(),
      fakeFile("other.ifo", "other")
    ]),
    /多套/
  );
});

test("StarDict Settings inspects supported metadata before import", async () => {
  const result = await inspectStarDictFiles(fixture());
  assert.equal(result.compatible, true);
  assert.equal(result.dictionary.bookname, "Issue 165 Fixture");
  assert.equal(result.dictionary.version, "2.4.2");
  assert.equal(result.dictionary.sametypesequence, "m");
  assert.equal(result.hasSynonyms, false);
});

test("StarDict Settings requires declared synonym file", async () => {
  await assert.rejects(
    inspectStarDictFiles(fixture({ syn: true })),
    /声明了同义词/
  );
});

test("StarDict product recipe hides internal semantic identifiers from the user", () => {
  const inspection = {
    dictionary: { bookname: "Issue 165 Fixture" }
  };
  const recipe = createStarDictProductRecipe(inspection, {
    cryptoProvider: {
      randomUUID() {
        return "123e4567-e89b-12d3-a456-426614174000";
      }
    },
    now: () => 1_800_000_000_000
  });

  assert.equal(
    recipe.semanticProfile,
    "en-zh-plain-text-translation-v1"
  );
  assert.equal(recipe.sourceLanguage, "en");
  assert.equal(recipe.targetLanguage, "zh-CN");
  assert.equal(recipe.dictionary.bookname, "Issue 165 Fixture");
  assert.match(recipe.packId, /^local-stardict-/);
  assert.equal(
    recipe.assertions.plainTextRepresentsTargetTranslation,
    true
  );
  assert.equal(recipe.assertions.localUseOnly, true);
});

test("StarDict errors map to user-facing categories without raw parser text", () => {
  assert.match(
    userMessageForStarDictError({
      code: "STARDICT_UNSAFE_CONTENT",
      message: "internal unsafe parser detail"
    }),
    /安全策略/
  );
  assert.doesNotMatch(
    userMessageForStarDictError({
      code: "STARDICT_UNSAFE_CONTENT",
      message: "internal unsafe parser detail"
    }),
    /internal/
  );
  assert.match(
    userMessageForStarDictError({
      name: "AbortError"
    }),
    /已取消/
  );
});
