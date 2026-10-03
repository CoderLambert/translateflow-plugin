import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildExtension } from "../scripts/build-extension.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const corpusLock = JSON.parse(await readFile(
  join(repoRoot, "lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json"),
  "utf8"
));

test("production package excludes reviewed ECDICT payloads and adds no dictionary-specific host", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "translateflow-ecdict-mdx-package-"));
  const extensionDir = join(tempRoot, "extension");
  try {
    const report = await buildExtension({
      outDir: extensionDir,
      allowExternalOutput: true
    });
    const files = await listFiles(extensionDir);
    const payloads = files.filter((path) => /\.(?:mdx|mdd|zip)$/iu.test(path));
    const manifest = JSON.parse(await readFile(join(extensionDir, "manifest.json"), "utf8"));
    const workerBootstrap = await readFile(
      join(extensionDir, "src", "options", "workers", "curated-ecdict-mdx-worker.js"),
      "utf8"
    );
    const fixtureSource = await readFile(
      join(repoRoot, "e2e", "support", "production-artifact.mjs"),
      "utf8"
    );

    assert.deepEqual(payloads, [], "MDX/MDD dictionaries and ZIP archives must remain upstream downloads");
    assert.ok(
      report.totalBytes < corpusLock.mdx.bytes,
      "the extension package must remain smaller than the reviewed MDX payload"
    );
    assert.deepEqual(manifest.host_permissions, ["https://api.deepseek.com/*", "http://*/*", "https://*/*"]);
    assert.ok(!manifest.host_permissions.includes("<all_urls>"));
    assert.ok(!manifest.host_permissions.some((pattern) => /(?:github\.com|githubusercontent\.com)/iu.test(pattern)));
    assert.doesNotMatch(workerBootstrap, /__e2e\/ecdict-mdx-28\.zip|release-assets\.githubusercontent\.com\/e2e-cached/iu);
    assert.match(fixtureSource, /if \(ecdictMdxCachedArchivePath\)/u);
    assert.match(fixtureSource, /makeCachedEcdictMdxTestWorker/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
