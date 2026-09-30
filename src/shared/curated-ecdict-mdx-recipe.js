export const ECDICT_MDX_RECIPE_ID = "ecdict-en-zh-mdx-curated";
export const ECDICT_MDX_IMPORTER_TYPE = "ecdict-mdx-zip-v1";

export const ECDICT_MDX_RECIPE = Object.freeze({
  schemaVersion: 1,
  id: ECDICT_MDX_RECIPE_ID,
  label: "ECDICT 简明英汉增强版",
  description:
    "从 ECDICT 1.0.28 上游 Release 下载 2017 年 MDX 词典，在本机安全导入为独立富文本词典。",
  trustClass: "curated-upstream",
  importerType: ECDICT_MDX_IMPORTER_TYPE,
  displayFormat: "mdx",
  publisher: "ECDICT / skywind3000",
  upstreamRepository: "https://github.com/skywind3000/ECDICT",
  upstreamRevision: "1.0.28",
  sourceLicenseLabel:
    "仓库许可证为 MIT；MDX 描述另称 MIT / CC，但未注明 CC 版本",
  sourceLicenseUrl:
    "https://github.com/skywind3000/ECDICT/blob/1.0.28/LICENSE",
  sourceLicenseNotice:
    "MDX 内嵌描述写有 MIT / CC 双协议，但没有给出 Creative Commons 版本。本项目不重新分发该词典；下载由用户直接从上游发起。",
  originPattern: "https://github.com/*",
  downloadRedirectOrigin: "https://release-assets.githubusercontent.com",
  downloadUrl:
    "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-mdx-28.zip",
  downloadBytes: 97_755_340,
  downloadSha256:
    "b06a72a0cfc37485a0466ee62fb43137559ea75eea147d8b7715142faca2229f",
  downloadSha256Authority: "observed-post-download",
  sourceFormat: "ECDICT MDX (ZIP)",
  languageDirection: "en -> zh-CN",
  knownLimitations: Object.freeze([
    "词典内容日期为 2017-06-03，可能缺少后续词汇和修订。",
    "此 Release ZIP 只包含 MDX，不含 MDD 音频或图片资源。",
    "富文本按 TranslateFlow 的安全预览规则显示，不执行词典中的脚本或远程资源。"
  ]),
  archive: Object.freeze({
    format: "zip",
    fileCount: 1,
    maxArchiveBytes: 100_000_000,
    maxExpandedBytes: 100_000_000,
    maxFileBytes: 100_000_000,
    maxCompressionRatio: 20,
    entryName: "简明英汉字典增强版.mdx",
    entryNameBytesHex:
      "bcf2c3f7d3a2babad7d6b5e4d4f6c7bfb0e62e6d6478",
    entryBytes: 97_786_525,
    entrySha256:
      "275e71b58fd359bfe649af1cbee533ea81770bdbc53ec4a34567f84720a5751b",
    nestedArchives: 0
  }),
  mdx: Object.freeze({
    fileName: "简明英汉字典增强版.mdx",
    bytes: 97_786_525,
    sha256:
      "275e71b58fd359bfe649af1cbee533ea81770bdbc53ec4a34567f84720a5751b",
    entryCount: 3_402_564,
    title: "简明英汉字典增强版",
    descriptionDate: "2017-06-03"
  }),
  output: Object.freeze({
    recipeId: ECDICT_MDX_RECIPE_ID,
    packId: "rich-mdict-18500000-0000-4000-8000-000000000028",
    sourceVersion: "1.0.28"
  })
});

export function validateEcdictMdxRecipe(source) {
  if (
    source.id !== ECDICT_MDX_RECIPE_ID ||
    source.upstreamRevision !== "1.0.28" ||
    source.importerType !== ECDICT_MDX_IMPORTER_TYPE ||
    source.sourceFormat !== "ECDICT MDX (ZIP)" ||
    source.displayFormat !== "mdx" ||
    source.languageDirection !== "en -> zh-CN" ||
    source.originPattern !== "https://github.com/*" ||
    source.downloadRedirectOrigin !==
      "https://release-assets.githubusercontent.com" ||
    source.downloadUrl !==
      "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-mdx-28.zip" ||
    source.downloadBytes !== 97_755_340 ||
    source.downloadSha256 !==
      "b06a72a0cfc37485a0466ee62fb43137559ea75eea147d8b7715142faca2229f" ||
    source.downloadSha256Authority !== "observed-post-download"
  ) {
    throw new Error("ECDICT MDX curated recipe is not the reviewed release lock.");
  }
  requireSha256(source.downloadSha256, "ECDICT archive SHA-256");
  requireText(source.sourceLicenseNotice, 600, "source license notice");

  const archive = source.archive;
  const mdx = source.mdx;
  if (
    !archive || archive.format !== "zip" || archive.fileCount !== 1 ||
    archive.entryName !== "简明英汉字典增强版.mdx" ||
    archive.entryNameBytesHex !==
      "bcf2c3f7d3a2babad7d6b5e4d4f6c7bfb0e62e6d6478" ||
    archive.entryBytes !== 97_786_525 ||
    archive.entrySha256 !==
      "275e71b58fd359bfe649af1cbee533ea81770bdbc53ec4a34567f84720a5751b" ||
    archive.nestedArchives !== 0 ||
    !mdx || mdx.fileName !== archive.entryName ||
    mdx.bytes !== archive.entryBytes ||
    mdx.sha256 !== archive.entrySha256 ||
    mdx.entryCount !== 3_402_564 ||
    mdx.title !== "简明英汉字典增强版" ||
    mdx.descriptionDate !== "2017-06-03" ||
    source.output?.recipeId !== source.id ||
    source.output?.sourceVersion !== source.upstreamRevision ||
    !/^rich-mdict-[a-f0-9-]{36}$/u.test(String(source.output?.packId || ""))
  ) {
    throw new Error("ECDICT MDX archive lock is invalid.");
  }
  requireSha256(archive.entrySha256, "ECDICT MDX SHA-256");
  requireSha256(mdx.sha256, "ECDICT MDX SHA-256");
  for (const [key, value] of Object.entries({
    maxArchiveBytes: archive.maxArchiveBytes,
    maxExpandedBytes: archive.maxExpandedBytes,
    maxFileBytes: archive.maxFileBytes
  })) {
    requirePositiveInteger(value, "ECDICT ZIP " + key);
  }
  if (
    source.downloadBytes > archive.maxArchiveBytes ||
    archive.entryBytes > archive.maxExpandedBytes ||
    archive.entryBytes > archive.maxFileBytes ||
    !Number.isFinite(archive.maxCompressionRatio) ||
    archive.maxCompressionRatio < 1 ||
    archive.maxCompressionRatio > 100
  ) {
    throw new Error("ECDICT ZIP extraction limits are invalid.");
  }
  if (!Array.isArray(source.knownLimitations) ||
      source.knownLimitations.length < 1 ||
      source.knownLimitations.some((item) =>
        typeof item !== "string" || item.length > 300
      )) {
    throw new Error("ECDICT MDX limitations must be stated.");
  }
  return source;
}

function requireText(value, maximum, label) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error("Curated dictionary " + label + " is invalid.");
  }
}

function requireSha256(value, label) {
  if (!/^[a-f0-9]{64}$/u.test(String(value || ""))) {
    throw new Error("Curated dictionary " + label + " is invalid.");
  }
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Curated dictionary " + label + " is invalid.");
  }
}
