import {
  BACKGROUND_MESSAGES
} from "../shared/constants.js";
import {
  CURATED_DICTIONARIES,
  CURATED_IMPORTER_TYPES
} from "../shared/curated-dictionaries.js";
import {
  makeInstalledCatalogMetadata
} from "../shared/dictionary-catalog-v2.js";
import {
  requestDictionaryPackOriginPermission
} from "./pack-ui.js";
import {
  CURATED_WORKER_MESSAGES
} from "./workers/curated-dictionary-worker-protocol.js";
import { createCuratedEcdictMdxUi } from "./curated-ecdict-mdx-ui.js";
import {
  curatedSourceMeta,
  describeCuratedProgress,
  formatCuratedBytes,
  getCuratedInstallPresentation,
  shortCuratedRevision
} from "./curated-dictionary-presentation.js";

export { getCuratedInstallPresentation };

export function initializeCuratedDictionaryUi({
  runtime = globalThis.chrome?.runtime,
  permissions = globalThis.chrome?.permissions,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
  setStatus
} = {}) {
  const container =
    document.getElementById("curatedDictionaryList");
  if (!container) return Promise.resolve();
  if (!runtime?.sendMessage || !runtime?.getURL) {
    container.textContent = "精选词典功能不可用。";
    return Promise.resolve();
  }

  const stateBySource = new Map();
  let active = null;
  const mdxUi = createCuratedEcdictMdxUi({
    runtime,
    permissions,
    WorkerCtor,
    cryptoProvider,
    stateBySource,
    refresh: () => refresh(),
    setStatus
  });

  document.addEventListener(
    "translateflow:dictionary-state-changed",
    () => refresh()
  );

  async function refresh() {
    const [response, richResponse] = await Promise.all([
      runtime.sendMessage({
        type: BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS
      }),
      runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_LIST })
    ]);
    const packs = response?.ok
      ? response.state?.packs || {}
      : {};
    render(
      packs,
      richResponse?.ok ? richResponse.dictionaries || [] : [],
      richResponse?.ok ? "" : richResponse?.error || "无法读取富文本词典状态。"
    );
  }

  function render(packs, richDictionaries, richMdictError = "") {
    container.replaceChildren();
    for (const source of CURATED_DICTIONARIES) {
      if (source.importerType === CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1) {
        mdxUi.render(container, source, richDictionaries, richMdictError);
        continue;
      }
      const local = stateBySource.get(source.id) || {};
      const entry =
        packs[source.output.packId] || null;
      const presentation =
        getCuratedInstallPresentation(source, entry);

      const row = document.createElement("div");
      row.className = "site-row dictionary-pack-row";
      row.dataset.recipeId = source.id;

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
        makeLink("上游项目", source.upstreamRepository),
        makeLink("许可", source.sourceLicenseUrl)
      );
      summary.appendChild(links);

      const progress = document.createElement("small");
      progress.className = "dictionary-pack-detail";
      progress.setAttribute("aria-live", "polite");
      progress.textContent =
        local.message || presentation.detail;
      summary.appendChild(progress);

      const actions = document.createElement("div");
      actions.className = "site-actions";
      if (active?.sourceId === source.id) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "取消";
        cancel.addEventListener("click", () => cancelActive());
        actions.append(cancel);
      } else {
        const install = document.createElement("button");
        install.type = "button";
        install.textContent = presentation.actionLabel;
        install.addEventListener("click", () =>
          installSource(source, install)
        );
        actions.append(install);
      }

      row.append(summary, actions);
      container.appendChild(row);
    }
  }

  async function installSource(source, button) {
    if (active || mdxUi.isActive()) return;
    button.disabled = true;
    try {
      const granted =
        await requestDictionaryPackOriginPermission(
          source,
          permissions
        );
      if (!granted) {
        throw new Error(
          `未授予 ${source.label} 上游下载权限。`
        );
      }

      const requestId = makeRequestId(cryptoProvider);
      const worker = new WorkerCtor(
        runtime.getURL(
          "src/options/workers/curated-dictionary-worker.js"
        ),
        { type: "module" }
      );
      active = {
        sourceId: source.id,
        requestId,
        worker,
        phase: "worker",
        commitRequestId: ""
      };
      setLocal(source.id, "开始从固定上游版本下载…");
      await refresh();

      const ready = await waitForWorker(
        worker,
        source,
        requestId,
        (message) => {
          setLocal(
            source.id,
            describeCuratedProgress(message, source)
          );
          renderCurrent().catch(() => {});
        }
      );
      active.worker = null;
      active.phase = "commit";
      active.commitRequestId = makeRequestId(
        cryptoProvider
      );
      setLocal(
        source.id,
        "正在保存并进行后台完整性验证…"
      );
      await refresh();

      const committed = await runtime.sendMessage({
        type:
          BACKGROUND_MESSAGES.DICTIONARY_LOCAL_IMPORT_COMMIT,
        token: ready.token,
        requestId: active.commitRequestId,
        displayMetadata: {
          kind: "curated-upstream",
          name: source.label,
          format: source.displayFormat,
          sourceLabel: source.publisher,
          sourceVersion: shortCuratedRevision(
            source.upstreamRevision
          ),
          licenseLabel: source.sourceLicenseLabel,
          catalog: makeInstalledCatalogMetadata(source)
        }
      });
      if (!committed?.ok) {
        throw responseError(
          committed,
          "精选词典激活失败。"
        );
      }

      setLocal(
        source.id,
        `安装完成：${ready.stats.retainedRecords.toLocaleString()} 个词条 · 输出 ${formatCuratedBytes(ready.stats.outputBytes)}。`
      );
      document.dispatchEvent(
        new CustomEvent(
          "translateflow:dictionary-state-changed"
        )
      );
      setStatus?.(`${source.label} 已安装并可用于划词查询。`);
    } catch (error) {
      setLocal(
        source.id,
        error?.name === "AbortError"
          ? "安装已取消。"
          : error?.message || String(error)
      );
      setStatus?.(
        error?.message || String(error),
        error?.name !== "AbortError"
      );
    } finally {
      active?.worker?.terminate?.();
      active = null;
      await refresh();
    }
  }

  async function cancelActive() {
    if (mdxUi.isActive()) {
      await mdxUi.cancelActive();
      return;
    }
    const current = active;
    if (!current) return;
    if (current.phase === "commit") {
      await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.DICTIONARY_PACK_CANCEL,
        requestId: current.commitRequestId
      });
      return;
    }
    current.worker?.postMessage?.({
      type: CURATED_WORKER_MESSAGES.CANCEL,
      requestId: current.requestId
    });
  }

  async function renderCurrent() {
    await refresh();
  }

  function setLocal(sourceId, message) {
    stateBySource.set(sourceId, { message });
  }

  const pagehide = () => {
    active?.worker?.terminate?.();
    mdxUi.dispose();
  };
  window.addEventListener("pagehide", pagehide, { once: true });
  return refresh();
}

function waitForWorker(
  worker,
  source,
  requestId,
  onProgress
) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = event.data;
      if (message?.requestId !== requestId) return;
      if (message.type === CURATED_WORKER_MESSAGES.PROGRESS) {
        onProgress(message);
        return;
      }
      cleanup();
      if (message.type === CURATED_WORKER_MESSAGES.READY) {
        resolve(message);
      } else {
        reject(workerResponseError(message));
      }
    };
    const onError = (event) => {
      cleanup();
      reject(
        event?.error ||
        new Error("精选词典 Worker 执行失败。")
      );
    };
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({
      type: CURATED_WORKER_MESSAGES.START,
      requestId,
      sourceId: source.id
    });
  });
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
    throw new Error(
      "WebCrypto randomUUID is required for curated dictionary install."
    );
  }
  return "curated-" + id;
}

function workerResponseError(message) {
  if (message?.errorName === "AbortError") {
    return new DOMException(
      message.error || "精选词典安装已取消。",
      "AbortError"
    );
  }
  const error = new Error(
    message?.error || "精选词典 Worker 执行失败。"
  );
  error.code = message?.errorCode || "";
  return error;
}

function responseError(response, fallback) {
  const error = new Error(
    response?.error || fallback
  );
  error.code = response?.errorCode || "";
  return error;
}


if (typeof document !== "undefined") {
  initializeCuratedDictionaryUi();
}
