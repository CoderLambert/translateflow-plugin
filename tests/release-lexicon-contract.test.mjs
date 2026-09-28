import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("production lexical gateway registers both bundled Core and Technical packs", async () => {
  const code = await source("src/background/lexical/index.js");
  assert.match(code, /assets\/lexicon\/core/);
  assert.match(code, /assets\/lexicon\/technical/);
  assert.match(code, /BUNDLED_PACKS/);
  assert.match(code, /packReaders:\s*BUNDLED_PACKS\.map/);
});

test("release lexicon CI builds from the exact Design Freeze OMW revision", async () => {
  const [workflow, packageJson] = await Promise.all([
    source(".github/workflows/lexicon-release.yml"),
    source("package.json")
  ]);
  assert.match(workflow, /omwn\/omw-data/);
  assert.match(workflow, /406bf83b3c507a3d1f26e88252d5d66893fd36bf/);
  assert.match(workflow, /npm run setup:lexicon/);
  assert.match(workflow, /npm run benchmark:lexical/);
  assert.match(workflow, /lexical-quality-report\.json/);
  assert.match(workflow, /npm run certify:lexicon/);
  assert.match(workflow, /npm run test:e2e/);

  const pkg = JSON.parse(packageJson);
  assert.equal(pkg.scripts["build:lexicon:release"], "node scripts/build-release-lexicon.mjs");
  assert.equal(pkg.scripts["setup:lexicon"], "node scripts/setup-lexicon.mjs");
  assert.equal(pkg.scripts["certify:lexicon"], "node scripts/certify-lexical-release.mjs");
  assert.equal(pkg.scripts["benchmark:lexical"], "node scripts/benchmark-lexical-quality.mjs");
});
