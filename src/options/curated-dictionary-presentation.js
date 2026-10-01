export function getCuratedMdxInstallPresentation(source, dictionary) {
  if (!dictionary) {
    return {
      status: "not-installed",
      kind: "warning",
      badgeLabel: "精选上游",
      actionLabel: "安装",
      detail:
        "点击后直接从已锁定的上游发行版本下载。版本来源、词典内容日期和兼容性审核日期会分别显示。"
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
      badgeLabel: "需要修复",
      actionLabel: "重新安装",
      detail:
        "本地词典文件或查询信息无法正常读取。重新安装会先完成检查，再替换当前副本。"
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
      badgeLabel: "已安装 · 可用",
      actionLabel: "重新安装",
      detail:
        `已安装上游版本 ${source.upstreamRevision}。兼容性审核状态不代表词典内容仍在更新。`
    };
  }

  return {
    status: "update-available",
    kind: "warning",
    badgeLabel: "有已审核更新",
    actionLabel: "更新",
    detail:
      `已安装上游版本 ${currentVersion || "未知版本"}；可安装的已审核版本为 ${source?.upstreamRevision || "未知"}。检查通过后才会替换当前副本。`
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
      badgeLabel: "精选上游",
      actionLabel: "下载并安装",
      detail:
        "由你主动从已锁定的上游版本下载；TranslateFlow 不镜像该词典内容。"
    };
  }

  if (entry?.status === "needs-reinstall") {
    return {
      status: "needs-reinstall",
      kind: "warning",
      badgeLabel: "需要修复",
      actionLabel: "重新安装",
      detail:
        "本地词典文件或完整性检查异常；重新安装会重新下载并验证。"
    };
  }

  if (
    active.packVersion === source?.output?.packVersion
  ) {
    return {
      status: "current",
      kind: "success",
      badgeLabel: "已安装 · 可用",
      actionLabel: "重新安装",
      detail:
        "此目录版本已安装；词典内容日期与兼容性审核日期分别列出。"
    };
  }

  return {
    status: "update-available",
    kind: "warning",
    badgeLabel: "有已审核更新",
    actionLabel: "更新",
    detail:
      "已安装版本与可安装的已审核目录版本不同。更新会先验证新版本，再替换当前副本。"
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
    return "正在保存词典并检查文件完整性…";
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
