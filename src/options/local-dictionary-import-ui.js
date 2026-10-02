import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { preflightLocalDictionaryFiles } from "../background/packs/local-dictionary-preflight.js";
import { createRichMdictImportController } from "./rich-mdict-import-controller.js";
import { createMddResourceImportController } from "./mdd-resource-import-controller.js";
import { createMdictImportController } from "./mdict-import-controller.js";
import { inspectMdictFile, createMdictProductRecipe } from "./mdict-import-ui.js";
import { createStarDictImportController } from "./stardict-import-controller.js";
import { inspectStarDictFiles, createStarDictProductRecipe } from "./stardict-import-ui.js";
import { createTflexLocalImportController } from "./tflex-local-import-controller.js";
import {
  appendSummaryLine, fileBaseName, findDuplicateCandidate, formatBytes, importProgressLabel,
  isTflexOverInstallLimit, renderLocalPreflight, resolveAssociatedMddFiles, safeFileLabel,
  setPageStatus, tflexPackId, userMessage
} from "./local-dictionary-import-presentation.js";

export function initializeLocalDictionaryImportUi({
  runtime = globalThis.chrome?.runtime,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
  setStatus = setPageStatus
} = {}) {
  const root = document.getElementById("localDictionaryImport");
  if (!root) return null;
  const input = document.getElementById("localDictionaryFiles");
  const dropZone = document.getElementById("localDictionaryDropZone");
  const fileList = document.getElementById("localDictionaryFileList");
  const choose = document.getElementById("localDictionaryChooseFiles");
  const clear = document.getElementById("localDictionaryClearFiles");
  const preflightBox = document.getElementById("localDictionaryPreflight");
  const summary = document.getElementById("localDictionaryPreflightSummary");
  const semanticLabel = document.getElementById("localDictionarySemanticLabel");
  const semanticCheck = document.getElementById("localDictionarySemanticConfirmation");
  const semanticText = document.getElementById("localDictionarySemanticText");
  const limitationsLabel = document.getElementById("localDictionaryLimitationsLabel");
  const limitationsCheck = document.getElementById("localDictionaryLimitationsConfirmation");
  const limitationsText = document.getElementById("localDictionaryLimitationsText");
  const duplicateLabel = document.getElementById("localDictionaryDuplicateLabel");
  const duplicateCheck = document.getElementById("localDictionaryDuplicateConfirmation");
  const duplicateText = document.getElementById("localDictionaryDuplicateText");
  const importButton = document.getElementById("localDictionaryImportButton");
  const cancelButton = document.getElementById("localDictionaryCancelButton");
  const retryMddButton = document.getElementById("localDictionaryRetryMddButton");
  const progress = document.getElementById("localDictionaryImportProgress");
  if (!input || !dropZone || !fileList || !choose || !clear || !preflightBox || !summary ||
      !semanticCheck || !limitationsCheck || !limitationsText || !duplicateCheck || !importButton || !cancelButton || !progress) return null;

  let selectedFiles = [];
  let report = null;
  let installedCandidates = [];
  let installedStateKnown = { rich: false, packs: false };
  let preflightAbort = null;
  let preflightSequence = 0;
  let activeImport = null;
  let busy = false;
  let retryAttachment = null;
  const richController = createRichMdictImportController({ runtime, WorkerCtor, cryptoProvider, onProgress: onImportProgress });
  const mdictController = createMdictImportController({ runtime, WorkerCtor, cryptoProvider, onProgress: onImportProgress });
  const starDictController = createStarDictImportController({ runtime, WorkerCtor, cryptoProvider, onProgress: onImportProgress });
  const mddController = createMddResourceImportController({ runtime, WorkerCtor, cryptoProvider, onProgress: onImportProgress });
  const tflexController = createTflexLocalImportController({ runtime, cryptoProvider, onProgress: onImportProgress });

  input.addEventListener("change", () => {
    replaceSelection(Array.from(input.files || []));
    input.value = "";
  });
  choose.addEventListener("click", () => input.click());
  clear.addEventListener("click", () => replaceSelection([]));
  dropZone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    input.click();
  });
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.dataset.dragging = "true";
  });
  dropZone.addEventListener("dragleave", () => { delete dropZone.dataset.dragging; });
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    delete dropZone.dataset.dragging;
    replaceSelection(Array.from(event.dataTransfer?.files || []));
  });
  semanticCheck.addEventListener("change", () => { void runPreflight(); });
  limitationsCheck.addEventListener("change", updateImportEnabled);
  duplicateCheck.addEventListener("change", updateImportEnabled);
  importButton.addEventListener("click", () => { void importSelected(); });
  cancelButton.addEventListener("click", () => { void cancelActive(); });
  retryMddButton?.addEventListener("click", () => { void retryMddAttachment(); });
  document.addEventListener("translateflow:dictionary-state-changed", () => { void refreshInstalledCandidates(); });
  window.addEventListener("pagehide", dispose, { once: true });
  void refreshInstalledCandidates();
  renderFileList();

  function onImportProgress(event) {
    if (!busy) return;
    progress.textContent = importProgressLabel(event.phase);
    progress.dataset.phase = String(event.phase || "");
  }

  function replaceSelection(files) {
    if (busy) return;
    preflightAbort?.abort();
    selectedFiles = Array.from(files || []).filter((file) => file && typeof file.name === "string");
    report = null;
    retryAttachment = null;
    retryMddButton.hidden = true;
    limitationsCheck.checked = false;
    duplicateCheck.checked = false;
    semanticCheck.checked = false;
    progress.textContent = "";
    preflightBox.hidden = selectedFiles.length === 0;
    root.dataset.status = selectedFiles.length ? "checking" : "empty";
    clear.disabled = selectedFiles.length === 0;
    renderFileList();
    if (selectedFiles.length) void runPreflight();
  }

  function renderFileList() {
    fileList.replaceChildren();
    for (const [index, file] of selectedFiles.entries()) {
      const item = document.createElement("li");
      item.className = "local-dictionary-file";
      const name = document.createElement("span");
      name.className = "local-dictionary-file-name";
      name.textContent = `${safeFileLabel(file.name)} · ${formatBytes(file.size)}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "移除";
      remove.setAttribute("aria-label", `移除文件 ${safeFileLabel(file.name)}`);
      remove.disabled = busy;
      remove.addEventListener("click", () => replaceSelection(selectedFiles.filter((_, at) => at !== index)));
      item.append(name, remove);
      fileList.appendChild(item);
    }
  }

  async function runPreflight() {
    const sequence = ++preflightSequence;
    preflightAbort?.abort();
    preflightAbort = new AbortController();
    report = null;
    duplicateCheck.checked = false;
    limitationsCheck.checked = false;
    semanticCheck.disabled = true;
    clear.disabled = true;
    choose.disabled = true;
    importButton.disabled = true;
    preflightBox.hidden = selectedFiles.length === 0;
    cancelButton.hidden = selectedFiles.length === 0;
    root.dataset.status = selectedFiles.length ? "checking" : "empty";
    summary.replaceChildren();
    if (!selectedFiles.length) {
      renderFileList();
      updateImportEnabled();
      return;
    }
    appendSummaryLine(summary, "检查状态", "正在本机检查文件结构…");
    renderFileList();
    try {
      const result = await preflightLocalDictionaryFiles({
        files: selectedFiles,
        signal: preflightAbort.signal,
        semanticConfirmation: semanticCheck.checked,
        sourceLanguage: semanticCheck.checked ? "en" : undefined,
        targetLanguage: semanticCheck.checked ? "zh-CN" : undefined
      });
      if (sequence !== preflightSequence || preflightAbort.signal.aborted) return;
      report = result;
      root.dataset.status = result.compatibility.status;
      renderPreflight(result);
      await refreshInstalledCandidates();
      if (sequence !== preflightSequence) return;
    } catch (error) {
      if (sequence !== preflightSequence) return;
      if (error?.name === "AbortError") {
        report = null;
        root.dataset.status = "cancelled";
        summary.replaceChildren();
        appendSummaryLine(summary, "检查状态", "本机检查已取消；文件尚未导入。重新选择文件后可以再次检查。");
        return;
      }
      report = null;
      root.dataset.status = "invalid";
      summary.replaceChildren();
      appendSummaryLine(summary, "检查状态", error?.message || "本机兼容性检查失败。");
      setStatus("无法完成本地词典检查。请重新选择文件后重试。", true);
    } finally {
      if (sequence === preflightSequence) {
        semanticCheck.disabled = false;
        if (!busy) cancelButton.hidden = true;
        clear.disabled = selectedFiles.length === 0;
        choose.disabled = busy;
        renderFileList();
        updateImportEnabled();
      }
    }
  }

  function renderPreflight(result) {
    renderLocalPreflight({ result, selectedFiles, installedCandidates, summary, semanticLabel, semanticCheck, semanticText, limitationsLabel, limitationsCheck, limitationsText, duplicateLabel, duplicateCheck, duplicateText, updateImportEnabled });
    if (!isInstalledStateKnownForReport(result)) {
      appendSummaryLine(summary, "重复检查", "暂时无法读取对应的已安装词典状态；为避免重复或误覆盖，安装已暂停。");
    }
  }

  function updateImportEnabled() {
    if (!report || busy) {
      importButton.disabled = true;
      return;
    }
    const status = report.compatibility.status;
    const route = report.route.importer;
    const statusCanImport = status === "supported" || status === "partial";
    const missingFiles = report.resources.missingCompanionHints.length > 0 && report.identity.family !== "mdict-rich";
    const unrelatedFiles = report.resources.unassociatedFiles.length > 0;
    const selectedMddCount = selectedFiles.filter((file) => /\.mdd$/iu.test(file.name)).length;
    const unreadMdd = report.identity.family === "mdict-rich" && selectedMddCount !== report.resources.associatedMdd.length;
    const semanticRequired = report.identity.family === "stardict" || report.route.requiresSemanticConfirmation;
    const mdxStructuredConfirmed = report.identity.family === "mdict-structured";
    const semanticAllowed = !semanticRequired || semanticCheck.checked || mdxStructuredConfirmed;
    const partialAllowed = status !== "partial" || limitationsCheck.checked;
    const duplicate = findDuplicateCandidate(report, installedCandidates, selectedFiles);
    const tflexTooLarge = report.identity.family === "tflex" && isTflexOverInstallLimit(selectedFiles);
    const duplicateAllowed = !duplicate || duplicateCheck.checked;
    const duplicateStateKnown = isInstalledStateKnownForReport(report);
    importButton.disabled = !statusCanImport || route === "none" || missingFiles || unrelatedFiles || unreadMdd || tflexTooLarge ||
      !semanticAllowed || !partialAllowed || !duplicateAllowed || !duplicateStateKnown;
  }

  async function importSelected() {
    if (importButton.disabled || !report || busy) return;
    busy = true;
    setBusy(true);
    progress.textContent = "准备导入…";
    const route = report.route.importer;
    const importedFiles = selectedFiles.slice();
    const preflightResult = report;
    let success = false;
    try {
      if (route === "rich-mdict") {
        const mdxFile = importedFiles.find((file) => /\.mdx$/iu.test(file.name));
        const attached = resolveAssociatedMddFiles(preflightResult.resources.associatedMdd, importedFiles);
        if (!attached) throw new Error("MDD 文件名无法安全匹配到唯一的所选文件；请重新选择文件组。");
        const imported = await runImportWithCancel(richController, () => richController.importDictionary({
          mdxFile,
          displayMetadata: { name: preflightResult.identity.displayTitle || fileBaseName(mdxFile.name) }
        }));
        const dictionaryId = String(imported.commit?.dictionary?.id || imported.commit?.dictionary?.packId || "");
        if (attached.length) {
          if (!dictionaryId) throw new Error("MDX 已安装，但无法确认目标词典标识，MDD 附件未附加。");
          try {
            progress.textContent = "MDX 已安装，正在原子检查并添加已关联的 MDD…";
            await runImportWithCancel(mddController, () => mddController.attachResources({
              dictionaryId, mdxFileName: mdxFile.name, files: attached
            }));
          } catch (error) {
            retryAttachment = { dictionaryId, mdxFileName: mdxFile.name, files: attached, title: preflightResult.identity.displayTitle };
            retryMddButton.hidden = false;
            retryMddButton.textContent = `重试为“${retryAttachment.title || "已安装词典"}”添加 MDD`;
            const cancelled = error?.name === "AbortError";
            progress.textContent = cancelled
              ? "MDX 已安装；MDD 附件导入已取消，原有附件保持不变。"
              : `MDX 已安装；MDD 未更改。${userMessage(error)}`;
            setStatus(cancelled
              ? "MDD 附件导入已取消，原有附件保持不变。可检查文件后重试。"
              : "MDX 已安装，但 MDD 附件检查失败，原有附件保持不变。可检查文件后重试。", !cancelled);
            document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed"));
            success = true;
            return;
          }
        }
        progress.textContent = "完成 · 富文本词典已安装";
      } else if (route === "structured-mdict") {
        const mdxFile = importedFiles.find((file) => /\.mdx$/iu.test(file.name));
        const inspection = await inspectMdictFile(mdxFile);
        const recipe = createMdictProductRecipe(inspection, { cryptoProvider });
        await runImportWithCancel(mdictController, () => mdictController.importDictionary({
          mdxFile, recipe,
          displayMetadata: { name: recipe.dictionary.title, format: "mdict" }
        }));
        progress.textContent = "完成 · 结构化词典已安装";
      } else if (route === "stardict") {
        const inspection = await inspectStarDictFiles(importedFiles);
        const recipe = createStarDictProductRecipe(inspection, { cryptoProvider });
        await runImportWithCancel(starDictController, () => starDictController.importDictionary({
          ...inspection, recipe,
          displayMetadata: { name: recipe.dictionary.bookname, format: "stardict" }
        }));
        progress.textContent = "完成 · StarDict 已安装";
      } else if (route === "tflex") {
        await runImportWithCancel(tflexController, () => tflexController.importDictionary({
          files: importedFiles,
          displayMetadata: {
            kind: "local-import",
            name: preflightResult.identity.displayTitle || "本地 TFLex 词典",
            format: "tflex",
            sourceLabel: "用户提供 · 未验证"
          }
        }));
        progress.textContent = "完成 · TFLex 文件已通过完整安装校验";
      } else {
        throw new Error("没有可用的导入方式。");
      }
      success = true;
      setStatus("词典已安装并保存在本机；不会自动调用 Provider。若需要确认词条含义，请先在划词结果中查看。", false);
      document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed"));
    } catch (error) {
      const message = userMessage(error, route);
      progress.textContent = error?.name === "AbortError" ? "已取消；临时文件已清理，原有词典保持不变。" : `安装失败：${message}`;
      setStatus(message, error?.name !== "AbortError");
      document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed"));
    } finally {
      busy = false;
      activeImport = null;
      setBusy(false);
      updateImportEnabled();
    }
  }

  async function runImportWithCancel(controller, task) {
    activeImport = { cancel: () => controller.cancel(), dispose: () => controller.dispose?.() };
    return task();
  }

  async function cancelActive() {
    cancelButton.disabled = true;
    try {
      if (activeImport?.cancel) {
        const result = await activeImport.cancel();
        if (result?.cancelled) {
          progress.textContent = "正在取消并清理临时数据…";
        } else if (result?.phase === "commitpoint") {
          progress.textContent = "词典已进入最终提交阶段，当前已不能取消；正在完成保存…";
        } else {
          progress.textContent = "当前操作已经结束或无法取消。";
        }
      } else if (preflightAbort) {
        preflightAbort.abort();
        progress.textContent = "已取消本机检查。";
      }
    } finally {
      cancelButton.disabled = false;
    }
  }

  async function retryMddAttachment() {
    if (!retryAttachment || busy) return;
    busy = true;
    setBusy(true);
    progress.textContent = "正在检查 MDD 并原子更新附件…";
    const attempt = retryAttachment;
    try {
      await runImportWithCancel(mddController, () => mddController.attachResources({
        dictionaryId: attempt.dictionaryId, mdxFileName: attempt.mdxFileName, files: attempt.files
      }));
      retryAttachment = null;
      retryMddButton.hidden = true;
      progress.textContent = "完成 · MDD 附件已添加";
      setStatus("MDD 附件已安全添加。", false);
      document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed"));
    } catch (error) {
      progress.textContent = error?.name === "AbortError" ? "已取消；原有附件保持不变。" : `MDD 附件未更改：${userMessage(error)}`;
      setStatus(userMessage(error), error?.name !== "AbortError");
    } finally {
      busy = false;
      activeImport = null;
      setBusy(false);
    }
  }

  async function refreshInstalledCandidates() {
    const [richResult, packResult] = await Promise.allSettled([
      runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_LIST }),
      runtime.sendMessage({ type: BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS })
    ]);
    const nextCandidates = [];
    let richKnown = false;
    let packsKnown = false;

    if (richResult.status === "fulfilled" && Array.isArray(richResult.value?.dictionaries)) {
      richKnown = true;
      for (const dictionary of richResult.value.dictionaries) {
        if (dictionary?.title) nextCandidates.push({
          name: dictionary.title,
          family: "mdict-rich",
          packId: dictionary.id,
          fileName: dictionary.fileName,
          sourceFiles: dictionary.fileName ? [dictionary.fileName] : [],
          sourceSize: dictionary.sourceSize,
          version: dictionary.packVersion
        });
      }
    }

    if (
      packResult.status === "fulfilled" &&
      packResult.value?.state?.packs &&
      typeof packResult.value.state.packs === "object" &&
      !Array.isArray(packResult.value.state.packs)
    ) {
      packsKnown = true;
      for (const [packId, entry] of Object.entries(packResult.value.state.packs)) {
        if (!entry?.active) continue;
        const name = String(entry.display?.name || packId), format = entry.display?.format || "";
        nextCandidates.push({
          name, family: format || "tflex", packId, version: entry.active.packVersion,
          sourceFiles: format === "tflex" ? ["manifest.json", "index.dat", "entries.dat"] : [],
          sourceSize: entry.active.totalBytes, format: entry.display?.formatLabel
        });
      }
    }

    installedCandidates = nextCandidates;
    installedStateKnown = { rich: richKnown, packs: packsKnown };
    if (report) renderPreflight(report);
  }

  function isInstalledStateKnownForReport(value) {
    if (!value?.identity?.family) return false;
    return value.identity.family === "mdict-rich"
      ? installedStateKnown.rich
      : installedStateKnown.packs;
  }

  function setBusy(value) {
    root.dataset.busy = value ? "true" : "false";
    input.disabled = value;
    choose.disabled = value;
    clear.disabled = value || selectedFiles.length === 0;
    cancelButton.hidden = !value;
    semanticCheck.disabled = value || semanticLabel.hidden;
    limitationsCheck.disabled = value || limitationsLabel.hidden;
    duplicateCheck.disabled = value || duplicateLabel.hidden;
    renderFileList();
    if (value) importButton.disabled = true;
    else updateImportEnabled();
  }

  function dispose() {
    preflightAbort?.abort();
    activeImport?.dispose?.();
    richController.dispose();
    mdictController.dispose();
    starDictController.dispose();
    mddController.dispose();
    tflexController.dispose();
  }

  return Object.freeze({ refreshInstalledCandidates, dispose });
}
if (typeof document !== "undefined") initializeLocalDictionaryImportUi();
