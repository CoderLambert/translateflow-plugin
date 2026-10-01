export function progressLabel(phase) {
  if (phase === "preflight") return "检查本地空间";
  if (phase === "index") return "检查词典结构";
  if (phase === "store-source") return "保存离线词典";
  if (phase === "store-index") return "保存查询信息";
  if (phase === "commit") return "复核并启用词典";
  if (phase === "done") return "完成";
  return "处理中…";
}

export function resourceProgressLabel(phase) {
  if (phase === "preflight") return "检查词典匹配和本地空间…";
  if (phase === "index") return "正在检查附件…";
  if (phase === "store-source") return "正在保存离线 MDD 文件…";
  if (phase === "store-index") return "正在保存附件信息…";
  if (phase === "commit") return "正在复核并启用 MDD 附件…";
  if (phase === "done") return "MDD 附件已启用。";
  return "正在处理 MDD 资源…";
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
