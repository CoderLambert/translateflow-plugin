export function curatedSourceMeta(source) {
  if (source?.importerType === "ecdict-mdx-zip-v1") {
    return [
      `来源：${source.publisher}`,
      "方向：EN → 简体中文",
      "格式：富文本 MDX（ZIP）",
      `上游审核版本：${source.upstreamRevision}`,
      `ZIP 下载：${formatCuratedBytes(source.downloadBytes)}`,
      `MDX 安装：${formatCuratedBytes(source.mdx.bytes)} + 查询索引（最多 8 MiB）`,
      `许可：${source.sourceLicenseLabel}`,
      "Release 资产经 release-assets.githubusercontent.com 提供",
      "信任：上游 / 社区；非 TranslateFlow 官方词典"
    ];
  }
  return [
    `来源：${source.publisher}`,
    `格式：${source.sourceFormat}`,
    `方向：${source.languageDirection}`,
    `固定版本：${shortCuratedRevision(source.upstreamRevision)}`,
    `上游下载：${formatCuratedBytes(source.downloadBytes)}`,
    `本地最多保留 ${source.selection.maxRecords.toLocaleString()} 条`,
    "信任：上游 / 社区，非 TranslateFlow 官方词典"
  ];
}

export function getCuratedMdxInstallPresentation(source, dictionary) {
  if (!dictionary) {
    return {
      status: "not-installed",
      kind: "warning",
      badgeLabel: "上游 / 社区",
      actionLabel: "安装",
      detail:
        "点击后将从固定 GitHub Release 下载；Chrome 还会询问该 Release 使用的精确 GitHub 资产 CDN 权限。"
    };
  }

  if (dictionary.curated?.recipeId !== source?.id) {
    return {
      status: "identity-conflict",
      kind: "error",
      badgeLabel: "身份冲突",
      actionLabel: "无法安装",
      detail:
        "固定词典标识已被其它富文本词典占用。请删除该词典后重试。"
    };
  }

  if (dictionary.status !== "ready") {
    return {
      status: "needs-reinstall",
      kind: "warning",
      badgeLabel: "需修复",
      actionLabel: "重新安装",
      detail:
        "本地 MDX 或索引缺失/损坏。重新安装会先检查新文件，再替换当前词典。"
    };
  }

  const currentVersion = String(dictionary.curated?.upstreamRevision || "");
  const currentHash = String(dictionary.curated?.mdxSha256 || "");
  if (
    currentVersion === String(source?.upstreamRevision || "") &&
    currentHash === String(source?.mdx?.sha256 || "")
  ) {
    return {
      status: "current",
      kind: "success",
      badgeLabel: "当前审核版本",
      actionLabel: "重新安装",
      detail:
        `已安装审核锁定版本 ${source.upstreamRevision}；此词典只会在新审核版本明确发布后显示更新。`
    };
  }

  return {
    status: "update-available",
    kind: "warning",
    badgeLabel: "可更新",
    actionLabel: "更新",
    detail:
      `已安装 ${currentVersion || "未知版本"}；当前审核版本为 ${source?.upstreamRevision || "未知"}。新文件通过完整检查后才会替换当前词典。`
  };
}

export function getCuratedInstallPresentation(
  source,
  entry
) {
  const active = entry?.active || null;
  if (!active) {
    return {
      status: "not-installed",
      kind: "warning",
      badgeLabel: "上游 / 社区",
      actionLabel: "下载并安装",
      detail:
        "点击后直接从上游下载；TranslateFlow 不镜像该词典内容。"
    };
  }

  if (entry?.status === "needs-reinstall") {
    return {
      status: "needs-reinstall",
      kind: "warning",
      badgeLabel: "需重装",
      actionLabel: "重新安装",
      detail:
        "本地文件缺失或损坏；重新安装会从审核锁定的上游版本重新下载并验证。"
    };
  }

  if (
    active.packVersion === source?.output?.packVersion
  ) {
    return {
      status: "current",
      kind: "success",
      badgeLabel: "当前版本",
      actionLabel: "重新安装",
      detail:
        "已安装当前审核版本；重新安装仍会重新下载并完整验证。"
    };
  }

  return {
    status: "update-available",
    kind: "warning",
    badgeLabel: "可更新",
    actionLabel: "更新",
    detail:
      `已安装 ${String(active.packVersion || "未知版本")}；当前审核版本 ${String(source?.output?.packVersion || "未知")}。更新会先验证新版本，再替换当前版本。`
  };
}

export function describeCuratedProgress(
  message,
  source
) {
  if (message.phase === "download") {
    const loaded = Number(message.inputBytes || 0);
    return loaded
      ? `正在下载/筛选：${formatCuratedBytes(loaded)} / ${formatCuratedBytes(source.downloadBytes)}`
      : "正在连接固定上游版本…";
  }
  if (message.phase === "convert") {
    return `正在转换：已保留 ${Number(message.retainedRecords || 0).toLocaleString()} 个词条…`;
  }
  if (message.phase === "stage") {
    return "正在写入隔离区并准备完整性验证…";
  }
  return "正在处理…";
}

export function shortCuratedRevision(value) {
  return String(value || "").slice(0, 12);
}

export function formatCuratedBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) {
    return (value / 1024).toFixed(1) + " KiB";
  }
  return (value / (1024 * 1024)).toFixed(1) + " MiB";
}
