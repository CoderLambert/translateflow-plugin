import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { MDICT_IMPORT_LIMITS } from "../background/packs/importers/mdict-contract.js";
import { parseRichMdictHeader } from "../background/packs/importers/mdict-rich-metadata.js";
import { createRichMdictImportController } from "./rich-mdict-import-controller.js";
import { createMddResourceImportController } from "./mdd-resource-import-controller.js";
import { appendRichMdictPreferencesControls } from "./rich-mdict-preferences-ui.js";
import { getDictionaryCatalogEntry } from "../shared/dictionary-catalog-v2.js";
import {
  formatDictionaryBytes as formatBytes,
  getCatalogDictionaryRows,
  getDictionaryHealthPresentation,
  renderCatalogLimitations,
  renderDictionaryMetadata,
  renderLocalRichDictionaryMetadata
} from "./dictionary-library-v2-presentation.js";
import { fileBaseName, progressLabel, resourceProgressLabel, setPageStatus } from "./rich-mdict-import-copy.js";

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
  if (!fileInput && installedList) {
    let activeResourceProgress = null;
    const resourceController = createMddResourceImportController({
      runtime,
      WorkerCtor,
      cryptoProvider,
      onProgress(event) {
        if (activeResourceProgress) activeResourceProgress.textContent = resourceProgressLabel(event.phase);
      }
    });
    const refreshInstalled = async () => {
      installedList.textContent = "正在读取已安装的富文本词典…";
      try {
        const response = await runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_LIST });
        if (!response?.ok) throw new Error(response?.error || "读取富文本词典失败。");
        renderInstalled(installedList, response.dictionaries || [], {
          runtime, setStatus, refreshInstalled, resourceController,
          setProgressNode(node) { activeResourceProgress = node; }
        });
      } catch (error) {
        installedList.textContent = "读取富文本词典失败：" + (error?.message || String(error));
      }
    };
    document.addEventListener("translateflow:dictionary-state-changed", refreshInstalled);
    window.addEventListener("pagehide", () => resourceController.dispose(), { once: true });
    refreshInstalled();
    return Object.freeze({ resourceController, refresh: refreshInstalled });
  }
  if (!fileInput || !inspection || !inspectionMeta || !importButton || !cancelButton || !progress || !installedList) {
    return null;
  }

  let selectedFile = null;
  let selectedHeader = null;
  let inspectionSequence = 0;
  let busy = false;
  let activeResourceProgress = null;
  const controller = createRichMdictImportController({
    runtime,
    WorkerCtor,
    cryptoProvider,
    onProgress(event) {
      progress.textContent = progressLabel(event.phase);
      progress.dataset.phase = String(event.phase || "");
    }
  });
  const resourceController = createMddResourceImportController({
    runtime,
    WorkerCtor,
    cryptoProvider,
    onProgress(event) {
      if (activeResourceProgress) activeResourceProgress.textContent = resourceProgressLabel(event.phase);
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
        metaLine("检查状态", "文件头已检查，安装时会再次核对完整词典"),
        metaLine("显示方式", "安全预览；安装后可附加同名 MDD 的本地媒体和受限样式")
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
      renderInstalled(installedList, response.dictionaries || [], {
        runtime, setStatus, refreshInstalled, resourceController,
        setProgressNode(node) { activeResourceProgress = node; }
      });
    } catch (error) {
      installedList.textContent = "读取富文本词典失败：" + (error?.message || String(error));
    }
  }

  document.addEventListener("translateflow:dictionary-state-changed", refreshInstalled);
  window.addEventListener("pagehide", () => {
    controller.dispose();
    resourceController.dispose();
  }, { once: true });
  refreshInstalled();
  return Object.freeze({ controller, resourceController, refresh: refreshInstalled });
}

function renderInstalled(container, dictionaries, { runtime, setStatus, refreshInstalled, resourceController, setProgressNode }) {
  container.replaceChildren();
  const installedDictionaries = Array.isArray(dictionaries) ? dictionaries : [];
  if (!installedDictionaries.length) {
    container.textContent = "尚未安装富文本 MDict 词典。";
    return;
  }
  for (const [index, dictionary] of installedDictionaries.entries()) {
    const row = document.createElement("div");
    row.className = "site-row dictionary-pack-row";
    row.dataset.dictionaryId = String(dictionary.id || "");
    row.dataset.status = String(dictionary.status || "unknown");
    row.setAttribute("role", "group");
    const summary = document.createElement("div");
    summary.className = "site-summary";
    const heading = document.createElement("div");
    heading.className = "dictionary-pack-heading";
    const title = document.createElement("strong");
    title.textContent = dictionary.title || dictionary.fileName || "Rich MDict";
    title.id = `rich-dictionary-${index}`;
    row.setAttribute("aria-labelledby", title.id);
    const health = getDictionaryHealthPresentation(dictionary.status);
    const badge = document.createElement("span");
    badge.className = "dictionary-health-badge";
    badge.dataset.kind = health.kind;
    badge.textContent = health.label;
    badge.setAttribute("aria-label", `词典状态：${health.label}`);
    heading.append(title, badge);
    summary.appendChild(heading);

    const catalog = dictionary.catalog || null;
    const catalogEntry = catalog ? getDictionaryCatalogEntry(catalog.entryId) : null;
    const installedBytes = Number(dictionary.installedBytes) ||
      Number(dictionary.sourceSize || 0) + Number(dictionary.indexSize || 0) + Number(dictionary.resourceBytes || 0);
    if (catalogEntry) {
      renderDictionaryMetadata(summary, getCatalogDictionaryRows(catalogEntry, {
        installedCatalog: catalog,
        installedSize: installedBytes,
        installedSourceFileName: dictionary.fileName,
        installedSourceSize: dictionary.sourceSize,
        entryCount: dictionary.entryCount,
        resourceCount: dictionary.resourceCount,
        resourceBytes: dictionary.resourceBytes,
        includeDownload: false
      }));
      renderCatalogLimitations(summary, catalogEntry);
    } else {
      renderLocalRichDictionaryMetadata(summary, dictionary, installedBytes);
    }
    if (health.detail && health.kind !== "success") {
      const failure = document.createElement("small");
      failure.className = "dictionary-pack-detail";
      failure.textContent = health.detail;
      summary.appendChild(failure);
    }

    const actions = document.createElement("div");
    actions.className = "site-actions";
    appendRichMdictPreferencesControls({
      actions, dictionary, dictionaries: installedDictionaries, index, runtime, setStatus, refresh: refreshInstalled
    });

    const attachInput = document.createElement("input");
    attachInput.type = "file";
    attachInput.multiple = true;
    attachInput.accept = ".mdd";
    attachInput.hidden = true;
    attachInput.dataset.action = "attach-mdd-resources";
    const attach = document.createElement("button");
    attach.type = "button";
    attach.textContent = "添加/替换 MDD 资源";
    attach.setAttribute("aria-label", `为${title.textContent}添加或替换 MDD 附件`);
    attach.dataset.action = "attach-mdd-resources-button";
    const resourceProgress = document.createElement("small");
    resourceProgress.className = "dictionary-pack-detail";
    resourceProgress.setAttribute("aria-live", "polite");
    attach.addEventListener("click", () => attachInput.click());
    attachInput.addEventListener("change", async () => {
      const files = Array.from(attachInput.files || []);
      if (!files.length) return;
      attach.disabled = true;
      remove.disabled = true;
      cancelAttach.hidden = false;
      resourceProgress.textContent = "准备导入 MDD 资源…";
      setProgressNode(resourceProgress);
      try {
        const result = await resourceController.attachResources({
          dictionaryId: dictionary.id,
          mdxFileName: dictionary.fileName,
          files
        });
        resourceProgress.textContent = `已附加 ${result.commit.dictionary.resourceCount} 个 MDD 文件。`;
        setStatus(`${dictionary.title || "富文本词典"} 的本地资源已更新。`);
        document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed"));
      } catch (error) {
        const message = userMddMessage(error);
        resourceProgress.textContent = error?.name === "AbortError" ? "已取消，原有资源保留。" : message;
        setStatus(message, error?.name !== "AbortError");
      } finally {
        setProgressNode(null);
        attachInput.value = "";
        attach.disabled = false;
        remove.disabled = false;
        cancelAttach.hidden = true;
        await refreshInstalled();
      }
    });
    actions.append(attachInput, attach);
    const cancelAttach = document.createElement("button");
    cancelAttach.type = "button";
    cancelAttach.textContent = "取消资源导入";
    cancelAttach.hidden = true;
    cancelAttach.dataset.action = "cancel-mdd-resources";
    cancelAttach.addEventListener("click", async () => {
      cancelAttach.disabled = true;
      try {
        await resourceController.cancel();
        resourceProgress.textContent = "正在取消并清理临时文件…";
      } finally {
        cancelAttach.disabled = false;
      }
    });
    actions.appendChild(cancelAttach);
    resourceProgress.dataset.role = "mdd-resource-progress";
    actions.appendChild(resourceProgress);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    remove.setAttribute("aria-label", `删除${title.textContent}`);
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
        document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed"));
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
    return "MDX 文件损坏或完整性检查失败，未安装。";
  }
  return error?.message || "富文本 MDict 安装失败。";
}

function userMddMessage(error) {
  if (error?.name === "AbortError") return "已取消 MDD 资源导入，原有附件继续可用。";
  if (error?.code === "RICH_MDD_INPUT") return "MDD 文件名需与已安装 MDX 同名，并按 .1.mdd、.2.mdd 连续编号。";
  if (error?.code === "RICH_MDD_LIMIT" || error?.code === "RICH_MDD_QUOTA") return "MDD 文件或本地空间超过当前安全上限，原有附件保留。";
  if (["RICH_MDD_CORRUPT", "MDICT_CORRUPT"].includes(error?.code)) return "MDD 文件损坏、附件检查失败或资源类型不受支持，原有附件保留。";
  return error?.message || "MDD 资源导入失败，原有附件保留。";
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

if (typeof document !== "undefined") initializeRichMdictImportUi();
