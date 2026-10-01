import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLocalImportDisplayMetadata,
  publicLocalImportDisplayMetadata
} from "../src/background/packs/local-import-display.js";
import {
  publicPackState
} from "../src/background/packs/snapshot.js";
import {
  installedPackMeta,
  installedPackName
} from "../src/options/installed-pack-ui.js";

test("local import display metadata is bounded and product-facing", () => {
  const display = normalizeLocalImportDisplayMetadata({
    name: "示例英汉词典",
    format: "stardict"
  }, {
    now: () => 1_800_000_000_000
  });

  assert.deepEqual(display, {
    kind: "local-import",
    name: "示例英汉词典",
    format: "stardict",
    formatLabel: "StarDict",
    trust: "user-provided-unverified",
    importedAt: 1_800_000_000_000
  });
  assert.deepEqual(
    publicLocalImportDisplayMetadata(display),
    display
  );
});

test("legacy ECDICT local display metadata migrates to catalog v2 without changing install identity", () => {
  const display = normalizeLocalImportDisplayMetadata({
    kind: "curated-upstream",
    name: "ECDICT 高频英汉",
    format: "ecdict-csv",
    sourceLabel: "ECDICT / skywind3000",
    sourceVersion: "bc015ed2e24a",
    licenseLabel: "MIT（上游仓库）；词条内容来源需按上游说明理解"
  }, { now: () => 1_800_000_000_000 });

  assert.equal(display.catalog.entryId, "ecdict-en-zh-curated");
  assert.equal(display.catalog.sourceVersion, "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b");
  assert.equal(display.catalog.installedVersion, "2025-03-28-bc015ed2");
  assert.equal(display.catalog.contentDate, null);
  assert.equal(display.catalog.reviewedAt, "2026-10-01");
  assert.equal(display.catalog.trustClass, "curated-upstream");

  const legacyState = {
    kind: "curated-upstream",
    name: "ECDICT 高频英汉",
    format: "ecdict-csv",
    formatLabel: "ECDICT CSV",
    trust: "upstream-community",
    sourceLabel: "ECDICT / skywind3000",
    sourceVersion: "bc015ed2e24a",
    licenseLabel: "MIT（上游仓库）；词条内容来源需按上游说明理解",
    importedAt: 1_799_999_000_000
  };
  assert.equal(publicLocalImportDisplayMetadata(legacyState).catalog.entryId, display.catalog.entryId);
  assert.equal(legacyState.sourceVersion, "bc015ed2e24a");
  assert.equal(legacyState.importedAt, 1_799_999_000_000);
});

test("invalid local display metadata fails closed", () => {
  assert.throws(
    () => normalizeLocalImportDisplayMetadata({
      name: "",
      format: "stardict"
    }),
    /display name/
  );
  assert.throws(
    () => normalizeLocalImportDisplayMetadata({
      name: "Dictionary",
      format: "html"
    }),
    /unsupported/
  );
});

test("public pack state exposes display metadata without internal file descriptors", () => {
  const result = publicPackState({
    sourceId: "local-user-import",
    status: "healthy",
    display: {
      kind: "local-import",
      name: "示例英汉词典",
      format: "stardict",
      formatLabel: "StarDict",
      trust: "user-provided-unverified",
      importedAt: 1_800_000_000_000
    },
    active: {
      packId: "local-example",
      packVersion: "import-v1",
      fingerprint: "sha256:" + "a".repeat(64),
      totalBytes: 4096,
      verifiedAt: 1,
      files: [{ path: "entries.dat" }]
    }
  });

  assert.equal(result.display.name, "示例英汉词典");
  assert.equal(result.active.totalBytes, 4096);
  assert.equal(result.active.files, undefined);
});

test("installed dictionary presentation uses human name, trust and size", () => {
  const entry = {
    display: {
      kind: "local-import",
      name: "示例英汉词典",
      formatLabel: "StarDict"
    },
    active: {
      packVersion: "import-v1",
      totalBytes: 4096
    }
  };
  assert.equal(
    installedPackName("local-internal-id", entry, []),
    "示例英汉词典"
  );
  assert.deepEqual(installedPackMeta(entry), [
    "本地导入 · 用户提供 / 未验证",
    "兼容性 当前版本可使用",
    "StarDict",
    "已安装大小 4.0 KiB"
  ]);
});
