import test from "node:test";
import assert from "node:assert/strict";

import {
  CURATED_DICTIONARIES,
  CURATED_IMPORTER_TYPES,
  CURATED_RECIPE_SCHEMA_VERSION,
  assertDeclaredCuratedDictionary,
  validateCuratedDictionaryRecipe
} from "../src/shared/curated-dictionaries.js";
import {
  fetchCuratedDictionarySource
} from "../src/background/providers/curated-dictionary-network.js";
import {
  getCuratedInstallPresentation
} from "../src/options/curated-dictionary-ui.js";

const source = CURATED_DICTIONARIES[0];

test("curated recipe registry validates the shipped data-only v1 contract", () => {
  assert.equal(
    source.schemaVersion,
    CURATED_RECIPE_SCHEMA_VERSION
  );
  assert.equal(
    source.importerType,
    CURATED_IMPORTER_TYPES.ECDICT_CSV_V1
  );
  assert.equal(
    validateCuratedDictionaryRecipe(source),
    source
  );
  assert.equal(
    assertDeclaredCuratedDictionary(source),
    source
  );
});

test("curated recipes reject schema, importer and origin mutations", () => {
  assert.throws(
    () => validateCuratedDictionaryRecipe({
      ...source,
      schemaVersion: 2
    }),
    /schemaVersion/
  );
  assert.throws(
    () => validateCuratedDictionaryRecipe({
      ...source,
      importerType: "remote-script-v1"
    }),
    /importer/
  );
  assert.throws(
    () => validateCuratedDictionaryRecipe({
      ...source,
      originPattern: "https://*.example.com/*"
    }),
    /exact HTTPS host/
  );
  assert.throws(
    () => validateCuratedDictionaryRecipe({
      ...source,
      downloadUrl: "https://example.com/ecdict.csv"
    }),
    /exact approved origin/
  );
  assert.throws(
    () => assertDeclaredCuratedDictionary({
      ...source
    }),
    /extension-declared recipe/
  );
});

test("curated network provider fetches only the exact declared artifact", async () => {
  const calls = [];
  const response = { ok: true, status: 200 };

  const result = await fetchCuratedDictionarySource(
    source,
    {
      signal: "signal-fixture",
      fetchImpl(url, options) {
        calls.push({ url, options });
        return response;
      }
    }
  );

  assert.equal(result, response);
  assert.deepEqual(calls, [{
    url: source.downloadUrl,
    options: {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: "signal-fixture"
    }
  }]);

  await assert.rejects(
    fetchCuratedDictionarySource(
      {
        ...source,
        downloadUrl: "https://example.com/ecdict.csv"
      },
      {
        fetchImpl() {
          throw new Error("fetch must not run");
        }
      }
    ),
    /extension-declared recipe/
  );
});

test("curated install presentation distinguishes install, current, repair and update", () => {
  assert.deepEqual(
    getCuratedInstallPresentation(source, null),
    {
      status: "not-installed",
      kind: "warning",
      badgeLabel: "上游 / 社区",
      actionLabel: "下载并安装",
      detail:
        "点击后直接从上游下载；TranslateFlow 不镜像该词典内容。"
    }
  );

  assert.equal(
    getCuratedInstallPresentation(source, {
      status: "healthy",
      active: {
        packVersion: source.output.packVersion
      }
    }).actionLabel,
    "重新安装"
  );
  assert.equal(
    getCuratedInstallPresentation(source, {
      status: "needs-reinstall",
      active: {
        packVersion: source.output.packVersion
      }
    }).badgeLabel,
    "需重装"
  );

  const update = getCuratedInstallPresentation(
    source,
    {
      status: "healthy",
      active: {
        packVersion: "2024-older-reviewed"
      }
    }
  );
  assert.equal(update.status, "update-available");
  assert.equal(update.badgeLabel, "可更新");
  assert.equal(update.actionLabel, "更新");
  assert.match(
    update.detail,
    /2024-older-reviewed.*2025-03-28-bc015ed2/u
  );
});
