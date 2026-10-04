import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CURATED_DICTIONARIES,
  CURATED_DICTIONARY_IDS,
  CURATED_IMPORTER_TYPES,
  assertDeclaredCuratedDictionary,
  getCuratedDictionary,
  validateCuratedDictionaryRecipe
} from "../src/shared/curated-dictionaries.js";
import { extractPinnedEcdictMdx } from "../src/background/packs/importers/ecdict-mdx-zip.js";
import { getCuratedMdxInstallPresentation } from "../src/options/curated-dictionary-presentation.js";
import { fetchCuratedDictionarySource } from "../src/background/providers/curated-dictionary-network.js";

const lock = JSON.parse(await readFile(
  new URL("../lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json", import.meta.url),
  "utf8"
));
const recipe = getCuratedDictionary(CURATED_DICTIONARY_IDS.ECDICT_EN_ZH_MDX);

test("the MDX recipe matches the frozen ECDICT 1.0.28 archive and corpus evidence", () => {
  assert.ok(recipe);
  assert.equal(recipe.importerType, CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1);
  assert.equal(recipe.id, "ecdict-en-zh-mdx-curated");
  assert.equal(recipe.trustClass, "curated-upstream");
  assert.equal(recipe.languageDirection, "en -> zh-CN");
  assert.equal(recipe.originPattern, "https://github.com/*");
  assert.equal(recipe.downloadRedirectOrigin, "https://release-assets.githubusercontent.com");
  assert.equal(recipe.downloadUrl, lock.source.assetUrl);
  assert.equal(recipe.downloadBytes, lock.archive.bytes);
  assert.equal(recipe.downloadSha256, lock.archive.sha256);
  assert.equal(recipe.downloadSha256Authority, "observed-post-download");
  assert.equal(recipe.archive.fileCount, lock.archive.entries);
  assert.equal(recipe.archive.entryName, lock.archive.entryName);
  assert.equal(recipe.archive.entryNameBytesHex, lock.archive.entryNameBytesHex);
  assert.equal(recipe.archive.entryBytes, lock.archive.entryBytes);
  assert.equal(recipe.archive.entrySha256, lock.mdx.sha256);
  assert.equal(recipe.mdx.bytes, lock.mdx.bytes);
  assert.equal(recipe.mdx.entryCount, lock.mdx.entryCount);
  assert.equal(recipe.output.sourceVersion, lock.source.releaseTag);
  assert.equal(recipe.sourceLicenseLabel.includes("未注明 CC 版本"), true);
  assert.match(recipe.sourceLicenseNotice, /不重新分发/u);
  assert.equal(assertDeclaredCuratedDictionary(recipe), recipe);
  assert.equal(CURATED_DICTIONARIES.length, 2, "the existing CSV recipe remains available");
});

test("the declared recipe rejects changes to release identity, redirect host, and archive member", () => {
  for (const mutation of [
    { downloadUrl: "https://github.com/skywind3000/ECDICT/releases/latest/download/ecdict-mdx-28.zip" },
    { originPattern: "https://*.github.com/*" },
    { downloadRedirectOrigin: "https://*.githubusercontent.com" },
    { downloadSha256: "0".repeat(64) },
    { archive: { ...recipe.archive, entryName: "../dictionary.mdx" } },
    { archive: { ...recipe.archive, entryNameBytesHex: "2e2e2f646963742e6d6478" } }
  ]) {
    assert.throws(() => validateCuratedDictionaryRecipe({ ...recipe, ...mutation }));
  }
  assert.throws(
    () => assertDeclaredCuratedDictionary({ ...recipe }),
    /extension-declared recipe/u
  );
});

test("the download accepts the GitHub release and pinned CDN origins only", async () => {
  for (const url of [recipe.downloadUrl, "https://release-assets.githubusercontent.com/release/test.zip"]) {
    let bytesRead = false;
    await assert.rejects(
      extractPinnedEcdictMdx(responseAt(url, () => { bytesRead = true; }, { redirected: url !== recipe.downloadUrl }), { source: recipe }),
      /size mismatch/u
    );
    assert.equal(bytesRead, true, "the exact reviewed origin should pass origin validation");
  }

  for (const url of [
    "https://github.com.evil.example/releases/download/1.0.28/ecdict-mdx-28.zip",
    "https://api.github.com/releases/assets/123",
    "http://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-mdx-28.zip",
    "https://other.githubusercontent.com/release/test.zip"
  ]) {
    let bytesRead = false;
    await assert.rejects(
      extractPinnedEcdictMdx(responseAt(url, () => { bytesRead = true; }, { redirected: true }), { source: recipe }),
      /must use HTTPS|declared redirect origins/u
    );
    assert.equal(bytesRead, false, "an unapproved redirect must fail before consuming data");
  }
});

test("the MDX extractor fails closed when a response omits its final URL", async () => {
  let bytesRead = false;
  await assert.rejects(
    extractPinnedEcdictMdx(responseAt("", () => { bytesRead = true; }), { source: recipe }),
    /no final URL/u
  );
  assert.equal(bytesRead, false);
});

test("the MDX network request follows the fixed GitHub release redirect and no other recipe changes", async () => {
  const signal = new AbortController().signal;
  const calls = [];
  const response = { ok: true, status: 200 };
  const fetched = await fetchCuratedDictionarySource(recipe, {
    signal,
    fetchImpl(url, options) {
      calls.push({ url, options });
      return response;
    }
  });
  assert.equal(fetched, response);
  assert.deepEqual(calls, [{
    url: recipe.downloadUrl,
    options: {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal
    }
  }]);

  const csv = getCuratedDictionary(CURATED_DICTIONARY_IDS.ECDICT_EN_ZH);
  const csvCalls = [];
  await fetchCuratedDictionarySource(csv, {
    fetchImpl(url, options) {
      csvCalls.push({ url, options });
      return response;
    }
  });
  assert.equal(csvCalls[0].options.redirect, "error");
});

test("the MDX card distinguishes current, repair, reviewed update, and conflicting identity", () => {
  const current = {
    status: "ready",
    curated: {
      recipeId: recipe.id,
      upstreamRevision: recipe.upstreamRevision,
      mdxSha256: recipe.mdx.sha256
    }
  };
  assert.equal(getCuratedMdxInstallPresentation(recipe, null).actionLabel, "下载并安装");
  assert.equal(
    getCuratedMdxInstallPresentation(recipe, current).status,
    "current"
  );
  assert.equal(
    getCuratedMdxInstallPresentation(recipe, current).actionLabel,
    "重新安装"
  );
  assert.equal(
    getCuratedMdxInstallPresentation(recipe, {
      ...current,
      status: "missing"
    }).status,
    "needs-reinstall"
  );
  assert.equal(
    getCuratedMdxInstallPresentation(recipe, {
      ...current,
      curated: { ...current.curated, upstreamRevision: "older-reviewed" }
    }).status,
    "update-available"
  );
  assert.equal(
    getCuratedMdxInstallPresentation(recipe, {
      ...current,
      curated: { ...current.curated, recipeId: "another-recipe" }
    }).status,
    "identity-conflict"
  );
});

function responseAt(url, onRead, { redirected = false } = {}) {
  return {
    ok: true,
    status: 200,
    url,
    redirected,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() {
            onRead();
            return { done: true };
          },
          async cancel() {},
          releaseLock() {}
        };
      }
    }
  };
}
