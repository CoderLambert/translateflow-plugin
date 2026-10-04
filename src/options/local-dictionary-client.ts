import { preflightLocalDictionaryFiles } from "../background/packs/local-dictionary-preflight.js";
import { createMddResourceImportController } from "./mdd-resource-import-controller.js";
import { createMdictImportController } from "./mdict-import-controller.js";
import { inspectMdictFile, createMdictProductRecipe } from "./mdict-import-ui.js";
import { createRichMdictImportController } from "./rich-mdict-import-controller.js";
import { createStarDictImportController } from "./stardict-import-controller.js";
import { inspectStarDictFiles, createStarDictProductRecipe } from "./stardict-import-ui.js";
import { createTflexLocalImportController } from "./tflex-local-import-controller.js";
import { readInstalledDictionaryState } from "./local-dictionary-installed-state.js";
import {
  fileBaseName, importProgressLabel, resolveAssociatedMddFiles, userMessage
} from "./local-dictionary-import-presentation.js";

export type LocalPreflight = Record<string, any>;
export type InstalledDictionaryState = { candidates: Record<string, any>[]; known: { rich: boolean; packs: boolean } };
export type LocalImportResult = {
  progress: string;
  status: string;
  error: boolean;
  changed: boolean;
  retryMdd: boolean;
};
type LocalController = {
  importDictionary: (input: Record<string, any>) => Promise<Record<string, any>>;
  attachResources: (input: Record<string, any>) => Promise<Record<string, any>>;
  cancel: () => Promise<Record<string, any>>;
  dispose: () => void;
};
const runPreflight = preflightLocalDictionaryFiles as (input: Record<string, any>) => Promise<LocalPreflight>;
const makeRichController = createRichMdictImportController as unknown as (options: Record<string, any>) => LocalController;
const makeMdictController = createMdictImportController as unknown as (options: Record<string, any>) => LocalController;
const makeStarDictController = createStarDictImportController as unknown as (options: Record<string, any>) => LocalController;
const makeMddController = createMddResourceImportController as unknown as (options: Record<string, any>) => LocalController;
const makeTflexController = createTflexLocalImportController as unknown as (options: Record<string, any>) => LocalController;

export function createLocalDictionaryClient({
  runtime = chrome.runtime,
  WorkerCtor = Worker,
  cryptoProvider = crypto,
  onProgress = (_message: string) => {}
}: {
  runtime?: typeof chrome.runtime;
  WorkerCtor?: typeof Worker;
  cryptoProvider?: Crypto;
  onProgress?: (message: string) => void;
} = {}) {
  let active: LocalController | null = null;
  let retryAttachment: null | { dictionaryId: string; mdxFileName: string; files: File[]; title: string } = null;
  const progress = (event: { phase?: string }) => onProgress(importProgressLabel(event.phase));
  const rich = makeRichController({ runtime, WorkerCtor, cryptoProvider, onProgress: progress });
  const structured = makeMdictController({ runtime, WorkerCtor, cryptoProvider, onProgress: progress });
  const stardict = makeStarDictController({ runtime, WorkerCtor, cryptoProvider, onProgress: progress });
  const mdd = makeMddController({ runtime, WorkerCtor, cryptoProvider, onProgress: progress });
  const tflex = makeTflexController({ runtime, cryptoProvider, onProgress: progress });

  async function preflight(files: File[], semanticConfirmation: boolean, signal: AbortSignal): Promise<LocalPreflight> {
    return runPreflight({
      files, signal, semanticConfirmation,
      sourceLanguage: semanticConfirmation ? "en" : undefined,
      targetLanguage: semanticConfirmation ? "zh-CN" : undefined
    });
  }

  async function installed(): Promise<InstalledDictionaryState> {
    return readInstalledDictionaryState(runtime) as Promise<InstalledDictionaryState>;
  }

  async function importFiles(report: LocalPreflight, selectedFiles: File[]): Promise<LocalImportResult> {
    retryAttachment = null;
    const files = selectedFiles.slice();
    const route = String(report.route.importer || "");
    try {
      if (route === "rich-mdict") {
        const mdxFile = files.find(file => /\.mdx$/iu.test(file.name));
        if (!mdxFile) throw new Error("缺少 MDX 文件。");
        const attached = resolveAssociatedMddFiles(report.resources.associatedMdd, files) as File[] | null;
        if (!attached) throw new Error("MDD 文件名无法安全匹配到唯一的所选文件；请重新选择文件组。");
        const imported = await run(rich, () => rich.importDictionary({
          mdxFile,
          displayMetadata: { name: report.identity.displayTitle || fileBaseName(mdxFile.name) }
        }));
        const importedRecord = imported as Record<string, any>;
        const dictionaryId = String(importedRecord.commit?.dictionary?.id || importedRecord.commit?.dictionary?.packId || "");
        if (attached.length) {
          if (!dictionaryId) throw new Error("MDX 已安装，但无法确认目标词典标识，MDD 附件未附加。");
          try {
            onProgress("MDX 已安装，正在原子检查并添加已关联的 MDD…");
            await run(mdd, () => mdd.attachResources({ dictionaryId, mdxFileName: mdxFile.name, files: attached }));
          } catch (error) {
            retryAttachment = { dictionaryId, mdxFileName: mdxFile.name, files: attached, title: String(report.identity.displayTitle || "") };
            const cancelled = isAbort(error);
            return {
              progress: cancelled ? "MDX 已安装；MDD 附件导入已取消，原有附件保持不变。" : `MDX 已安装；MDD 未更改。${userMessage(error)}`,
              status: cancelled ? "MDD 附件导入已取消，原有附件保持不变。可检查文件后重试。" : "MDX 已安装，但 MDD 附件检查失败，原有附件保持不变。可检查文件后重试。",
              error: !cancelled, changed: true, retryMdd: true
            };
          }
        }
        return success("完成 · 富文本词典已安装");
      }
      if (route === "structured-mdict") {
        const mdxFile = files.find(file => /\.mdx$/iu.test(file.name));
        if (!mdxFile) throw new Error("缺少 MDX 文件。");
        const inspection = await inspectMdictFile(mdxFile);
        const recipe = createMdictProductRecipe(inspection, { cryptoProvider });
        await run(structured, () => structured.importDictionary({ mdxFile, recipe, displayMetadata: { name: recipe.dictionary.title, format: "mdict" } }));
        return success("完成 · 结构化词典已安装");
      }
      if (route === "stardict") {
        const inspection = await inspectStarDictFiles(files);
        const recipe = createStarDictProductRecipe(inspection, { cryptoProvider });
        await run(stardict, () => stardict.importDictionary({ ...inspection, recipe, displayMetadata: { name: recipe.dictionary.bookname, format: "stardict" } }));
        return success("完成 · StarDict 已安装");
      }
      if (route === "tflex") {
        await run(tflex, () => tflex.importDictionary({
          files,
          displayMetadata: { kind: "local-import", name: report.identity.displayTitle || "本地 TFLex 词典", format: "tflex", sourceLabel: "用户提供 · 未验证" }
        }));
        return success("完成 · TFLex 文件已通过完整安装校验");
      }
      throw new Error("没有可用的导入方式。");
    } catch (error) {
      const cancelled = isAbort(error);
      return {
        progress: cancelled ? "已取消；临时文件已清理，原有词典保持不变。" : `安装失败：${userMessage(error, route)}`,
        status: userMessage(error, route), error: !cancelled, changed: false, retryMdd: Boolean(retryAttachment)
      };
    } finally { active = null; }
  }

  async function retryMdd(): Promise<LocalImportResult> {
    const attempt = retryAttachment;
    if (!attempt) throw new Error("没有可重试的 MDD 附件。");
    try {
      await run(mdd, () => mdd.attachResources({ dictionaryId: attempt.dictionaryId, mdxFileName: attempt.mdxFileName, files: attempt.files }));
      retryAttachment = null;
      return { progress: "完成 · MDD 附件已添加", status: "MDD 附件已安全添加。", error: false, changed: true, retryMdd: false };
    } catch (error) {
      const cancelled = isAbort(error);
      return { progress: cancelled ? "已取消；原有附件保持不变。" : `MDD 附件未更改：${userMessage(error)}`, status: userMessage(error), error: !cancelled, changed: false, retryMdd: true };
    } finally { active = null; }
  }

  async function cancel() {
    return active?.cancel() || { cancelled: false, phase: "" };
  }

  async function run<T>(controller: LocalController, task: () => Promise<T>) {
    active = controller;
    return task();
  }

  function dispose() {
    active?.dispose?.(); active = null;
    rich.dispose(); structured.dispose(); stardict.dispose(); mdd.dispose(); tflex.dispose();
  }

  return { preflight, installed, importFiles, retryMdd, cancel, dispose };
}

function success(progress: string): LocalImportResult {
  return { progress, status: "词典已安装并保存在本机；不会自动调用 Provider。若需要确认词条含义，请先在划词结果中查看。", error: false, changed: true, retryMdd: false };
}
function isAbort(error: unknown) { return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError"; }

export type LocalDictionaryClient = ReturnType<typeof createLocalDictionaryClient>;
