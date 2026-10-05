export function progressLabel(phase, details = {}) {
  let label;
  if (phase === "preflight") return "检查本地空间";
  if (phase === "index") label = "检查词典结构";
  else if (phase === "store-source") label = "保存离线词典";
  else if (phase === "store-index") label = "保存查询信息";
  else if (phase === "commit") label = "复核并启用词典";
  else if (phase === "done") label = "完成";
  else label = "处理中…";
  return withByteProgress(label, details);
}

export function resourceProgressLabel(phase, details = {}) {
  let label;
  if (phase === "preflight") label = "检查词典匹配和本地空间…";
  else if (phase === "index") label = "正在检查附件…";
  else if (phase === "store-source") label = "正在保存离线 MDD 文件…";
  else if (phase === "store-sidecar") label = "正在保存本地资源…";
  else if (phase === "store-index") label = "正在保存附件信息…";
  else if (phase === "commit") label = "正在复核并启用 MDD 附件…";
  else if (phase === "done") label = "MDD 附件已启用。";
  else label = "正在处理 MDD 资源…";
  return withByteProgress(label, details);
}

function withByteProgress(label, details) {
  const safeName = String(details?.fileName || "")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 100);
  const name = safeName ? ` · ${safeName}` : "";
  if (Number.isSafeInteger(details?.bytesWritten) && Number.isSafeInteger(details?.fileBytes)) {
    const overall = Number.isSafeInteger(details.completedBytes) && Number.isSafeInteger(details.totalBytes)
      ? ` · 已写入 ${formatBytes(details.completedBytes)} / ${formatBytes(details.totalBytes)}` : "";
    return `${label} · 已写入 ${formatBytes(details.bytesWritten)} / ${formatBytes(details.fileBytes)}${name}${overall}`;
  }
  if (Number.isSafeInteger(details?.bytesRead)) return `${label} · 已读取 ${formatBytes(details.bytesRead)}${name}`;
  return label;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

export function fileBaseName(value) {
  return String(value || "dictionary.mdx").replace(/\.mdx$/iu, "");
}

export function setPageStatus(message, isError = false) {
  const target = document.getElementById("status");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("error", Boolean(isError));
}
