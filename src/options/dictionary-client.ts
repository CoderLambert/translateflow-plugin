import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { CURATED_IMPORTER_TYPES } from "../shared/curated-dictionaries.js";
import { getCatalogPermissionOrigins, makeInstalledCatalogMetadata } from "../shared/dictionary-catalog-v2.js";
import { OPTIONAL_PACK_SOURCES } from "../shared/pack-sources.js";
import { WORKER_PATHS } from "../shared/runtime-assets.js";
import { describeCuratedProgress, shortCuratedRevision } from "./curated-dictionary-presentation.js";
import { getCuratedMdxErrorMessage } from "./dictionary-library-v2-presentation.js";
import { createMddResourceImportController } from "./mdd-resource-import-controller.js";
import { requestDictionaryPackOriginPermission } from "./pack-ui.js";
import { createRichMdictImportController } from "./rich-mdict-import-controller.js";
import { CURATED_WORKER_MESSAGES } from "./workers/curated-dictionary-worker-protocol.js";
import { CURATED_ECDICT_MDX_WORKER_MESSAGES } from "./workers/curated-ecdict-mdx-worker-protocol.js";

export type DictionaryRecord = Record<string, any>;
export type PackState = { packs: Record<string, DictionaryRecord> };
export type DictionarySnapshot = {
  bundled: DictionaryRecord[];
  packState: PackState;
  rich: DictionaryRecord[];
};
export type ProgressWriter = (message: string) => void;
type ImportController = {
  importDictionary: (input: DictionaryRecord) => Promise<DictionaryRecord>;
  attachResources: (input: DictionaryRecord) => Promise<DictionaryRecord>;
  cancel: () => Promise<DictionaryRecord>;
  dispose: () => void;
};
const makeMddController = createMddResourceImportController as unknown as (options: DictionaryRecord) => ImportController;
const makeRichController = createRichMdictImportController as unknown as (options: DictionaryRecord) => ImportController;

export function dictionaryClient({
  runtime = chrome.runtime,
  permissions = chrome.permissions,
  WorkerCtor = Worker,
  cryptoProvider = crypto
}: {
  runtime?: typeof chrome.runtime;
  permissions?: typeof chrome.permissions;
  WorkerCtor?: typeof Worker;
  cryptoProvider?: Crypto;
} = {}) {
  let activeCurated: null | {
    sourceId: string;
    requestId: string;
    phase: "download" | "worker" | "commit" | "rich-import";
    worker: Worker | null;
    commitRequestId: string;
    richController: ImportController | null;
  } = null;
  let activeMdd: ImportController | null = null;

  async function load(): Promise<DictionarySnapshot> {
    const [bundled, packs, rich] = await Promise.all([
      runtime.sendMessage({ type: BACKGROUND_MESSAGES.BUNDLED_LEXICON_STATUS }),
      runtime.sendMessage({ type: BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS }),
      runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_LIST })
    ]);
    if (!bundled?.ok) throw new Error(bundled?.error || "读取内置词典状态失败。");
    if (!packs?.ok) throw new Error(packs?.error || "读取已安装词典状态失败。");
    if (!rich?.ok) throw new Error(rich?.error || "读取富文本词典状态失败。");
    return {
      bundled: Array.isArray(bundled.packs) ? bundled.packs : [],
      packState: packs.state && typeof packs.state === "object" ? packs.state : { packs: {} },
      rich: Array.isArray(rich.dictionaries) ? rich.dictionaries : []
    };
  }

  async function uninstallPack(packId: string) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.DICTIONARY_PACK_UNINSTALL, packId }), "词典删除失败。");
  }
  async function rollbackPack(packId: string) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.DICTIONARY_PACK_ROLLBACK, packId }), "词典包回滚失败。");
  }
  async function uninstallRich(packId: string) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_UNINSTALL, packId }), "富文本词典删除失败。");
  }
  async function updateRichPreferences(dictionaryId: string, preferences: Record<string, boolean>) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_UPDATE, dictionaryId, preferences }), "词典显示偏好保存失败。");
  }
  async function reorderRich(dictionaryIds: string[]) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_REORDER, dictionaryIds }), "词典排序保存失败。");
  }
  async function promoteRich(dictionaryId: string) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_PROMOTE, dictionaryId }), "设置个人首选失败。");
  }

  async function attachMdd(dictionary: DictionaryRecord, files: File[], onProgress: ProgressWriter) {
    if (activeMdd) throw new Error("另一组 MDD 附件正在处理中。");
    const controller = makeMddController({
      runtime, WorkerCtor, cryptoProvider,
      onProgress(event: { phase?: string }) { onProgress(resourceProgressLabel(event.phase)); }
    });
    activeMdd = controller;
    try {
      return await controller.attachResources({ dictionaryId: dictionary.id, mdxFileName: dictionary.fileName, files });
    } finally {
      controller.dispose();
      if (activeMdd === controller) activeMdd = null;
    }
  }
  async function cancelMdd() { return activeMdd?.cancel() || { cancelled: false, phase: "" }; }

  async function installOfficial(source: DictionaryRecord, pack: DictionaryRecord) {
    const granted = await requestDictionaryPackOriginPermission(source, permissions);
    if (!granted) throw new Error(`未授予词典包下载权限：${String(source.originPattern || "")}`);
    const requestId = makeRequestId("pack", cryptoProvider);
    return requireOk(runtime.sendMessage({
      type: BACKGROUND_MESSAGES.DICTIONARY_PACK_INSTALL,
      sourceId: source.id,
      packId: pack.packId,
      requestId
    }), "词典包安装失败。");
  }

  async function installCurated(source: DictionaryRecord, existing: DictionaryRecord | null, onProgress: ProgressWriter) {
    if (activeCurated) throw new Error("另一项精选词典操作正在进行。");
    return source.importerType === CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1
      ? installCuratedMdx(source, existing, onProgress)
      : installCuratedStructured(source, onProgress);
  }

  async function installCuratedStructured(source: DictionaryRecord, onProgress: ProgressWriter) {
    const granted = await requestDictionaryPackOriginPermission(source, permissions);
    if (!granted) throw new Error(`未授予 ${String(source.label || "精选词典")} 上游下载权限。`);
    const requestId = makeRequestId("curated", cryptoProvider);
    const worker = new WorkerCtor(runtime.getURL(WORKER_PATHS.curatedDictionary), { type: "module" });
    activeCurated = { sourceId: source.id, requestId, phase: "worker", worker, commitRequestId: "", richController: null };
    try {
      onProgress("开始从固定上游版本下载…");
      const ready = await waitForWorker(worker, requestId, CURATED_WORKER_MESSAGES, message => onProgress(describeCuratedProgress(message, source)), source.id);
      if (!activeCurated || activeCurated.requestId !== requestId) throw abortError();
      activeCurated.worker = null;
      activeCurated.phase = "commit";
      activeCurated.commitRequestId = makeRequestId("curated-commit", cryptoProvider);
      onProgress("正在保存并进行后台完整性验证…");
      return await requireOk(runtime.sendMessage({
        type: BACKGROUND_MESSAGES.DICTIONARY_LOCAL_IMPORT_COMMIT,
        token: ready.token,
        requestId: activeCurated.commitRequestId,
        displayMetadata: {
          kind: "curated-upstream", name: source.label, format: source.displayFormat,
          sourceLabel: source.publisher, sourceVersion: shortCuratedRevision(source.upstreamRevision),
          licenseLabel: source.sourceLicenseLabel, catalog: makeInstalledCatalogMetadata(source)
        }
      }), "精选词典激活失败。");
    } finally {
      activeCurated?.worker?.terminate();
      if (activeCurated?.requestId === requestId) activeCurated = null;
    }
  }

  async function installCuratedMdx(source: DictionaryRecord, existing: DictionaryRecord | null, onProgress: ProgressWriter) {
    const origins = getCatalogPermissionOrigins(source);
    const granted = await permissions.request({ origins });
    if (!granted) throw codedError("DICTIONARY_PERMISSION_DENIED", "下载权限未获准。");
    const requestId = makeRequestId("curated", cryptoProvider);
    const worker = new WorkerCtor(runtime.getURL(WORKER_PATHS.curatedEcdictMdx), { type: "module" });
    activeCurated = { sourceId: source.id, requestId, phase: "download", worker, commitRequestId: "", richController: null };
    try {
      onProgress("正在连接已审核的上游词典…");
      const ready = await waitForWorker(worker, requestId, CURATED_ECDICT_MDX_WORKER_MESSAGES, message => onProgress(describeCuratedMdxProgress(message, source)), source.id);
      if (!activeCurated || activeCurated.requestId !== requestId) throw abortError();
      activeCurated.worker = null;
      activeCurated.phase = "rich-import";
      activeCurated.richController = makeRichController({
        runtime, WorkerCtor, cryptoProvider,
        onProgress(event: { phase?: string }) { onProgress(describeRichMdictProgress(event.phase)); }
      });
      const mdxFile = normalizeExtractedMdxFile(ready.file, source);
      return await activeCurated.richController.importDictionary({
        mdxFile,
        displayMetadata: { name: source.mdx.title },
        curatedRecipe: source,
        expectedActiveVersion: existing?.packVersion || ""
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new Error(getCuratedMdxErrorMessage(error, activeCurated?.phase));
    } finally {
      activeCurated?.worker?.terminate();
      activeCurated?.richController?.dispose();
      if (activeCurated?.requestId === requestId) activeCurated = null;
    }
  }

  async function cancelCurated() {
    const current = activeCurated;
    if (!current) return { cancelled: false, phase: "" };
    if (current.phase === "commit") {
      const response = await runtime.sendMessage({ type: BACKGROUND_MESSAGES.DICTIONARY_PACK_CANCEL, requestId: current.commitRequestId });
      return { cancelled: Boolean(response?.cancelled), phase: String(response?.phase || "commit") };
    }
    if (current.phase === "rich-import") return current.richController?.cancel() || { cancelled: false, phase: current.phase };
    current.worker?.postMessage({
      type: current.phase === "download" ? CURATED_ECDICT_MDX_WORKER_MESSAGES.CANCEL : CURATED_WORKER_MESSAGES.CANCEL,
      requestId: current.requestId
    });
    return { cancelled: true, phase: current.phase };
  }

  function dispose() {
    activeCurated?.worker?.terminate();
    activeCurated?.richController?.dispose();
    activeCurated = null;
    activeMdd?.dispose(); activeMdd = null;
  }

  return {
    load, uninstallPack, rollbackPack, uninstallRich, updateRichPreferences, reorderRich, promoteRich,
    attachMdd, cancelMdd, installOfficial, installCurated, cancelCurated, dispose,
    sources: OPTIONAL_PACK_SOURCES
  };
}

async function requireOk(promise: Promise<any>, fallback: string) {
  const response = await promise;
  if (!response?.ok) throw codedError(response?.errorCode || "DICTIONARY_OPERATION_FAILED", response?.error || fallback);
  return response;
}

function makeRequestId(prefix: string, cryptoProvider: Crypto) {
  const id = cryptoProvider.randomUUID?.();
  if (!id) throw new Error("WebCrypto randomUUID is required for dictionary operations.");
  return `${prefix}-${id}`;
}

function waitForWorker(worker: Worker, requestId: string, messages: DictionaryRecord, onProgress: (message: DictionaryRecord) => void, expectedSourceId = "") {
  return new Promise<DictionaryRecord>((resolve, reject) => {
    const cleanup = () => { worker.removeEventListener("message", onMessage); worker.removeEventListener("error", onError); worker.terminate(); };
    const onMessage = (event: MessageEvent<DictionaryRecord>) => {
      const message = event.data;
      if (message?.requestId !== requestId) return;
      if (message.type === messages.PROGRESS) { onProgress(message); return; }
      cleanup();
      if (message.type === messages.READY && (!expectedSourceId || message.sourceId === expectedSourceId)) resolve(message);
      else reject(workerResponseError(message));
    };
    const onError = (event: ErrorEvent) => { cleanup(); reject(event.error || new Error("精选词典 Worker 执行失败。")); };
    worker.addEventListener("message", onMessage); worker.addEventListener("error", onError);
    worker.postMessage({ type: messages.START, requestId, sourceId: expectedSourceId || undefined });
  });
}

function normalizeExtractedMdxFile(value: any, source: DictionaryRecord): File {
  if (!value || typeof value.slice !== "function" || Number(value.size) !== source.mdx.bytes) throw new Error("ECDICT MDX extractor returned an invalid file.");
  if (String(value.name || "") === source.mdx.fileName) return value as File;
  return new File([value], source.mdx.fileName, { type: value.type || "application/octet-stream", lastModified: 0 });
}

function describeCuratedMdxProgress(message: DictionaryRecord, source: DictionaryRecord) {
  if (message.phase === "download") return Number(message.inputBytes || 0) ? `正在下载词典：${formatBytes(message.inputBytes)} / ${formatBytes(source.downloadBytes)}` : "正在连接已审核的上游词典…";
  if (message.phase === "extract") return `正在检查词典文件：${formatBytes(message.outputBytes)} / ${formatBytes(source.mdx.bytes)}`;
  return "正在检查上游词典…";
}
function describeRichMdictProgress(phase?: string) {
  return ({ preflight: "检查本地空间并准备安全安装…", index: "正在检查词典结构…", "store-source": "正在保存离线 MDX 文件…", "store-index": "正在保存本地查询信息…", commit: "正在复核并启用词典…", done: "富文本 MDX 已启用。" } as Record<string, string>)[phase || ""] || "正在处理富文本 MDX…";
}
function resourceProgressLabel(phase?: string) {
  return ({ preflight: "检查附件与本地空间…", worker: "正在检查 MDD 附件…", index: "正在建立安全资源索引…", "store-source": "正在保存 MDD 文件…", "store-index": "正在保存资源索引…", commit: "正在原子替换附件…", done: "MDD 附件已更新。" } as Record<string, string>)[phase || ""] || "正在处理 MDD 附件…";
}
function formatBytes(value: unknown) {
  const bytes = Number(value || 0); return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
function workerResponseError(message: DictionaryRecord) {
  if (message?.errorName === "AbortError") return abortError();
  return codedError(message?.errorCode || "DICTIONARY_WORKER_FAILED", message?.error || "精选词典 Worker 执行失败。");
}
function codedError(code: string, message: string) { const error = new Error(message) as Error & { code: string }; error.code = code; return error; }
function abortError() { return new DOMException("词典操作已取消。", "AbortError"); }

export type DictionaryClient = ReturnType<typeof dictionaryClient>;
