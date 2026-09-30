import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { MDICT_IMPORT_LIMITS } from "../background/packs/importers/mdict-contract.js";
import { parseRichMdictHeader } from "../background/packs/importers/mdict-rich-metadata.js";
import { createRichMdictImportController } from "./rich-mdict-import-controller.js";

export function initializeRichMdictImportUi({
  runtime = globalThis.chrome?.runtime,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
  setStatus = setPageStatus
} = {}) {
  const fileInput = document.getElementById("richMdictFile");
  const inspection = document.getElementById("richMdictInspection");
  const inspectionMeta = document.getElementById("richMdictInspectionMeta");
  const importButton = document.getElementById("richMdictImportButton");
  const cancelButton = document.getElementById("richMdictCancelButton");
  const progress = document.getElementById("richMdictImportProgress");
  const installedList = document.getElementById("richMdictInstalledList");
  if (!fileInput || !inspection || !inspectionMeta || !importButton || !cancelButton || !progress || !installedList) {
    return null;
  }

  let selectedFile = null;
  let selectedHeader = null;
  let inspectionSequence = 0;
  let busy = false;
  const controller = createRichMdictImportController({
    runtime,
    WorkerCtor,
    cryptoProvider,
    onProgress(event) {
      progress.textContent = progressLabel(event.phase);
      progress.dataset.phase = String(event.phase || "");
    }
  });

  fileInput.addEventListener("change", () => {
    void inspectSelection();
  });

  async function inspectSelection() {
    const sequence = ++inspectionSequence;
    selectedFile = fileInput.files?.[0] || null;
    selectedHeader = null;
    inspection.hidden = !selectedFile;
    importButton.disabled = true;
    progress.textContent = "";
    if (!selectedFile) return;
    const error = validateFile(selectedFile);
    if (error) {
      inspectionMeta.textContent = error;
      setStatus(error, true);
      return;
    }
    inspectionMeta.replaceChildren(
      metaLine("文件", selectedFile.name),
      metaLine("大小", formatBytes(selectedFile.size)),
      metaLine("检查", "正在读取有大小上限的 MDX 头部…")
    );
    try {
      const headerBytes = new Uint8Array(await selectedFile
        .slice(0, MDICT_IMPORT_LIMITS.headerBytes + 8)
        .arrayBuffer());
      const header = parseRichMdictHeader(headerBytes);
      if (sequence !== inspectionSequence || selectedFile !== fileInput.files?.[0]) return;
      selectedHeader = header;
      const title = String(header.title || fileBaseName(selectedFile.name)).slice(0, 200);
      inspectionMeta.replaceChildren(
        metaLine("文件", selectedFile.name),
        metaLine("词典标题", title),
        metaLine("大小", formatBytes(selectedFile.size)),
        metaLine("格式", header.format),
        metaLine("编码", header.encoding?.name || ""),
        metaLine("MDict 版本", header.generatedByEngineVersion),
        metaLine("词典来源", "本地导入 · 用户提供 / 未验证 · MDX"),
        metaLine("检查范围", "头部兼容性已检查；完整索引将在安装时校验"),
        metaLine("显示方式", "安全纯文本预览，不运行词典内容")
      );
      importButton.disabled = false;
      setStatus("MDX 头部检查通过。安装后可在划词结果中查看该词典的释义。 ");
    } catch (inspectionError) {
      if (sequence !== inspectionSequence || selectedFile !== fileInput.files?.[0]) return;
      inspectionMeta.replaceChildren(
        metaLine("文件", selectedFile.name),
        metaLine("大小", formatBytes(selectedFile.size)),
        metaLine("检查结果", userMessage(inspectionError))
      );
      setStatus(userMessage(inspectionError), true);
    }
  }

  importButton.addEventListener("click", async () => {
    if (!selectedFile || !selectedHeader || busy || validateFile(selectedFile)) return;
    busy = true;
    fileInput.disabled = true;
    importButton.disabled = true;
    cancelButton.hidden = false;
    progress.textContent = "准备本地存储";
    try {
      const result = await controller.importDictionary({
        mdxFile: selectedFile,
        displayMetadata: { name: String(selectedHeader.title || fileBaseName(selectedFile.name)).slice(0, 200) }
      });
      const title = result.commit?.dictionary?.title || result.ready.metadata?.title || selectedFile.name;
      progress.textContent = "完成 · " + formatBytes(result.ready.metadata.sourceSize);
      setStatus(`${title} 已安装。选择英文词条后，释义会与主词典结果分开展示。`);
      selectedFile = null;
      selectedHeader = null;
      fileInput.value = "";
      inspection.hidden = true;
      document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed"));
      await refreshInstalled();
    } catch (error) {
      const message = userMessage(error);
      progress.textContent = error?.name === "AbortError" ? "已取消" : "安装失败";
      setStatus(message, error?.name !== "AbortError");
      await refreshInstalled();
    } finally {
      busy = false;
      fileInput.disabled = false;
      importButton.disabled = !selectedFile;
      cancelButton.hidden = true;
    }
  });

  cancelButton.addEventListener("click", async () => {
    cancelButton.disabled = true;
    try {
      await controller.cancel();
      progress.textContent = "正在取消并清理临时文件…";
    } finally {
      cancelButton.disabled = false;
    }
  });

  async function refreshInstalled() {
    installedList.textContent = "正在读取已安装的富文本词典…";
    try {
      const response = await runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_LIST });
      if (!response?.ok) throw new Error(response?.error || "读取富文本词典失败。");
      renderInstalled(installedList, response.dictionaries || [], { runtime, setStatus, refreshInstalled });
    } catch (error) {
      installedList.textContent = "读取富文本词典失败：" + (error?.message || String(error));
    }
  }

  document.addEventListener("translateflow:dictionary-state-changed", refreshInstalled);
  window.addEventListener("pagehide", () => controller.dispose(), { once: true });
  refreshInstalled();
  return Object.freeze({ controller, refresh: refreshInstalled });
}

function renderInstalled(container, dictionaries, { runtime, setStatus, refreshInstalled }) {
  container.replaceChildren();
  if (!Array.isArray(dictionaries) || !dictionaries.length) {
    container.textContent = "尚未安装富文本 MDict 词典。";
    return;
  }
  for (const dictionary of dictionaries) {
    const row = document.createElement("div");
    row.className = "site-row dictionary-pack-row";
    row.dataset.dictionaryId = String(dictionary.id || "");
    row.dataset.status = String(dictionary.status || "unknown");
    const summary = document.createElement("div");
    summary.className = "site-summary";
    const title = document.createElement("strong");
    title.textContent = dictionary.title || dictionary.fileName || "Rich MDict";
    summary.appendChild(title);
    const details = document.createElement("small");
    details.className = "dictionary-pack-detail";
    details.textContent = [
      "本地导入 · 用户提供 / 未验证 · MDX",
      dictionary.status === "ready" ? "可查词" : `状态：${dictionary.status || "未知"}`,
      `${Number(dictionary.entryCount || 0).toLocaleString()} 条词目`,
      formatBytes(dictionary.sourceSize)
    ].join(" · ");
    summary.appendChild(details);
    if (dictionary.error) {
      const failure = document.createElement("small");
      failure.className = "dictionary-pack-detail";
      failure.textContent = dictionary.error;
      summary.appendChild(failure);
    }

    const actions = document.createElement("div");
    actions.className = "site-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    remove.dataset.action = "uninstall";
    remove.disabled = !dictionary.id;
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        const response = await runtime.sendMessage({
          type: BACKGROUND_MESSAGES.RICH_MDICT_UNINSTALL,
          packId: dictionary.id
        });
        if (!response?.ok) throw new Error(response?.error || "富文本词典删除失败。");
        setStatus(`${dictionary.title || "富文本词典"} 已删除。`);
      } catch (error) {
        setStatus(error?.message || String(error), true);
      } finally {
        await refreshInstalled();
      }
    });
    actions.appendChild(remove);
    row.append(summary, actions);
    container.appendChild(row);
  }
}

function validateFile(file) {
  if (!file || !/\.mdx$/iu.test(String(file.name || "")) || !Number.isSafeInteger(file.size) || file.size <= 0) {
    return "请选择一个有效的 .mdx 文件。";
  }
  if (file.size > 128 * 1024 * 1024) return "MDX 文件超过当前 128 MiB 安全上限。";
  return "";
}

function userMessage(error) {
  if (error?.name === "AbortError") return "已取消富文本 MDict 安装，临时数据已清理。";
  if (error?.code === "RICH_MDICT_LIMIT" || error?.code === "RICH_MDICT_QUOTA") {
    return "词典超过当前安全大小或本地空间不足，未安装。";
  }
  if (["MDICT_UNSUPPORTED", "MDICT_LIMIT"].includes(error?.code)) {
    return "该 MDX 使用当前富文本 Viewer 尚不支持的版本或压缩功能。";
  }
  if (["MDICT_CORRUPT", "RICH_MDICT_CORRUPT"].includes(error?.code)) {
    return "MDX 文件损坏或索引校验失败，未安装。";
  }
  return error?.message || "富文本 MDict 安装失败。";
}

function progressLabel(phase) {
  if (phase === "preflight") return "检查本地空间";
  if (phase === "index") return "检查词典结构";
  if (phase === "store-source") return "保存离线词典";
  if (phase === "store-index") return "保存查询信息";
  if (phase === "commit") return "复核并启用词典";
  if (phase === "done") return "完成";
  return "处理中…";
}

function metaLine(label, value) {
  const line = document.createElement("div");
  const term = document.createElement("strong");
  term.textContent = label + "：";
  const text = document.createElement("span");
  text.textContent = String(value || "");
  line.append(term, text);
  return line;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
  return Math.ceil(bytes / 1024) + " KiB";
}

function fileBaseName(value) {
  return String(value || "dictionary.mdx").replace(/\.mdx$/iu, "");
}

function setPageStatus(message, isError = false) {
  const target = document.getElementById("status");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("error", Boolean(isError));
}

if (typeof document !== "undefined") initializeRichMdictImportUi();
