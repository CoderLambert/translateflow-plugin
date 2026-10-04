import test from "node:test";
import assert from "node:assert/strict";

import { getDictionaryCatalogEntryForRecipe } from "../src/shared/dictionary-catalog-v2.js";
import {
  formatDictionaryBytes,
  getCatalogDictionaryRows,
  getCuratedMdxErrorMessage,
  getDictionaryCompatibilityLabel,
  getDictionaryHealthPresentation,
  getLocalRichDictionaryRows
} from "../src/options/dictionary-library-v2-presentation.js";

const ecdict = getDictionaryCatalogEntryForRecipe("ecdict-en-zh-mdx-curated");

test("Catalog v2 presentation keeps upstream, content and review dates distinct", () => {
  const rows = getCatalogDictionaryRows(ecdict, {
    installedCatalog: { installedVersion: "v1-local" },
    installedVersion: "1.0.28",
    installedSize: 101_000_000,
    entryCount: 3_402_564
  });
  const values = Object.fromEntries(rows.map(({ label, value }) => [label, value]));

  assert.equal(values["信任与来源"], "精选上游 · 非官方");
  assert.equal(values["上游版本"], "1.0.28");
  assert.equal(values["发布日期"], "2017-09-20");
  assert.equal(values["词典内容日期"], "2017-06-03");
  assert.equal(values["兼容性"], "已通过 TranslateFlow 兼容性审核");
  assert.equal(values["兼容性审核日期"], "2026-10-01");
  assert.equal(values["已安装版本"], "1.0.28");
  assert.equal(values["词条"], "3,402,564");
  assert.match(values["内容提示"], /内容日期较早/u);
  assert.match(values["许可与使用条款"], /MIT/u);
  assert.match(values["许可与使用条款"], /CC/u);
  assert.ok(rows.some(({ label, href }) => label === "上游项目" && href === "https://github.com/skywind3000/ECDICT"));
});

test("local compatibility and health states use user-facing explanations", () => {
  assert.deepEqual(getDictionaryCompatibilityLabel({
    status: "partial",
    unsupportedCapabilities: ["mdx.compression.lzo"]
  }), {
    label: "可使用 · 部分功能受限",
    detail: "MDX 使用 LZO 压缩，当前版本无法读取。"
  });
  assert.deepEqual(getDictionaryHealthPresentation("corrupt"), {
    label: "检查失败",
    kind: "error",
    detail: "完整性检查失败；其它词典仍可正常使用。"
  });
  assert.equal(getDictionaryHealthPresentation("missing").label, "文件缺失");
  assert.equal(getDictionaryHealthPresentation("ready").label, "可用");
  assert.equal(formatDictionaryBytes(4_096), "4 KiB");
});

test("user-owned rich MDX keeps local version separate from installation date", () => {
  const { rows } = getLocalRichDictionaryRows({
    status: "ready",
    packVersion: "import-mgj2xio0-12345678",
    installedAt: Date.parse("2026-09-29T00:00:00Z"),
    fileName: "user-book.mdx",
    sourceSize: 8_192
  }, 12_288);
  const values = Object.fromEntries(rows.map(({ label, value }) => [label, value]));

  assert.equal(values["本地安装版本"], "import-mgj2xio0-12345678");
  assert.equal(values["本机安装日期"], "2026-09-29");
  assert.equal(values["本机源文件"], "user-book.mdx");
  assert.equal(values["本机源文件大小"], "8 KiB");
  assert.equal(values["已安装大小"], "12 KiB");
});

test("curated install failures remain distinct and actionable", () => {
  const error = (code, name = "Error") => Object.assign(new Error("private implementation detail"), { code, name });
  assert.match(getCuratedMdxErrorMessage(error("DICTIONARY_PERMISSION_DENIED")), /下载权限未获准/u);
  assert.match(getCuratedMdxErrorMessage(error("ECDICT_DOWNLOAD"), "download"), /无法从上游下载/u);
  assert.match(getCuratedMdxErrorMessage(error("ECDICT_MDX_HASH"), "download"), /与已审核版本不一致/u);
  assert.match(getCuratedMdxErrorMessage(error("RICH_MDICT_PROVENANCE"), "rich-import"), /来源与已审核目录不符/u);
  assert.match(getCuratedMdxErrorMessage(error("MDICT_UNSUPPORTED"), "rich-import"), /暂不支持/u);
  assert.match(getCuratedMdxErrorMessage(error("RICH_MDICT_QUOTA"), "rich-import"), /本地空间不足/u);
  assert.match(getCuratedMdxErrorMessage(error("RICH_MDICT_STORAGE"), "rich-import"), /浏览器暂时无法保存/u);
  assert.match(getCuratedMdxErrorMessage(error("", "AbortError")), /已取消/u);
});
