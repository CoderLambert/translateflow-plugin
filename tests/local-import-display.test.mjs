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
    "本地导入",
    "用户提供 · 未验证",
    "StarDict",
    "版本 / 导入标识 import-v1",
    "4.0 KiB"
  ]);
});
