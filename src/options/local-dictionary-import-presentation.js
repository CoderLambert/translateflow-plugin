import { userMessageForMdictError } from "./mdict-import-ui.js";
import { userMessageForStarDictError } from "./stardict-import-ui.js";
import { safeFileLabel as safePreflightFileLabel } from "../background/packs/local-dictionary-preflight-contract.js";

export const STATUS_LABELS = Object.freeze({
  supported: "可用",
  partial: "部分可用",
  unsupported: "暂不支持",
  invalid: "文件无效"
});
export const ROUTE_LABELS = Object.freeze({
  "rich-mdict": "MDX 富文本词典",
  "structured-mdict": "MDX 结构化纯文本词典",
  stardict: "StarDict 结构化词典",
  tflex: "TranslateFlow 本地词典",
  none: "无可用安装方式"
});
export const REASON_LABELS = Object.freeze({
  "file_set.duplicate_name": "所选文件中有重名文件，请只保留一份。",
  "file_set.limit_exceeded": "文件数量或总大小超过当前安全上限。",
  "file_set.unrecognized": "无法识别这组文件。请选择 MDX/MDD、完整 StarDict 文件组或 TFLex 文件。",
  "mdx.multiple_dictionaries": "一次只能导入一个 MDX 词典。",
  "mdx.structured_semantics_not_confirmed": "MDX 可默认作为富文本词典使用；只有你确认英文到简体中文的纯文本含义后，才可作为结构化词典导入。",
  "mdx.structured_language_direction_unsupported": "结构化导入目前只接受英文到简体中文方向。",
  "mdx.structured_mdd_not_supported": "带有 MDD 附件的 MDX 只能保留为富文本词典。",
  "mdx.structured_profile_unsupported": "该 MDX 的排版或记录格式不适合结构化导入，可尝试富文本方式。",
  "mdx.capability_not_shipped": "词典包含当前版本尚未完整验证的 MDX 功能。",
  "mdx.capability_unsupported": "该 MDX 使用当前不支持的功能。",
  "mdx.corrupt_or_malformed": "MDX 文件损坏或结构无法读取。",
  "mdx.unsafe_content": "MDX 含有当前安全策略禁止的内容。",
  "mdx.file_too_large": "MDX 超过当前安全大小上限。",
  "mdx.preflight_limit_exceeded": "MDX 检查超过当前安全资源上限。",
  "mdx.preflight_failed": "无法完成 MDX 检查。",
  "mdd.mdx_required": "MDD 需要与 MDX 一起选择，不能单独导入。",
  "mdd.too_many_companions": "MDD 附件数量超过当前支持范围。",
  "mdd.companion_names_ambiguous_or_invalid": "MDD 文件名与 MDX 的附件规则不匹配或存在歧义。",
  "mdd.numbering_not_consecutive": "编号 MDD 必须从 .1.mdd 开始连续排列。",
  "mdd.unassociated_files": "有 MDD 或其它文件无法关联到所选 MDX；请移除这些文件后再试。",
  "mdd.capability_unsupported": "某个 MDD 附件使用当前不支持的功能。",
  "mdd.corrupt_or_malformed": "某个 MDD 附件损坏或结构无法读取。",
  "mdd.file_too_large": "MDD 附件超过当前安全大小上限。",
  "mdd.preflight_limit_exceeded": "MDD 检查超过当前安全资源上限。",
  "mdd.preflight_failed": "无法完成 MDD 检查。",
  "stardict.ifo_missing": "缺少 StarDict .ifo 文件。",
  "stardict.idx_missing": "缺少与 .ifo 同名的 .idx 文件。",
  "stardict.dictionary_data_missing": "缺少与 .ifo 同名的 .dict 或 .dict.dz 正文文件。",
  "stardict.syn_missing": "词典声明包含同义词索引，但缺少 .syn 文件。",
  "stardict.multiple_ifo": "一次只能选择一套 StarDict 词典。",
  "stardict.duplicate_component": "同一套 StarDict 中有重复组件文件。",
  "stardict.ambiguous_dictionary_data": "同时选择了 .dict 和 .dict.dz；请只保留一种正文文件。",
  "stardict.unassociated_files": "有文件不属于这套 StarDict，请移除后再试。",
  "stardict.semantic_recipe_required": "StarDict 格式不表示语言方向，导入前需要你明确确认语义。",
  "stardict.capability_unsupported": "该 StarDict 使用当前不支持的格式。",
  "stardict.corrupt_or_malformed": "StarDict 文件损坏或各文件不匹配。",
  "stardict.unsafe_content": "StarDict 含有当前安全策略禁止的内容。",
  "stardict.preflight_limit_exceeded": "StarDict 检查超过当前安全资源上限。",
  "tflex.duplicate_component": "TFLex 文件组中存在重名组件。",
  "tflex.manifest_missing": "缺少 manifest.json 文件。",
  "tflex.manifest_invalid": "manifest.json 无法读取或格式无效。",
  "tflex.manifest_too_large": "manifest.json 超过当前安全大小上限。",
  "tflex.profile_unsupported": "该 TFLex 文件组与当前读取器不兼容。",
  "tflex.required_files_missing": "缺少 index.dat 或 entries.dat。",
  "tflex.full_validation_deferred": "预检只识别 TFLex 声明；完整哈希、索引和词条校验会在安装时执行。",
  "tflex.importer_verifies_hashes_and_records": "安装器会再次校验完整文件、索引与词条。",
  "tflex.unassociated_files": "所选文件中有不属于 TFLex 文件组的项目，请移除。"
});

export const CAPABILITY_LABELS = Object.freeze({
  "mdx.engine.v2": "MDX 2",
  "mdx.required-engine-version": "MDX 所需引擎版本",
  "mdx.encoding.utf8": "UTF-8",
  "mdx.encoding.utf16le": "UTF-16LE",
  "mdx.encoding.gbk": "GBK 编码（当前不支持）",
  "mdx.encoding.big5": "Big5 编码（当前不支持）",
  "mdx.encoding.gb18030": "GB18030 编码（当前不支持）",
  "mdx.encoding.other": "其它编码（当前不支持）",
  "mdx.encryption.key-info-v2": "MDX 密钥信息加密",
  "mdx.encryption.password-protected": "MDX 密码保护（当前不支持）",
  "mdx.encryption.record": "MDX 记录加密（当前不支持）",
  "mdx.key-info.compression-zlib": "MDX 索引压缩",
  "mdx.compression.none": "未压缩记录块",
  "mdx.compression.zlib": "zlib 记录块",
  "mdx.compression.lzo": "LZO 压缩（当前不支持）",
  "mdx.compression.unknown": "未知记录压缩（当前不支持）",
  "mdx.record.html": "HTML 记录",
  "mdx.record.text": "纯文本记录",
  "mdx.record-format.other": "其它记录格式（当前不支持）",
  "mdx.style-sheet": "样式表",
  "mdx.compact-records": "紧凑记录",
  "mdx.alias-link": "词头别名链接（当前不支持）",
  "mdd.engine.v2": "MDD 2",
  "mdd.required-engine-version": "MDD 所需引擎版本",
  "mdd.encoding.utf8": "MDD UTF-8（当前不支持）",
  "mdd.encoding.utf16le": "MDD UTF-16LE",
  "mdd.encoding.gbk": "MDD GBK 编码（当前不支持）",
  "mdd.encoding.big5": "MDD Big5 编码（当前不支持）",
  "mdd.encoding.gb18030": "MDD GB18030 编码（当前不支持）",
  "mdd.encoding.other": "MDD 其它编码（当前不支持）",
  "mdd.encryption.key-info-v2": "MDD 密钥信息加密",
  "mdd.encryption.password-protected": "MDD 密码保护（当前不支持）",
  "mdd.encryption.record": "MDD 资源加密（当前不支持）",
  "mdd.compression.none": "MDD 未压缩资源",
  "mdd.compression.zlib": "MDD zlib 资源",
  "mdd.compression.lzo": "MDD LZO 压缩（当前不支持）",
  "mdd.compression.unknown": "MDD 未知压缩（当前不支持）",
  "mdd.resource.path-normalization": "MDD 资源路径标准化",
  "mdd.resource.format-other": "MDD 其它资源格式",
  "rich.html-structure": "富文本 HTML 结构",
  "rich.inline-style": "内联样式（安全过滤后显示）",
  "rich.style-sheet-reference": "词典样式表引用（安全过滤后显示）",
  "rich.compact-style-marker": "紧凑样式标记",
  "rich.relative-resource-path": "本地相对资源引用",
  "rich.other-uri-scheme": "其它资源链接格式（当前不处理）",
  "rich.unusual-resource-extension": "非典型资源文件格式（当前不处理）",
  "rich.entry-reference": "词典内部词条引用",
  "rich.sound-reference": "词典内部音频引用",
  "rich.local-anchor": "本地页内链接",
  "rich.remote-url": "远程资源链接（不会自动请求）",
  "rich.image-reference": "本地图片引用",
  "rich.audio-reference": "本地音频引用"
});
export const CAPABILITY_REASON_LABELS = Object.freeze({
  "mdx.compression.lzo": "该 MDX 使用 LZO 压缩；当前无法读取这种压缩方式。",
  "mdd.compression.lzo": "该 MDD 使用 LZO 压缩；当前无法读取这种压缩方式。",
  "mdx.encoding.gbk": "该 MDX 使用 GBK 编码，当前版本无法可靠读取。",
  "mdx.encoding.big5": "该 MDX 使用 Big5 编码，当前版本无法可靠读取。",
  "mdx.encoding.gb18030": "该 MDX 使用 GB18030 编码，当前版本无法可靠读取。",
  "mdd.encoding.gbk": "该 MDD 使用 GBK 编码，当前版本无法可靠读取。",
  "mdd.encoding.big5": "该 MDD 使用 Big5 编码，当前版本无法可靠读取。",
  "mdd.encoding.gb18030": "该 MDD 使用 GB18030 编码，当前版本无法可靠读取。",
  "mdx.encryption.password-protected": "该 MDX 使用密码保护；当前版本不支持解密。",
  "mdx.encryption.record": "该 MDX 的记录已加密；当前版本不支持解密。",
  "mdd.encryption.password-protected": "该 MDD 使用密码保护；当前版本不支持解密。",
  "mdd.encryption.record": "该 MDD 的资源已加密；当前版本不支持解密。",
  "mdx.required-engine-version": "词典要求的 MDX 引擎版本与当前支持范围不匹配。",
  "mdd.required-engine-version": "附件要求的 MDD 引擎版本与当前支持范围不匹配。",
  "rich.remote-url": "词典包含远程资源链接；TranslateFlow 不会自动请求这些地址。",
  "rich.other-uri-scheme": "词典包含当前不会处理的资源链接格式。",
  "mdx.unsafe_content": "词典记录包含脚本、危险链接或其他当前禁止的内容，已拒绝导入。",
  "stardict.unsafe_content": "词典内容触发当前安全限制，已拒绝导入。"
});

export function findDuplicateCandidate(result, installedCandidates, selectedFiles) {
    const packId = result.identity.family === "tflex" ? tflexPackId(result) : "";
    if (packId) {
      const samePack = installedCandidates.find((item) => item.packId === packId);
      if (samePack) return samePack;
    }
    const title = normalizeIdentityText(result.identity.displayTitle || selectedFiles[0]?.name || "");
    if (!title) return null;
    return installedCandidates.find((item) => normalizeIdentityText(item.name) === title) || null;
  }

export function resolveAssociatedMddFiles(associatedMdd, selectedFiles) {
  const resolved = [];
  const used = new Set();
  for (const item of associatedMdd || []) {
    const matches = Array.from(selectedFiles || []).filter((file) =>
      !used.has(file) && safePreflightFileLabel(file.name) === item.fileName
    );
    if (matches.length !== 1) return null;
    used.add(matches[0]);
    resolved.push(matches[0]);
  }
  return resolved;
}

export function getLocalPreflightView(result, selectedFiles, installedCandidates) {
  const status = result.compatibility.status;
  const rows = [
    { label: "检查结果", value: STATUS_LABELS[status] || STATUS_LABELS.invalid },
    { label: "识别类型", value: familyLabel(result.identity.family) },
    { label: "安装方式", value: ROUTE_LABELS[result.route.importer] || ROUTE_LABELS.none },
    ...(result.identity.displayTitle ? [{ label: "词典名称", value: result.identity.displayTitle }] : []),
    ...(Number.isSafeInteger(result.estimates.entryCount) ? [{ label: "词条数量", value: result.estimates.entryCount.toLocaleString() }] : []),
    { label: "所选文件", value: `${selectedFiles.length} 个 · ${formatBytes(result.estimates.sourceBytes)}` },
    { label: "本机占用估算", value: `${formatBytes(result.estimates.sourceBytes)} 文件数据；建立索引后可能增加` },
    { label: "来源与信任", value: "用户选择的本机文件 · 来源与再分发权未经 TranslateFlow 验证" }
  ];
  const files = selectedFiles.map((file) => safeFileLabel(file.name));
  if (files.length) rows.push({ label: "文件清单", value: files.join("、") });
  const capabilities = result.compatibility.capabilitiesPresent || [];
  if (capabilities.length) rows.push({ label: "识别格式", value: capabilities.map((item) => CAPABILITY_LABELS[item] || "其他词典功能").join("、") });
  const encodings = capabilities.filter((item) => /\.encoding\./u.test(item)).map((item) => CAPABILITY_LABELS[item] || "其它编码");
  if (encodings.length) rows.push({ label: "文本编码", value: encodings.join("、") });
  if (result.resources.associatedMdd.length) {
    rows.push({ label: "将关联的 MDD", value: result.resources.associatedMdd.map((item) => `${item.fileName}（${Number(item.entryCount || 0).toLocaleString()} 项）`).join("、") });
  }
  if (result.resources.missingCompanionHints.length) rows.push({ label: "缺少文件", value: result.resources.missingCompanionHints.join("、") });
  if (result.resources.unassociatedFiles.length) rows.push({ label: "未能关联", value: result.resources.unassociatedFiles.join("、") });
  if (isTflexOverInstallLimit(selectedFiles)) rows.push({ label: "文件大小限制", value: "TFLex 安装单个文件最多 64 MiB，文件组总计最多 128 MiB。" });
  const reasons = [
    ...(result.compatibility.reasons || []).map((item) => ({ ...item, warning: false })),
    ...(result.compatibility.warnings || []).map((item) => ({ ...item, warning: true }))
  ];
  for (const item of reasons) rows.push({ label: item.warning ? "提示" : "原因", value: describeReason(item) });
  const unsupported = (result.compatibility.unsupportedCapabilities || []).map((id) => CAPABILITY_LABELS[id] || "其他尚未支持的词典功能");
  if (unsupported.length) rows.push({ label: "未支持功能", value: unsupported.join("、") });

  const needsSemantic = result.identity.family === "stardict" ||
    (result.identity.family.startsWith("mdict") && (result.compatibility.warnings || []).some((item) => item.code === "mdx.structured_semantics_not_confirmed"));
  const semanticText = result.identity.family === "stardict"
    ? "我确认这是英文词头 → 简体中文纯文本释义。StarDict 格式本身不说明语言方向。"
    : "我确认纯文本记录表示英文词头 → 简体中文释义；将作为结构化词典导入。未勾选时 MDX 保持为富文本词典。";
  const needsLimitations = status === "partial" && result.route.importer !== "none";
  const limitationsText = result.identity.family === "tflex"
    ? "我知道安装前会重新完整校验所有文件与词条。"
    : "我已阅读上述兼容说明，仍按显示的安装方式继续。";
  const duplicate = findDuplicateCandidate(result, installedCandidates, selectedFiles);
  const sameTflexId = duplicate && result.identity.family === "tflex" && duplicate.packId && duplicate.packId === tflexPackId(result);
  const duplicateText = sameTflexId
    ? `确认更新已安装的同一 TFLex 包“${safeFileLabel(duplicate.name)}”？${describeDuplicateSources(duplicate, selectedFiles)} 更新前会完整校验所有文件；校验或保存失败时，当前已安装版本与查询会保持可用。文件声明身份尚未验证。`
    : duplicate ? `可能与已安装的“${safeFileLabel(duplicate.name)}”重复（依据名称/文件声明提示，文件身份未验证）。${describeDuplicateSources(duplicate, selectedFiles)} 如仍要安装，请明确选择作为另一份独立词典保留；不会覆盖已安装词典。` : "";
  return { rows, needsSemantic, semanticText, needsLimitations, limitationsText, duplicate, duplicateText };
}

export function renderLocalPreflight({ result, selectedFiles, installedCandidates, summary, semanticLabel, semanticCheck, semanticText, limitationsLabel, limitationsCheck, limitationsText, duplicateLabel, duplicateCheck, duplicateText, updateImportEnabled }) {
    summary.replaceChildren();
    const status = result.compatibility.status;
    appendSummaryLine(summary, "检查结果", STATUS_LABELS[status] || STATUS_LABELS.invalid);
    appendSummaryLine(summary, "识别类型", familyLabel(result.identity.family));
    appendSummaryLine(summary, "安装方式", ROUTE_LABELS[result.route.importer] || ROUTE_LABELS.none);
    if (result.identity.displayTitle) appendSummaryLine(summary, "词典名称", result.identity.displayTitle);
    if (Number.isSafeInteger(result.estimates.entryCount)) appendSummaryLine(summary, "词条数量", result.estimates.entryCount.toLocaleString());
    appendSummaryLine(summary, "所选文件", `${selectedFiles.length} 个 · ${formatBytes(result.estimates.sourceBytes)}`);
    appendSummaryLine(summary, "本机占用估算", `${formatBytes(result.estimates.sourceBytes)} 文件数据；建立索引后可能增加`);
    appendSummaryLine(summary, "来源与信任", "用户选择的本机文件 · 来源与再分发权未经 TranslateFlow 验证");
    const files = selectedFiles.map((file) => safeFileLabel(file.name));
    if (files.length) appendSummaryLine(summary, "文件清单", files.join("、"));
    const capabilities = result.compatibility.capabilitiesPresent || [];
    if (capabilities.length) appendSummaryLine(summary, "识别格式", capabilities.map((item) => CAPABILITY_LABELS[item] || "其他词典功能").join("、"));
    const encodings = capabilities.filter((item) => /\.encoding\./u.test(item)).map((item) => CAPABILITY_LABELS[item] || "其它编码");
    if (encodings.length) appendSummaryLine(summary, "文本编码", encodings.join("、"));
    if (result.resources.associatedMdd.length) {
      const attached = result.resources.associatedMdd.map((item) => `${item.fileName}（${Number(item.entryCount || 0).toLocaleString()} 项）`);
      appendSummaryLine(summary, "将关联的 MDD", attached.join("、"));
    }
    if (result.resources.missingCompanionHints.length) appendSummaryLine(summary, "缺少文件", result.resources.missingCompanionHints.join("、"));
    if (result.resources.unassociatedFiles.length) appendSummaryLine(summary, "未能关联", result.resources.unassociatedFiles.join("、"));
    if (isTflexOverInstallLimit(selectedFiles)) appendSummaryLine(summary, "文件大小限制", "TFLex 安装单个文件最多 64 MiB，文件组总计最多 128 MiB。");
    const reasons = [
      ...(result.compatibility.reasons || []).map((item) => ({ ...item, warning: false })),
      ...(result.compatibility.warnings || []).map((item) => ({ ...item, warning: true }))
    ];
    for (const item of reasons) appendSummaryLine(summary, item.warning ? "提示" : "原因", describeReason(item));
    const missingCapabilityLabels = (result.compatibility.unsupportedCapabilities || []).map((id) => CAPABILITY_LABELS[id] || "其他尚未支持的词典功能");
    if (missingCapabilityLabels.length) appendSummaryLine(summary, "未支持功能", missingCapabilityLabels.join("、"));

    const needsSemantic = result.identity.family === "stardict" ||
      (result.identity.family.startsWith("mdict") && (result.compatibility.warnings || []).some((item) => item.code === "mdx.structured_semantics_not_confirmed"));
    semanticLabel.hidden = !needsSemantic;
    semanticCheck.disabled = !needsSemantic;
    if (result.identity.family === "stardict") {
      semanticText.textContent = "我确认这是英文词头 → 简体中文纯文本释义。StarDict 格式本身不说明语言方向。";
    } else if (needsSemantic) {
      semanticText.textContent = "我确认纯文本记录表示英文词头 → 简体中文释义；将作为结构化词典导入。未勾选时 MDX 保持为富文本词典。";
    }
    const canContinuePartial = status === "partial" && result.route.importer !== "none";
    limitationsLabel.hidden = !canContinuePartial;
    limitationsCheck.disabled = !canContinuePartial;
    limitationsText.textContent = result.identity.family === "tflex"
      ? "我知道安装前会重新完整校验所有文件与词条。"
      : "我已阅读上述兼容说明，仍按显示的安装方式继续。";
    const duplicate = findDuplicateCandidate(result, installedCandidates, selectedFiles);
    duplicateLabel.hidden = !duplicate;
    duplicateCheck.disabled = !duplicate;
    const sameTflexId = duplicate && result.identity.family === "tflex" && duplicate.packId && duplicate.packId === tflexPackId(result);
    if (sameTflexId) {
      duplicateText.textContent = `确认更新已安装的同一 TFLex 包“${safeFileLabel(duplicate.name)}”？${describeDuplicateSources(duplicate, selectedFiles)} 更新前会完整校验所有文件；校验或保存失败时，当前已安装版本与查询会保持可用。文件声明身份尚未验证。`;
    } else {
      duplicateText.textContent = duplicate
        ? `可能与已安装的“${safeFileLabel(duplicate.name)}”重复（依据名称/文件声明提示，文件身份未验证）。${describeDuplicateSources(duplicate, selectedFiles)} 如仍要安装，请明确选择作为另一份独立词典保留；不会覆盖已安装词典。`
        : "";
    }
    updateImportEnabled();
  }

export function appendSummaryLine(container, label, value) {
  const row = document.createElement("div");
  const key = document.createElement("strong");
  key.textContent = label;
  const text = document.createElement("span");
  text.textContent = String(value || "");
  row.append(key, text);
  container.appendChild(row);
}

export function describeReason(item) {
  return CAPABILITY_REASON_LABELS[item.capability] || REASON_LABELS[item.code] || "此文件组存在需要注意的兼容情况。";
}

export function familyLabel(family) {
  if (family === "mdict-rich") return "MDX · 富文本";
  if (family === "mdict-structured") return "MDX · 纯文本结构化";
  if (family === "stardict") return "StarDict";
  if (family === "tflex") return "TranslateFlow TFLex";
  return "未识别";
}

export function tflexPackId(result) {
  return result.identity.hints?.find((hint) => hint.kind === "tflex-pack-identity")?.packId || "";
}

export function isTflexOverInstallLimit(files) {
  const tflexFiles = Array.from(files || []).filter((file) => /^(?:manifest\.json|index\.dat|entries\.dat)$/iu.test(file.name));
  const total = tflexFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
  return tflexFiles.some((file) => file.size > 64 * 1024 * 1024) || total > 128 * 1024 * 1024;
}

export function normalizeIdentityText(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function fileBaseName(name) {
  return safeFileLabel(name || "词典").replace(/\.mdx$/iu, "");
}

export function safeFileLabel(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[\\/]/gu, "_")
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120) || "未命名文件";
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function describeDuplicateSources(installed, selectedFiles) {
  const incomingNames = Array.from(selectedFiles || []).slice(0, 16).map((file) => safeFileLabel(file?.name));
  const incomingSize = Array.from(selectedFiles || []).reduce((sum, file) => sum + Math.max(0, Number(file?.size) || 0), 0);
  const installedNames = Array.isArray(installed?.sourceFiles)
    ? installed.sourceFiles.slice(0, 16).map(safeFileLabel)
    : installed?.fileName ? [safeFileLabel(installed.fileName)] : [];
  const installedDetails = [
    installed?.version ? `版本 ${safeFileLabel(installed.version)}` : "",
    installedNames.length ? `源文件 ${installedNames.join("、")}` : "源文件名称未知",
    Number.isFinite(Number(installed?.sourceSize)) && Number(installed.sourceSize) > 0
      ? `大小 ${formatBytes(installed.sourceSize)}` : "大小未知"
  ].filter(Boolean).join(" · ");
  return `已安装：${installedDetails}。当前选择：${incomingNames.join("、") || "文件名未知"} · ${formatBytes(incomingSize)}。`;
}

export function importProgressLabel(phase) {
  const labels = {
    preflight: "检查本机存储",
    read: "读取所选文件",
    worker: "验证并转换词典",
    convert: "转换词条",
    stage: "安全暂存文件",
    index: "建立受限查询索引",
    "store-source": "保存本地源文件",
    "store-index": "保存本地查询索引",
    commit: "后台完整复核并启用",
    done: "完成"
  };
  return labels[phase] || "处理中…";
}

export function userMessage(error, route) {
  if (error?.name === "AbortError") return "导入已取消；原有词典保持不变。";
  if (route === "structured-mdict") return userMessageForMdictError(error);
  if (route === "stardict") return userMessageForStarDictError(error);
  if (error?.code === "RICH_MDD_INPUT") return "MDD 文件名无法与 MDX 安全关联，原有附件保持不变。";
  if (["RICH_MDD_LIMIT", "RICH_MDD_QUOTA", "RICH_MDICT_LIMIT", "RICH_MDICT_QUOTA", "PACK_QUOTA"].includes(error?.code)) return "词典超过当前安全大小或本机存储不足；没有启用部分导入内容。";
  if (/CORRUPT|HASH|UNSUPPORTED|INVALID/iu.test(String(error?.code || ""))) return "文件完整检查未通过，未安装词典或更改现有内容。请检查文件后重试。";
  return error?.message || "词典在完整验证或保存时失败；现有词典保持不变。";
}

export function setPageStatus(message, isError = false) {
  const target = document.getElementById("status");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("error", Boolean(isError));
}
