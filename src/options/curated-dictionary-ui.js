import {
  BACKGROUND_MESSAGES
} from "../shared/constants.js";
import {
  CURATED_DICTIONARIES
} from "../shared/curated-dictionaries.js";
import {
  requestDictionaryPackOriginPermission
} from "./pack-ui.js";
import {
  CURATED_WORKER_MESSAGES
} from "./workers/curated-dictionary-worker-protocol.js";

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

  document.addEventListener(
    "translateflow:dictionary-state-changed",
    () => refresh()
  );

  async function refresh() {
    const response = await runtime.sendMessage({
      type: BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS
    });
    const packs = response?.ok
      ? response.state?.packs || {}
      : {};
    render(packs);
  }

  function render(packs) {
    container.replaceChildren();
    for (const source of CURATED_DICTIONARIES) {
      const local = stateBySource.get(source.id) || {};
      const installed =
        Boolean(packs[source.output.packId]?.active);

      const row = document.createElement("div");
      row.className = "site-row dictionary-pack-row";

      const summary = document.createElement("div");
      summary.className = "site-summary";
      const heading = document.createElement("div");
      heading.className = "dictionary-pack-heading";
      const title = document.createElement("strong");
      title.textContent = source.label;
      const badge = document.createElement("span");
      badge.className = "dictionary-health-badge";
      badge.dataset.kind = installed ? "success" : "warning";
      badge.textContent = installed ? "已安装" : "上游 / 社区";
      heading.append(title, badge);
      summary.appendChild(heading);

      const description = document.createElement("small");
      description.textContent = source.description;
      summary.appendChild(description);

      const meta = document.createElement("div");
      meta.className = "dictionary-pack-meta";
      for (const item of sourceMeta(source)) {
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
        local.message || defaultStateText(source, installed);
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
        install.textContent = installed ? "重新安装" : "下载并安装";
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
    if (active) return;
    button.disabled = true;
    try {
      const granted =
        await requestDictionaryPackOriginPermission(
          source,
          permissions
        );
      if (!granted) {
        throw new Error(
          "未授予 ECDICT 上游下载权限。"
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
            describeProgress(message, source)
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
          format: "ecdict-csv",
          sourceLabel: source.publisher,
          sourceVersion: shortRevision(
            source.upstreamRevision
          ),
          licenseLabel: source.sourceLicenseLabel
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
        `安装完成：${ready.stats.retainedRecords.toLocaleString()} 个词条 · 输出 ${formatBytes(ready.stats.outputBytes)}。`
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
    const response = await runtime.sendMessage({
      type: BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS
    });
    render(
      response?.ok ? response.state?.packs || {} : {}
    );
  }

  function setLocal(sourceId, message) {
    stateBySource.set(sourceId, { message });
  }

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

function sourceMeta(source) {
  return [
    `来源：${source.publisher}`,
    `格式：${source.sourceFormat}`,
    `方向：${source.languageDirection}`,
    `固定版本：${shortRevision(source.upstreamRevision)}`,
    `上游下载：${formatBytes(source.downloadBytes)}`,
    `本地最多保留 ${source.selection.maxRecords.toLocaleString()} 条`,
    "信任：上游 / 社区，非 TranslateFlow 官方词典"
  ];
}

function defaultStateText(source, installed) {
  return installed
    ? "已安装；重新安装仍从同一固定上游版本下载并重新验证。"
    : "点击后直接从上游下载；TranslateFlow 不镜像该词典内容。";
}

function describeProgress(message, source) {
  if (message.phase === "download") {
    const loaded = Number(message.inputBytes || 0);
    return loaded
      ? `正在下载/筛选：${formatBytes(loaded)} / ${formatBytes(source.downloadBytes)}`
      : "正在连接固定上游版本…";
  }
  if (message.phase === "convert") {
    return `正在转换：已保留 ${Number(message.retainedRecords || 0).toLocaleString()} 个词条…`;
  }
  if (message.phase === "stage") {
    return "正在写入隔离区并准备完整性验证…";
  }
  return "正在处理…";
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

function shortRevision(value) {
  return String(value || "").slice(0, 12);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) {
    return (value / 1024).toFixed(1) + " KiB";
  }
  return (value / (1024 * 1024)).toFixed(1) + " MiB";
}
