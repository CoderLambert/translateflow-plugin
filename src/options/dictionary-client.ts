import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { CURATED_IMPORTER_TYPES } from "../shared/curated-dictionaries.js";
import { getCatalogPermissionOrigins, makeInstalledCatalogMetadata } from "../shared/dictionary-catalog-v2.js";
import { OPTIONAL_PACK_SOURCES } from "../shared/pack-sources.js";
import { WORKER_PATHS } from "../shared/runtime-assets.js";
import { describeCuratedProgress, shortCuratedRevision } from "./curated-dictionary-presentation.js";
import { getCuratedMdxErrorDescriptor } from "./dictionary-library-v2-presentation.js";
import { createMddResourceImportController } from "./mdd-resource-import-controller.js";
import { requestDictionaryPackOriginPermission } from "./pack-ui.js";
import { createRichMdictImportController } from "./rich-mdict-import-controller.js";
import { CURATED_WORKER_MESSAGES } from "./workers/curated-dictionary-worker-protocol.js";
import { CURATED_ECDICT_MDX_WORKER_MESSAGES } from "./workers/curated-ecdict-mdx-worker-protocol.js";
import { localizedMessage, type LocalizedMessage } from "../i18n/messages.js";

export type DictionaryRecord = Record<string, any>;
export type PackState = { packs: Record<string, DictionaryRecord> };
export type DictionarySnapshot = {
  bundled: DictionaryRecord[];
  packState: PackState;
  rich: DictionaryRecord[];
};
export type ProgressWriter = (message: LocalizedMessage) => void;
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
    if (!bundled?.ok || !packs?.ok || !rich?.ok) throw codedError("DICTIONARY_READ_FAILED");
    return {
      bundled: Array.isArray(bundled.packs) ? bundled.packs : [],
      packState: packs.state && typeof packs.state === "object" ? packs.state : { packs: {} },
      rich: Array.isArray(rich.dictionaries) ? rich.dictionaries : []
    };
  }

  async function uninstallPack(packId: string) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.DICTIONARY_PACK_UNINSTALL, packId }), "DICTIONARY_UNINSTALL_FAILED");
  }
  async function rollbackPack(packId: string) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.DICTIONARY_PACK_ROLLBACK, packId }), "DICTIONARY_ROLLBACK_FAILED");
  }
  async function uninstallRich(packId: string) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_UNINSTALL, packId }), "DICTIONARY_UNINSTALL_FAILED");
  }
  async function updateRichPreferences(dictionaryId: string, preferences: Record<string, boolean>) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_UPDATE, dictionaryId, preferences }), "DICTIONARY_SETTINGS_FAILED");
  }
  async function reorderRich(dictionaryIds: string[]) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_REORDER, dictionaryIds }), "DICTIONARY_SETTINGS_FAILED");
  }
  async function promoteRich(dictionaryId: string) {
    await requireOk(runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_PROMOTE, dictionaryId }), "DICTIONARY_SETTINGS_FAILED");
  }

  async function attachMdd(dictionary: DictionaryRecord, files: File[], onProgress: ProgressWriter) {
    if (activeMdd) throw codedError("DICTIONARY_OPERATION_BUSY");
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
    if (!granted) throw codedError("DICTIONARY_PERMISSION_DENIED");
    const requestId = makeRequestId("pack", cryptoProvider);
    return requireOk(runtime.sendMessage({
      type: BACKGROUND_MESSAGES.DICTIONARY_PACK_INSTALL,
      sourceId: source.id,
      packId: pack.packId,
      requestId
    }), "DICTIONARY_INSTALL_FAILED");
  }

  async function installCurated(source: DictionaryRecord, existing: DictionaryRecord | null, onProgress: ProgressWriter) {
    if (activeCurated) throw codedError("DICTIONARY_OPERATION_BUSY");
    return source.importerType === CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1
      ? installCuratedMdx(source, existing, onProgress)
      : installCuratedStructured(source, onProgress);
  }

  async function installCuratedStructured(source: DictionaryRecord, onProgress: ProgressWriter) {
    const granted = await requestDictionaryPackOriginPermission(source, permissions);
    if (!granted) throw codedError("DICTIONARY_PERMISSION_DENIED");
    const requestId = makeRequestId("curated", cryptoProvider);
    const worker = new WorkerCtor(runtime.getURL(WORKER_PATHS.curatedDictionary), { type: "module" });
    activeCurated = { sourceId: source.id, requestId, phase: "worker", worker, commitRequestId: "", richController: null };
    try {
      onProgress(localizedMessage("dictionary.curated.progressConnecting"));
      const ready = await waitForWorker(worker, requestId, CURATED_WORKER_MESSAGES, message => onProgress(describeCuratedProgress(message, source)), source.id);
      if (!activeCurated || activeCurated.requestId !== requestId) throw abortError();
      activeCurated.worker = null;
      activeCurated.phase = "commit";
      activeCurated.commitRequestId = makeRequestId("curated-commit", cryptoProvider);
      onProgress(localizedMessage("dictionary.client.verifying"));
      return await requireOk(runtime.sendMessage({
        type: BACKGROUND_MESSAGES.DICTIONARY_LOCAL_IMPORT_COMMIT,
        token: ready.token,
        requestId: activeCurated.commitRequestId,
        displayMetadata: {
          kind: "curated-upstream", name: source.label, format: source.displayFormat,
          sourceLabel: source.publisher, sourceVersion: shortCuratedRevision(source.upstreamRevision),
          licenseLabel: source.sourceLicenseLabel, catalog: makeInstalledCatalogMetadata(source)
        }
      }), "DICTIONARY_ACTIVATION_FAILED");
    } finally {
      activeCurated?.worker?.terminate();
      if (activeCurated?.requestId === requestId) activeCurated = null;
    }
  }

  async function installCuratedMdx(source: DictionaryRecord, existing: DictionaryRecord | null, onProgress: ProgressWriter) {
    const origins = getCatalogPermissionOrigins(source);
    const granted = await permissions.request({ origins });
    if (!granted) throw codedError("DICTIONARY_PERMISSION_DENIED");
    const requestId = makeRequestId("curated", cryptoProvider);
    const worker = new WorkerCtor(runtime.getURL(WORKER_PATHS.curatedEcdictMdx), { type: "module" });
    activeCurated = { sourceId: source.id, requestId, phase: "download", worker, commitRequestId: "", richController: null };
    try {
      onProgress(localizedMessage("dictionary.curated.progressMdxCheck"));
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
      const detail = getCuratedMdxErrorDescriptor(error, activeCurated?.phase);
      throw codedError("DICTIONARY_CURATED_FAILED", "", detail);
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

async function requireOk(promise: Promise<any>, fallbackCode = "DICTIONARY_OPERATION_FAILED") {
  const response = await promise;
  if (!response?.ok) throw codedError(response?.errorCode || fallbackCode);
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

function describeCuratedMdxProgress(message: DictionaryRecord, source: DictionaryRecord): LocalizedMessage {
  if (message.phase === "download") return Number(message.inputBytes || 0)
    ? localizedMessage("dictionary.curated.progressMdxDownload", { loaded: formatBytes(message.inputBytes), total: formatBytes(source.downloadBytes) })
    : localizedMessage("dictionary.curated.progressConnecting");
  if (message.phase === "extract") return localizedMessage("dictionary.curated.progressMdxExtract", { loaded: formatBytes(message.outputBytes || 0), total: formatBytes(source.mdx.bytes) });
  return localizedMessage("dictionary.curated.progressMdxCheck");
}
function describeRichMdictProgress(phase?: string): LocalizedMessage {
  const suffix = ({ preflight: "preflight", index: "index", "store-source": "storeSource", "store-index": "storeIndex", commit: "commit", done: "done" } as Record<string, string>)[phase || ""] || "unknown";
  return localizedMessage(`dictionary.richMdx.progress.${suffix}` as never);
}
function resourceProgressLabel(phase?: string): LocalizedMessage {
  const suffix = ({ preflight: "preflight", worker: "worker", index: "index", "store-source": "storeSource", "store-index": "storeIndex", commit: "commit", done: "done" } as Record<string, string>)[phase || ""] || "unknown";
  return localizedMessage(`dictionary.mdd.progress.${suffix}` as never);
}
function formatBytes(value: unknown) {
  const bytes = Number(value || 0); return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
function workerResponseError(message: DictionaryRecord) {
  if (message?.errorName === "AbortError") return abortError();
  return codedError(message?.errorCode || "DICTIONARY_WORKER_FAILED");
}
function codedError(code: string, message = "", localized?: LocalizedMessage) { const error = new Error(message) as Error & { code: string; localized?: LocalizedMessage }; error.code = code; if (localized) error.localized = localized; return error; }
function abortError() { return new DOMException("AbortError", "AbortError"); }

export type DictionaryClient = ReturnType<typeof dictionaryClient>;
