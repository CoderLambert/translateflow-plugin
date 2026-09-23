import test from "node:test";
import assert from "node:assert/strict";
import { composeGlossaryPrompt, glossaryIdentity, normalizeGlossary, resolveEffectiveGlossary } from "../src/shared/glossary.js";

test("glossary normalization removes invalid and duplicate normalized source terms", () => {
  const entries = normalizeGlossary([
    { id: "1", source: " repository ", target: " 仓库 " },
    { id: "2", source: "Repository", target: "代码库" },
    { id: "3", source: "", target: "x" }
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, "repository");
  assert.equal(entries[0].target, "仓库");
});

test("site glossary extends and overrides global glossary only for matching origin", () => {
  const global = [
    { source: "repository", target: "仓库" },
    { source: "middleware", target: "中间件" }
  ];
  const sites = {
    "https://github.com": [
      { source: "Repository", target: "代码仓库" },
      { source: "pull request", target: "拉取请求" }
    ]
  };
  const github = resolveEffectiveGlossary(global, sites, "https://github.com/openai/repo");
  assert.deepEqual(github.map(({ source, target }) => [source, target]), [
    ["middleware", "中间件"], ["pull request", "拉取请求"], ["Repository", "代码仓库"]
  ]);
  const other = resolveEffectiveGlossary(global, sites, "https://example.com/");
  assert.equal(other.some((entry) => entry.source === "pull request"), false);
  assert.equal(other.find((entry) => entry.source === "repository").target, "仓库");
});

test("case-sensitive and insensitive terms have distinct identities", () => {
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
  const b = glossaryIdentity([{ source: "a", target: "A" }, { source: "b", target: "B" }]);
  assert.deepEqual(a, b);
});
