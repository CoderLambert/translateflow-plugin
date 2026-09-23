import test from "node:test";
import assert from "node:assert/strict";
import {
  composeGlossaryPrompt,
  glossaryIdentity,
  normalizeGlossary,
  normalizeGlossaryStore,
  normalizeSiteGlossaryStore,
  resolveEffectiveGlossary,
  upsertGlossaryEntry
} from "../src/shared/glossary.js";

test("glossary storage is versioned and accepts legacy arrays", () => {
  const store = normalizeGlossaryStore([
    { id: "1", source: " repository ", target: " 仓库 " }
  ]);

  assert.equal(store.version, 1);
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].source, "repository");
  assert.equal(store.entries[0].target, "仓库");
});

test("normalization deduplicates by normalized source and lets the latest value win", () => {
  const entries = normalizeGlossary([
    { id: "1", source: "repository", target: "仓库" },
    { id: "2", source: "Repository", target: "代码仓库" },
    { id: "3", source: "", target: "x" }
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "2");
  assert.equal(entries[0].target, "代码仓库");
});

test("upsert prevents duplicate effective terms when source is edited", () => {
  const entries = upsertGlossaryEntry(
    [{ id: "1", source: "repository", target: "仓库" }],
    { id: "2", source: "Repository", target: "代码库" }
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "2");
  assert.equal(entries[0].target, "代码库");
});

test("site glossary store normalizes origins and supports legacy mapping", () => {
  const store = normalizeSiteGlossaryStore({
    "https://github.com/some/path": [{ source: "PR", target: "拉取请求" }]
  });

  assert.equal(store.version, 1);
  assert.equal(store.sites["https://github.com"].length, 1);
});

test("site glossary extends and overrides global glossary only for matching origin", () => {
  const global = {
    version: 1,
    entries: [
      { source: "repository", target: "仓库" },
      { source: "middleware", target: "中间件" }
    ]
  };
  const sites = {
    version: 1,
    sites: {
      "https://github.com": [
        { source: "Repository", target: "代码仓库" },
        { source: "pull request", target: "拉取请求" }
      ]
    }
  };

  const github = resolveEffectiveGlossary(global, sites, "https://github.com/openai/repo");
  assert.deepEqual(github.map(({ source, target }) => [source, target]), [
    ["middleware", "中间件"],
    ["pull request", "拉取请求"],
    ["Repository", "代码仓库"]
  ]);

  const other = resolveEffectiveGlossary(global, sites, "https://example.com/");
  assert.equal(other.some((entry) => entry.source === "pull request"), false);
  assert.equal(other.find((entry) => entry.source === "repository").target, "仓库");
});

test("case-sensitive and insensitive terms keep distinct identities", () => {
  const identity = glossaryIdentity([
    { source: "API", target: "接口", caseSensitive: true },
    { source: "api", target: "API", caseSensitive: false }
  ]);

  assert.equal(identity.length, 2);
  assert.notDeepEqual(identity[0], identity[1]);
});

test("empty glossary leaves prompt byte-for-byte unchanged", () => {
  const prompt = "Translate this.";
  assert.equal(composeGlossaryPrompt(prompt, []), prompt);
  assert.deepEqual(glossaryIdentity([]), []);
});

test("glossary identity is deterministic and ignores disabled entries", () => {
  const a = glossaryIdentity([
    { source: "b", target: "B" },
    { source: "a", target: "A" },
    { source: "x", target: "X", enabled: false }
  ]);
  const b = glossaryIdentity([
    { source: "a", target: "A" },
    { source: "b", target: "B" }
  ]);

  assert.deepEqual(a, b);
});
