import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { CURATED_DICTIONARY_IDS } from "../shared/curated-dictionaries.js";
import {
  createRichMdictImportController
} from "./rich-mdict-import-controller.js";
import {
  CURATED_ECDICT_MDX_WORKER_MESSAGES
} from "./workers/curated-ecdict-mdx-worker-protocol.js";
import {
  curatedSourceMeta,
  formatCuratedBytes,
  getCuratedMdxInstallPresentation
} from "./curated-dictionary-presentation.js";

const WORKER_PATH = "src/options/workers/curated-ecdict-mdx-worker.js";

export function createCuratedEcdictMdxUi({
  runtime,
  permissions,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
  stateBySource = new Map(),
  refresh = async () => {},
  setStatus
} = {}) {
  let active = null;
  let richMdictController = null;
  let detailNode = null;

  function render(container, source, dictionaries, richMdictError = "") {
    const local = stateBySource.get(source.id) || {};
    const dictionary = dictionaries.find(
      (item) => item.id === source.output.packId
    ) || null;
    const presentation = getCuratedMdxInstallPresentation(source, dictionary);
    const row = document.createElement("div");
    row.className = "site-row dictionary-pack-row";
    row.dataset.recipeId = source.id;
    row.dataset.packId = source.output.packId;
    row.dataset.trustClass = source.trustClass;

    const summary = document.createElement("div");
    summary.className = "site-summary";
    const heading = document.createElement("div");
    heading.className = "dictionary-pack-heading";
    const title = document.createElement("strong");
    title.textContent = source.label;
    const badge = document.createElement("span");
    badge.className = "dictionary-health-badge";
    badge.dataset.kind = presentation.kind;
    badge.textContent = presentation.badgeLabel;
    heading.append(title, badge);
    summary.appendChild(heading);

    const description = document.createElement("small");
    description.textContent = source.description;
    summary.appendChild(description);
    const meta = document.createElement("div");
    meta.className = "dictionary-pack-meta";
    for (const item of curatedSourceMeta(source)) {
      const value = document.createElement("span");
      value.textContent = item;
      meta.appendChild(value);
    }
    summary.appendChild(meta);

    const links = document.createElement("div");
    links.className = "dictionary-pack-meta";
    links.append(
      makeLink("ECDICT 上游项目", source.upstreamRepository),
      makeLink("仓库许可证", source.sourceLicenseUrl)
    );
    summary.appendChild(links);

    const licenseNotice = document.createElement("small");
    licenseNotice.className = "dictionary-pack-license";
    licenseNotice.textContent = source.sourceLicenseNotice;
    summary.appendChild(licenseNotice);

    const limitations = document.createElement("details");
    limitations.className = "dictionary-pack-limitations";
    const limitationsTitle = document.createElement("summary");
    limitationsTitle.textContent = "来源限制与使用说明";
    const limitationsList = document.createElement("ul");
    for (const text of source.knownLimitations) {
      const item = document.createElement("li");
      item.textContent = text;
      limitationsList.appendChild(item);
    }
    limitations.append(limitationsTitle, limitationsList);
    summary.appendChild(limitations);

    detailNode = document.createElement("small");
    detailNode.className = "dictionary-pack-detail";
    detailNode.setAttribute("aria-live", "polite");
    detailNode.textContent = local.message || richMdictError || presentation.detail;
    summary.appendChild(detailNode);

    const actions = document.createElement("div");
    actions.className = "site-actions";
    if (active?.sourceId === source.id) {
      actions.append(makeActionButton("取消", "cancel", () => cancelActive()));
    } else if (!richMdictError && presentation.status !== "identity-conflict") {
      actions.append(makeActionButton(
        presentation.actionLabel,
        dictionary ? "reinstall" : "install",
        (button) => install(source, dictionary, button)
      ));
      if (dictionary) {
        actions.append(makeActionButton(
          "删除",
          "delete",
          (button) => uninstall(source, button)
        ));
      }
    }
    row.append(summary, actions);
    container.appendChild(row);
  }

  async function install(source, existingDictionary, button) {
    if (active) return;
    button.disabled = true;
    try {
      const origins = curatedMdxPermissionOrigins(source);
      if (!permissions?.request) {
        throw new Error("Chrome optional-origin permission API is unavailable.");
      }
      const granted = await permissions.request({ origins });
      if (!granted) {
        throw new Error(
          "未授予 ECDICT GitHub Release 和其精确资产 CDN 的下载权限。"
        );
      }

      const requestId = makeRequestId(cryptoProvider);
      const worker = new WorkerCtor(runtime.getURL(WORKER_PATH), { type: "module" });
      active = {
        sourceId: source.id,
        requestId,
        worker,
        phase: "download",
        richController: null
      };
      setLocal(source.id, "开始从固定 GitHub Release 下载…");
      await refresh();

      const ready = await waitForEcdictMdxWorker(
        worker,
        source,
        requestId,
        (message) => {
          setLocal(
            source.id,
            describeCuratedMdxProgress(message, source)
          );
          updateDetail();
        }
      );
      active.worker = null;
      active.phase = "rich-import";
      active.richController = getRichMdictController();
      setLocal(source.id, "ZIP 校验通过，正在建立富文本 MDX 索引并保存离线词典…");
      await refresh();

      const mdxFile = normalizeExtractedMdxFile(ready.file, source);
      const installed = await active.richController.importDictionary({
        mdxFile,
        displayMetadata: { name: source.mdx.title },
        curatedRecipe: source,
        expectedActiveVersion: existingDictionary?.packVersion || ""
      });
      const dictionary = installed.commit?.dictionary || {};
      setLocal(
        source.id,
        `已安装审核版本 ${source.upstreamRevision} · ${formatCuratedBytes(installed.ready.metadata.sourceSize)} MDX · ${Number(installed.ready.metadata.entryCount || 0).toLocaleString()} 词条。`
      );
      document.dispatchEvent(
        new CustomEvent("translateflow:dictionary-state-changed")
      );
      setStatus?.(`${dictionary.title || source.label} 已安装并可离线查词。`);
    } catch (error) {
      setLocal(
        source.id,
        error?.name === "AbortError"
          ? "安装已取消；原有健康版本保持可用。"
          : error?.message || String(error)
      );
      setStatus?.(error?.message || String(error), error?.name !== "AbortError");
    } finally {
      active?.worker?.terminate?.();
      active = null;
      await refresh();
    }
  }

  async function uninstall(source, button) {
    button.disabled = true;
    try {
      const response = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.RICH_MDICT_UNINSTALL,
        packId: source.output.packId
      });
      if (!response?.ok) {
        throw responseError(response, "ECDICT 富文本词典删除失败。");
      }
      stateBySource.delete(source.id);
      setStatus?.(`${source.label} 已删除，MDX 与索引文件已清理。`);
      document.dispatchEvent(
        new CustomEvent("translateflow:dictionary-state-changed")
      );
    } catch (error) {
      setStatus?.(error?.message || String(error), true);
    } finally {
      await refresh();
    }
  }

  function getRichMdictController() {
    if (!richMdictController) {
      richMdictController = createRichMdictImportController({
        runtime,
        WorkerCtor,
        cryptoProvider,
        onProgress(event) {
          const sourceId = active?.sourceId;
          if (!sourceId || active.phase !== "rich-import") return;
          setLocal(sourceId, describeRichMdictProgress(event.phase));
          updateDetail();
        }
      });
    }
    return richMdictController;
  }

  async function cancelActive() {
    const current = active;
    if (!current) return;
    if (current.phase === "download") {
      current.worker?.postMessage?.({
        type: CURATED_ECDICT_MDX_WORKER_MESSAGES.CANCEL,
        requestId: current.requestId
      });
      return;
    }
    if (current.phase === "rich-import") {
      await current.richController?.cancel?.();
    }
  }

  function updateDetail() {
    const message = stateBySource.get(active?.sourceId)?.message;
    if (detailNode && message) detailNode.textContent = message;
  }

  function setLocal(sourceId, message) {
    stateBySource.set(sourceId, { message });
  }

  return {
    render,
    isActive: () => Boolean(active),
    cancelActive,
    dispose() {
      active?.worker?.terminate?.();
      richMdictController?.dispose?.();
    }
  };
}

function waitForEcdictMdxWorker(worker, source, requestId, onProgress) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
    };
    const onMessage = (event) => {
      const message = event?.data;
      if (message?.requestId !== requestId) return;
      if (message.type === CURATED_ECDICT_MDX_WORKER_MESSAGES.PROGRESS) {
        onProgress(message);
        return;
      }
      cleanup();
      if (
        message.type === CURATED_ECDICT_MDX_WORKER_MESSAGES.READY &&
        message.sourceId === source.id &&
        Number(message.metadata?.mdxBytes) === source.mdx.bytes
      ) {
        resolve(message);
      } else {
        reject(workerResponseError(message));
      }
    };
    const onError = (event) => {
      cleanup();
      reject(event?.error || new Error("ECDICT MDX 下载 Worker 执行失败。"));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({
      type: CURATED_ECDICT_MDX_WORKER_MESSAGES.START,
      requestId,
      sourceId: source.id
    });
  });
}

function curatedMdxPermissionOrigins(source) {
  if (
    source?.id !== CURATED_DICTIONARY_IDS.ECDICT_EN_ZH_MDX ||
    source?.originPattern !== "https://github.com/*" ||
    source?.downloadRedirectOrigin !== "https://release-assets.githubusercontent.com"
  ) {
    throw new Error("ECDICT MDX recipe origin permission is not the reviewed host pair.");
  }
  const github = new URL(source.originPattern.slice(0, -1));
  const redirect = new URL(source.downloadRedirectOrigin);
  if (
    github.protocol !== "https:" || github.hostname !== "github.com" ||
    github.pathname !== "/" || github.search || github.hash ||
    redirect.protocol !== "https:" ||
    redirect.hostname !== "release-assets.githubusercontent.com" ||
    redirect.pathname !== "/" || redirect.search || redirect.hash
  ) {
    throw new Error("ECDICT MDX recipe origin permission is not an exact HTTPS host.");
  }
  return [source.originPattern, `${redirect.origin}/*`];
}

function normalizeExtractedMdxFile(value, source) {
  if (
    !value || typeof value.slice !== "function" ||
    Number(value.size) !== source.mdx.bytes
  ) {
    throw new Error("ECDICT MDX extractor returned an invalid file.");
  }
  if (String(value.name || "") === source.mdx.fileName) return value;
  if (typeof File !== "function") {
    Object.defineProperty(value, "name", {
      configurable: true,
      enumerable: true,
      value: source.mdx.fileName
    });
    return value;
  }
  return new File([value], source.mdx.fileName, {
    type: value.type || "application/octet-stream",
    lastModified: 0
  });
}

function describeRichMdictProgress(phase) {
  if (phase === "preflight") return "检查本地空间并准备安全安装…";
  if (phase === "index") return "正在检查 MDX 结构并建立查询索引…";
  if (phase === "store-source") return "正在保存离线 MDX 文件…";
  if (phase === "store-index") return "正在保存本地查询索引…";
  if (phase === "commit") return "正在后台重建索引并启用词典…";
  if (phase === "done") return "富文本 MDX 已启用。";
  return "正在处理富文本 MDX…";
}

function describeCuratedMdxProgress(message, source) {
  if (message.phase === "download") {
    const loaded = Number(message.inputBytes || 0);
    return loaded
      ? `下载审核 Release：${formatCuratedBytes(loaded)} / ${formatCuratedBytes(source.downloadBytes)}`
      : "正在连接固定 GitHub Release 与资产 CDN…";
  }
  if (message.phase === "extract") {
    return `正在解压并校验 MDX：${formatCuratedBytes(message.outputBytes || 0)} / ${formatCuratedBytes(source.mdx.bytes)}`;
  }
  return "正在验证固定上游词典…";
}

function makeActionButton(label, action, callback) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  button.addEventListener("click", () => callback(button));
  return button;
}

function makeLink(label, href) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = label;
  return link;
}

function makeRequestId(cryptoProvider) {
  const id = cryptoProvider?.randomUUID?.();
  if (!id) {
    throw new Error("WebCrypto randomUUID is required for curated dictionary install.");
  }
  return "curated-" + id;
}

function workerResponseError(message) {
  if (message?.errorName === "AbortError") {
    return new DOMException(message.error || "精选词典安装已取消。", "AbortError");
  }
  const error = new Error(message?.error || "精选词典 Worker 执行失败。");
  error.code = message?.errorCode || "";
  return error;
}

function responseError(response, fallback) {
  const error = new Error(response?.error || fallback);
  error.code = response?.errorCode || "";
  return error;
}
