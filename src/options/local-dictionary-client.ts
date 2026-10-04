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
  fileBaseName, importProgressMessage, resolveAssociatedMddFiles, userMessageDescriptor
} from "./local-dictionary-import-presentation.js";
import { localizedMessage } from "../i18n/messages.js";
import type { LocalizedMessage } from "../i18n/messages.js";

export type LocalPreflight = Record<string, any>;
export type InstalledDictionaryState = { candidates: Record<string, any>[]; known: { rich: boolean; packs: boolean } };
export type LocalImportResult = {
  progress: LocalizedMessage;
  status: LocalizedMessage;
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
  onProgress = (_message: LocalizedMessage) => {}
}: {
  runtime?: typeof chrome.runtime;
  WorkerCtor?: typeof Worker;
  cryptoProvider?: Crypto;
  onProgress?: (message: LocalizedMessage) => void;
} = {}) {
  let active: LocalController | null = null;
  let retryAttachment: null | { dictionaryId: string; mdxFileName: string; files: File[]; title: string } = null;
  const progress = (event: { phase?: string }) => onProgress(importProgressMessage(event.phase));
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
        if (!mdxFile) throw importError("MDX_REQUIRED");
        const attached = resolveAssociatedMddFiles(report.resources.associatedMdd, files) as File[] | null;
        if (!attached) throw importError("RICH_MDD_ASSOCIATION");
        const imported = await run(rich, () => rich.importDictionary({
          mdxFile,
          displayMetadata: { name: report.identity.displayTitle || fileBaseName(mdxFile.name) }
        }));
        const importedRecord = imported as Record<string, any>;
        const dictionaryId = String(importedRecord.commit?.dictionary?.id || importedRecord.commit?.dictionary?.packId || "");
        if (attached.length) {
          if (!dictionaryId) throw importError("MDD_TARGET_UNAVAILABLE");
          try {
            onProgress(localizedMessage("localImport.progress.attachMdd"));
            await run(mdd, () => mdd.attachResources({ dictionaryId, mdxFileName: mdxFile.name, files: attached }));
          } catch (error) {
            retryAttachment = { dictionaryId, mdxFileName: mdxFile.name, files: attached, title: String(report.identity.displayTitle || "") };
            const cancelled = isAbort(error);
            return {
              progress: localizedMessage(cancelled ? "localImport.cancelled.mdxAttached" : "localImport.failure.mdxAttached"),
              status: localizedMessage(cancelled ? "localImport.cancelled.mdxStatus" : "localImport.failure.mdxStatus"),
              error: !cancelled, changed: true, retryMdd: true
            };
          }
        }
        return success(localizedMessage("localImport.success.rich"));
      }
      if (route === "structured-mdict") {
        const mdxFile = files.find(file => /\.mdx$/iu.test(file.name));
        if (!mdxFile) throw importError("MDX_REQUIRED");
        const inspection = await inspectMdictFile(mdxFile);
        const recipe = createMdictProductRecipe(inspection, { cryptoProvider });
        await run(structured, () => structured.importDictionary({ mdxFile, recipe, displayMetadata: { name: recipe.dictionary.title, format: "mdict" } }));
        return success(localizedMessage("localImport.success.structured"));
      }
      if (route === "stardict") {
        const inspection = await inspectStarDictFiles(files);
        const recipe = createStarDictProductRecipe(inspection, { cryptoProvider });
        await run(stardict, () => stardict.importDictionary({ ...inspection, recipe, displayMetadata: { name: recipe.dictionary.bookname, format: "stardict" } }));
        return success(localizedMessage("localImport.success.stardict"));
      }
      if (route === "tflex") {
        await run(tflex, () => tflex.importDictionary({
          files,
          displayMetadata: { kind: "local-import", name: report.identity.displayTitle || "TFLex", format: "tflex", sourceLabel: "用户提供 · 未验证" }
        }));
        return success(localizedMessage("localImport.success.tflex"));
      }
      throw importError("NO_IMPORT_ROUTE");
    } catch (error) {
      const cancelled = isAbort(error);
      return {
        progress: localizedMessage(cancelled ? "localImport.failure.cancelled" : "localImport.failure.installStatus"),
        status: userMessageDescriptor(error, route), error: !cancelled, changed: false, retryMdd: Boolean(retryAttachment)
      };
    } finally { active = null; }
  }

  async function retryMdd(): Promise<LocalImportResult> {
    const attempt = retryAttachment;
    if (!attempt) throw importError("NO_RETRY_MDD");
    try {
      await run(mdd, () => mdd.attachResources({ dictionaryId: attempt.dictionaryId, mdxFileName: attempt.mdxFileName, files: attempt.files }));
      retryAttachment = null;
      return { progress: localizedMessage("localImport.success.mdd"), status: localizedMessage("localImport.success.mddAttached"), error: false, changed: true, retryMdd: false };
    } catch (error) {
      const cancelled = isAbort(error);
      return { progress: localizedMessage(cancelled ? "localImport.failure.mddCancelled" : "localImport.failure.mddStatus"), status: userMessageDescriptor(error, "mdd"), error: !cancelled, changed: false, retryMdd: true };
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

function success(progress: LocalizedMessage): LocalImportResult {
  return { progress, status: localizedMessage("localImport.success.savedLocalOnly"), error: false, changed: true, retryMdd: false };
}
function importError(code: string) { return Object.assign(new Error(code), { code }); }
function isAbort(error: unknown) { return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError"; }

export type LocalDictionaryClient = ReturnType<typeof createLocalDictionaryClient>;
