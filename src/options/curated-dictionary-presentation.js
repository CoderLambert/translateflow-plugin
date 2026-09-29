export function curatedSourceMeta(source) {
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
