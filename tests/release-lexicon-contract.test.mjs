import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("all production build entries use the dictionary-free WXT engine", async () => {
  const pkg = JSON.parse(await source("package.json"));
  assert.equal(pkg.scripts["build:extension"], "node scripts/build-extension.mjs");
  assert.equal(pkg.scripts["build:extension:release"], "node scripts/build-extension.mjs");
  assert.equal(pkg.scripts["build:extension:wxt"], "node scripts/build-extension.mjs --out .output/chrome-mv3");
  for (const name of ["setup:lexicon", "build:tflex:core", "build:tflex:technical", "build:lexicon:release", "certify:lexicon"]) assert.equal(pkg.scripts[name], undefined);
});
