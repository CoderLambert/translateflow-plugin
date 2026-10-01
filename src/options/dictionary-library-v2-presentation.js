const TRUST_LABELS = Object.freeze({
  "curated-upstream": "精选上游 · 非官方",
  official: "官方",
  "user-provided-unverified": "本地导入 · 用户词典"
});

const COMPATIBILITY_LABELS = Object.freeze({
  "reviewed-compatible": "已通过 TranslateFlow 兼容性审核",
  "reviewed-partial": "已审核 · 可用但部分功能受限",
  "reviewed-incompatible": "已审核 · 当前不支持",
  "not-reviewed": "尚未完成兼容性审核",
  supported: "当前版本可使用",
  partial: "可使用 · 部分功能受限",
  unsupported: "当前版本暂不支持",
  invalid: "文件无法读取"
});

const CAPABILITY_LABELS = Object.freeze({
  "mdx.compression.lzo": "词典使用 LZO 压缩，当前版本无法读取。",
  "mdx.encoding.gbk": "词典使用 GBK 编码，当前版本无法读取。",
  "mdx.encoding.big5": "词典使用 Big5 编码，当前版本无法读取。",
  "mdx.encoding.gb18030": "词典使用 GB18030 编码，当前版本无法读取。",
  "mdx.engine.v1": "词典使用 MDX 1 格式，当前版本无法读取。",
  "mdd.compression.lzo": "附件使用 LZO 压缩，当前版本无法读取。",
  "mdd.encoding.gbk": "附件使用 GBK 编码，当前版本无法读取。",
  "mdd.encoding.big5": "附件使用 Big5 编码，当前版本无法读取。"
});

export function getCatalogDictionaryRows(entry, {
  installedCatalog,
  installedVersion = "",
  installedSize,
  entryCount,
  resourceCount,
  resourceBytes,
  installedSourceFileName = "",
  installedSourceSize = 0,
  includeDownload = true
} = {}) {
  if (!entry || typeof entry !== "object") return [];
  const artifact = Array.isArray(entry.artifacts) ? entry.artifacts[0] : null;
  const rows = [
    { label: "信任与来源", value: trustLabel(entry.trustClass) },
    { label: "发布方", value: entry.identity?.publisher || entry.source?.attribution || "来源未记录" },
    { label: "语言方向", value: entry.language?.directionLabel || "未记录" },
    { label: "格式", value: formatCatalogArtifacts(entry.artifacts) },
    { label: "上游版本", value: versionValue(entry.version?.sourceVersion) },
    { label: "发布日期", value: dateValue(entry.version?.releaseDate) },
    { label: "词典内容日期", value: dateValue(entry.version?.contentDate, "内容日期未知") },
    {
      label: "兼容性",
      value: compatibilityLabel(entry.compatibility?.status)
    },
    { label: "兼容性审核日期", value: dateValue(entry.compatibility?.reviewedAt) },
    { label: "上游维护状态", value: maintenanceLabel(entry.version?.maintenanceStatus) }
  ];

  if (includeDownload && Number.isSafeInteger(artifact?.expectedBytes)) {
    rows.push({ label: "下载大小", value: formatDictionaryBytes(artifact.expectedBytes) });
  }
  if (isExplicitlyOldContent(entry.version?.contentDate)) {
    rows.push({
      label: "内容提示",
      value: "内容日期较早；适合作为大词量兼容或补充词典，不代表持续更新或内容推荐。"
    });
  }
  if (Number.isSafeInteger(Number(entryCount)) && Number(entryCount) > 0) {
    rows.push({ label: "词条", value: Number(entryCount).toLocaleString() });
  }
  if (installedCatalog?.installedVersion || installedVersion) {
    rows.push({
      label: "已安装版本",
      value: installedVersionValue(
        installedVersion || installedCatalog.installedVersion,
        entry.version?.sourceVersion
      )
    });
  }
  if (Number.isSafeInteger(Number(installedSize)) && Number(installedSize) > 0) {
    rows.push({ label: "已安装大小", value: formatDictionaryBytes(Number(installedSize)) });
  }
  if (installedSourceFileName) {
    rows.push({ label: "本机源文件", value: safeDictionaryFileName(installedSourceFileName) });
  }
  if (Number.isSafeInteger(Number(installedSourceSize)) && Number(installedSourceSize) > 0) {
    rows.push({ label: "本机源文件大小", value: formatDictionaryBytes(Number(installedSourceSize)) });
  }
  if (resourceCount !== undefined) {
    const count = Math.max(0, Number(resourceCount) || 0);
    const bytes = Math.max(0, Number(resourceBytes) || 0);
    rows.push({
      label: "本地附件",
      value: count
        ? `${count} 个 MDD 文件${bytes ? ` · ${formatDictionaryBytes(bytes)}` : ""}`
        : "此版本未附带 MDD 文件"
    });
  }
  if (entry.source?.licenseLabel) {
    rows.push({ label: "许可与使用条款", value: entry.source.licenseLabel });
  }
  if (entry.source?.homepage) {
    rows.push({ label: "上游项目", value: "访问上游项目", href: entry.source.homepage });
  }
  if (entry.source?.licenseUrl) {
    rows.push({ label: "许可说明", value: "查看上游许可说明", href: entry.source.licenseUrl });
  }
  return rows;
}

export function renderDictionaryMetadata(container, rows, { className = "dictionary-v2-metadata" } = {}) {
  if (!container || !Array.isArray(rows) || !rows.length) return null;
  const list = document.createElement("dl");
  list.className = className;
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "dictionary-v2-metadata-item";
    const term = document.createElement("dt");
    term.textContent = String(row.label || "");
    const description = document.createElement("dd");
    if (row.href) {
      const link = document.createElement("a");
      link.href = row.href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = String(row.value || "");
      description.appendChild(link);
    } else {
      description.textContent = String(row.value || "");
    }
    item.append(term, description);
    list.appendChild(item);
  }
  container.appendChild(list);
  return list;
}

export function renderCatalogLimitations(container, entry) {
  const notes = [
    ...(Array.isArray(entry?.source?.legalLimitations) ? entry.source.legalLimitations : []),
    ...(Array.isArray(entry?.knownLimitations) ? entry.knownLimitations.map((item) => item.description) : [])
  ].filter((item) => typeof item === "string" && item.trim()).slice(0, 16);
  if (!container || !notes.length) return null;
  const details = document.createElement("details");
  details.className = "dictionary-v2-limitations";
  const summary = document.createElement("summary");
  summary.textContent = "来源与使用说明";
  const list = document.createElement("ul");
  for (const note of notes) {
    const item = document.createElement("li");
    item.textContent = note;
    list.appendChild(item);
  }
  details.append(summary, list);
  container.appendChild(details);
  return details;
}

export function getDictionaryCompatibilityLabel(value) {
  if (typeof value === "string") return compatibilityLabel(value);
  const compatibility = value && typeof value === "object" ? value : {};
  const status = compatibility.status || compatibility.result || "";
  const base = compatibilityLabel(status);
  const unsupported = Array.isArray(compatibility.unsupportedCapabilities)
    ? compatibility.unsupportedCapabilities.map((id) => CAPABILITY_LABELS[id] || "此词典包含当前版本尚不支持的功能。")
    : [];
  const limitations = Array.isArray(compatibility.knownLimitations)
    ? compatibility.knownLimitations.filter((item) => typeof item === "string")
    : [];
  const detail = [...new Set([...unsupported, ...limitations])].slice(0, 4).join(" ");
  return { label: base, detail };
}

export function renderLocalRichDictionaryMetadata(container, dictionary, installedBytes) {
  const { rows, detail: compatibilityDetail } = getLocalRichDictionaryRows(dictionary, installedBytes);
  renderDictionaryMetadata(container, rows);
  if (!compatibilityDetail) return null;
  const detail = document.createElement("small");
  detail.className = "dictionary-pack-detail";
  detail.textContent = compatibilityDetail;
  container.appendChild(detail);
  return detail;
}

export function getLocalRichDictionaryRows(dictionary = {}, installedBytes = 0) {
  const compatibility = getDictionaryCompatibilityLabel(
    dictionary.compatibility || { status: dictionary.status === "ready" ? "supported" : "not-reviewed" }
  );
  return {
    rows: [
    { label: "信任与来源", value: dictionary.trustLabel || "本地导入 · 用户提供 / 未验证" },
    { label: "来源与使用权", value: "由你本机提供；请确认你有权使用。TranslateFlow 不会上传或重新分发。" },
    { label: "语言方向", value: "由你确认；TranslateFlow 尚未核验。" },
    { label: "格式", value: "MDX 富文本" },
    { label: "兼容性", value: compatibility.label },
    { label: "本地安装版本", value: formatLocalDictionaryVersion(dictionary.packVersion) },
    { label: "本地安装日期", value: formatLocalInstallDate(dictionary.installedAt) || "日期未知" },
    { label: "本机源文件", value: dictionary.fileName ? safeDictionaryFileName(dictionary.fileName) : "文件名未知" },
    ...(Number(dictionary.sourceSize) > 0
      ? [{ label: "本机源文件大小", value: formatDictionaryBytes(dictionary.sourceSize) }]
      : []),
    { label: "词条", value: Number(dictionary.entryCount || 0).toLocaleString() },
    { label: "已安装大小", value: formatDictionaryBytes(installedBytes) },
    {
      label: "本地附件",
      value: Number(dictionary.resourceCount || 0)
        ? `${Number(dictionary.resourceCount).toLocaleString()} 个 MDD 文件 · ${formatDictionaryBytes(dictionary.resourceBytes)}`
        : "未附加本地 MDD 文件"
    }
    ],
    detail: compatibility.detail
  };
}

function safeDictionaryFileName(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[\\/]/gu, "_")
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120) || "文件名未知";
}

export function getDictionaryHealthPresentation(status) {
  if (["ready", "healthy"].includes(status)) return { label: "可用", kind: "success", detail: "本地检查通过，可离线查询。" };
  if (["missing", "unavailable"].includes(status)) return { label: "文件缺失", kind: "error", detail: "词典文件不完整，重新安装或导入后可再次检查。" };
  if (["corrupt", "unhealthy"].includes(status)) return { label: "检查失败", kind: "error", detail: "本地词典无法通过完整性检查；其他词典仍可正常使用。" };
  if (["incompatible", "needs-reinstall"].includes(status)) return { label: "需要修复", kind: "warning", detail: "请重新安装或导入此词典。" };
  return { label: "状态待确认", kind: "warning", detail: "暂时无法确认此词典是否可用。" };
}

export function getCuratedMdxErrorMessage(error, phase = "") {
  if (error?.name === "AbortError") return "已取消安装；已安装词典保持可用。";
  const code = String(error?.code || "");
  if (code === "DICTIONARY_PERMISSION_DENIED") return "下载权限未获准，尚未开始下载。你可以在允许访问上游后重试。";
  if (code === "ECDICT_DOWNLOAD_REDIRECT" || code === "RICH_MDICT_PROVENANCE") return "词典来源与已审核目录不符，未安装。请重新检查词典状态。";
  if (/HASH|CRC/u.test(code)) return "下载文件与已审核版本不一致，未安装。请稍后重试或重新检查词典状态。";
  if (/DOWNLOAD/u.test(code) || (phase === "download" && !code)) return "暂时无法从上游下载词典。请检查网络后重试；当前已安装词典保持不变。";
  if (code === "RICH_MDICT_QUOTA" || code === "RICH_MDICT_LIMIT") return "本地空间不足或词典超过当前安全大小，未安装；已安装词典保持不变。";
  if (code === "RICH_MDICT_STORAGE") return "浏览器暂时无法保存此词典，已安装词典保持不变。请检查本地空间后重试。";
  if (code === "RICH_MDICT_REPLACEMENT_CONFLICT") return "词典状态已发生变化，未替换现有内容。请重新检查状态后再试。";
  if (code === "MDICT_UNSUPPORTED" || code === "MDICT_LIMIT") return "此词典格式或压缩方式暂不支持，未安装。";
  if (/CORRUPT|PROVENANCE|IDENTITY|OUTPUT/u.test(code)) return "词典文件未通过完整性或来源检查，未安装；现有词典保持不变。";
  if (phase === "rich-import") return "词典暂时无法安装。请重试；当前已安装词典保持不变。";
  return "词典操作未完成。请重试；当前已安装词典保持不变。";
}

export function formatDictionaryBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "大小未知";
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function formatLocalDictionaryVersion(value) {
  const version = String(value || "").trim();
  if (!version || version.length > 120 || /[\u0000-\u001f\u007f]/u.test(version)) return "未记录";
  return version;
}

export function formatLocalInstallDate(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function compatibilityLabel(status) {
  return COMPATIBILITY_LABELS[status] || "兼容性状态未记录";
}

function trustLabel(trustClass) {
  return TRUST_LABELS[trustClass] || "来源待核实";
}

function formatCatalogArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || !artifacts.length) return "格式未记录";
  return artifacts.map((artifact) => {
    if (artifact.kind === "mdx") return "MDX 富文本";
    if (artifact.kind === "mdd") return "MDD 附件";
    const name = artifact.archiveRules?.entryName || artifact.filename || "";
    if (artifact.kind === "zip" && /\.mdx$/iu.test(name)) return "MDX 富文本（压缩包下载）";
    if (artifact.kind === "source-data" && /\.csv$/iu.test(name)) return "CSV 词典数据";
    if (artifact.kind === "zip") return "压缩包";
    if (artifact.kind === "stardict") return "StarDict";
    if (artifact.kind === "tflex") return "TranslateFlow 词典包";
    return artifact.kind || "格式未记录";
  }).join(" + ");
}

function dateValue(value, fallback = "未公布") {
  return /^\d{4}-\d{2}-\d{2}$/u.test(String(value || "")) ? value : fallback;
}

function versionValue(value) {
  if (typeof value !== "string" || !value) return "未记录";
  return /^[a-f0-9]{40}$/iu.test(value) ? value.slice(0, 12) : value;
}

function maintenanceLabel(value) {
  if (value === "maintained") return "有明确维护记录";
  if (value === "unmaintained") return "上游已明确停止维护";
  return "上游维护状态未审核";
}

function isExplicitlyOldContent(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""))) return false;
  const date = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(date) && date < Date.now() - 5 * 365.25 * 24 * 60 * 60 * 1000;
}

function installedVersionValue(value, sourceVersion) {
  const installed = String(value || "");
  if (/^(?:import-[a-z0-9]+-[a-f0-9]{8}|rich-mdict-[a-f0-9-]{36})$/iu.test(installed)) {
    return sourceVersion && /^\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?$/u.test(sourceVersion)
      ? `已安装上游版本 ${sourceVersion} 的本地副本`
      : "已安装本地副本";
  }
  const transformed = /^(\d{4}-\d{2}-\d{2})-[a-f0-9]{8}$/iu.exec(installed);
  if (transformed) return `本地转换版本 · ${transformed[1]}`;
  return installed || "已安装";
}
