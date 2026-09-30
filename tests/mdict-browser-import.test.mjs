import test from "node:test";
import assert from "node:assert/strict";
import {
  projectMdictV2PlainText
} from "../src/background/packs/importers/mdict-core.js";
import {
  buildMdictLocalTflex
} from "../src/background/packs/importers/mdict-local-adapter.js";
import {
  validateLocalTflexImport
} from "../src/background/packs/local-import.js";
import { makeMdx } from "./helpers/mdict-fixture.mjs";

function recipe() {
  return {
    schemaVersion: 1,
    semanticProfile:
      "en-zh-plain-text-translation-v1",
    packId: "local-mdict-browser-test",
    packVersion: "fixture-v1",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    dictionary: {
      title: "Issue 167 MDict",
      sourceId: "mdict-browser-test",
      sourceVersion: "fixture-v1"
    },
    assertions: {
      plainTextRepresentsTargetTranslation: true,
      localUseOnly: true
    }
  };
}

test("browser-safe MDict core parses the reviewed strict v2 subset", async () => {
  const mdx = makeMdx([
    ["hello", "你好"],
    ["run", "跑；运行"]
  ]);
  const result = await projectMdictV2PlainText({
    mdxBytes: mdx,
    sourceId: "mdict-browser-test",
    sourceVersion: "fixture-v1"
  });
  assert.equal(result.dictionary.title, "Issue 167 MDict");
  assert.deepEqual(
    result.entries.map((entry) => [
      entry.lookupKey,
      entry.plainText
    ]),
    [
      ["hello", "你好"],
      ["run", "跑；运行"]
    ]
  );
  assert.deepEqual(
    result.blocks.recordCompression,
    ["zlib"]
  );
  assert.equal(result.policy.htmlRendering, "rejected");
  assert.equal(result.policy.mddResources, "not-loaded");
  assert.equal(result.policy.networkResources, "never-rendered");
});

test("browser MDict adapter emits validated local opfs-indexed-v1 TFLex", async () => {
  const mdx = makeMdx([
    ["hello", "你好"],
    ["run", "跑；运行"]
  ]);
  const built = await buildMdictLocalTflex({
    mdxBytes: mdx,
    recipe: recipe()
  });
  const validated = await validateLocalTflexImport({
    files: built.files
  });
  assert.equal(
    validated.manifest.packId,
    "local-mdict-browser-test"
  );
  assert.equal(
    validated.manifest.profile,
    "opfs-indexed-v1"
  );
  assert.equal(built.metrics.inputBytes, mdx.byteLength);
  assert.equal(built.metrics.records, 2);
  assert.ok(built.metrics.outputBytes > 0);
});

test("browser MDict importer fails closed on unsafe and unsupported content", async () => {
  await assert.rejects(
    projectMdictV2PlainText({
      mdxBytes: makeMdx([
        ["hello", "<script>alert(1)</script>"]
      ])
    }),
    (error) => error?.code === "MDICT_UNSAFE_CONTENT"
  );
  await assert.rejects(
    projectMdictV2PlainText({
      mdxBytes: makeMdx(
        [["hello", "你好"]],
        { keyBlockCompression: "lzo" }
      )
    }),
    (error) => error?.code === "MDICT_UNSUPPORTED"
  );
});
