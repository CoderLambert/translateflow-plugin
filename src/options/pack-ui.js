import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { OPTIONAL_PACK_SOURCES } from "../shared/pack-sources.js";
import { renderInstalledPackList } from "./installed-pack-ui.js";

export async function requestDictionaryPackOriginPermission(
  source,
  permissions = globalThis.chrome?.permissions
) {
  const pattern = String(source?.originPattern || "");
  if (!pattern.endsWith("/*")) {
    throw new Error("Dictionary pack source has an invalid origin permission.");
  }

  const originUrl = new URL(pattern.slice(0, -1));
  const isLocalhost = ["127.0.0.1", "localhost", "[::1]"].includes(originUrl.hostname);
  const allowedProtocol = originUrl.protocol === "https:" ||
    (source?.allowInsecureLocalhost === true && isLocalhost && originUrl.protocol === "http:");
  const exactHost = Boolean(originUrl.hostname) && !originUrl.hostname.includes("*");
  if (!allowedProtocol || !exactHost || pattern !== `${originUrl.origin}/*`) {
    throw new Error("Dictionary pack source permission must be one exact trusted origin.");
  }
  if (!permissions?.request) {
    throw new Error("Chrome optional-origin permission API is unavailable.");
  }

  return permissions.request({ origins: [pattern] });
}

export function initializePackUi({
  setStatus,
  sources = OPTIONAL_PACK_SOURCES,
  runtime = globalThis.chrome?.runtime,
  permissions = globalThis.chrome?.permissions,
  cryptoProvider = globalThis.crypto
} = {}) {
  const bundledList = document.getElementById("bundledLexiconList");
  const installedList = document.getElementById("installedDictionaryList");
  const optionalList = document.getElementById("dictionaryPacksList");
  const refreshButton = document.getElementById("refreshDictionaryPacks");
  if (!bundledList && !installedList && !optionalList) {
    return Promise.resolve();
  }

  const pendingByPack = new Map();
  refreshButton?.addEventListener("click", () => refresh());
  document.addEventListener(
    "translateflow:dictionary-state-changed",
    () => refresh()
  );

  async function refresh() {
    if (bundledList) bundledList.textContent = "正在检查内置词典…";
    if (installedList) installedList.textContent = "正在读取已安装词典…";
    if (optionalList) optionalList.textContent = "正在读取官方推荐词典状态…";

    const [bundledResponse, optionalResponse] = await Promise.all([
      runtime.sendMessage({ type: BACKGROUND_MESSAGES.BUNDLED_LEXICON_STATUS }),
      runtime.sendMessage({ type: BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS })
    ]);

    if (bundledList) {
      if (!bundledResponse?.ok) {
        bundledList.textContent = `读取内置词典状态失败：${bundledResponse?.error || "未知错误"}`;
      } else {
        renderBundled(bundledResponse.packs || []);
      }
    }

    if (!optionalResponse?.ok) {
      const message = optionalResponse?.error || "未知错误";
      if (installedList) {
        installedList.textContent = `读取已安装词典失败：${message}`;
      }
      if (optionalList) {
        optionalList.textContent = `读取官方推荐词典状态失败：${message}`;
      }
    } else {
      const state = optionalResponse.state || { packs: {} };
      if (installedList) renderInstalled(state);
      if (optionalList) renderOptional(state);
    }
  }

  function renderBundled(packs) {
    bundledList.replaceChildren();
    if (!Array.isArray(packs) || !packs.length) {
      bundledList.textContent = "当前版本没有可用的内置词典信息。";
      return;
    }

    for (const pack of packs) {
      const view = getBundledPackPresentation(pack);
      const row = document.createElement("div");
      row.className = "site-row dictionary-pack-row";

      const summary = document.createElement("div");
      summary.className = "site-summary";

      const heading = document.createElement("div");
      heading.className = "dictionary-pack-heading";
      const title = document.createElement("strong");
      title.textContent = pack.label || pack.packId || pack.id;
      const badge = document.createElement("span");
      badge.className = "dictionary-health-badge";
      badge.dataset.kind = view.kind;
      badge.textContent = view.label;
      badge.setAttribute("aria-label", `词典状态：${view.label}`);
      heading.append(title, badge);
      summary.appendChild(heading);

      if (view.meta.length) {
        const meta = document.createElement("div");
        meta.className = "dictionary-pack-meta";
        for (const item of view.meta) {
          const value = document.createElement("span");
          value.textContent = item;
          meta.appendChild(value);
        }
        summary.appendChild(meta);
      }

      if (view.detail) {
        const detail = document.createElement("small");
        detail.className = "dictionary-pack-detail";
        detail.textContent = view.detail;
        summary.appendChild(detail);
      }

      row.append(summary);
      bundledList.appendChild(row);
    }
  }

  function renderInstalled(state) {
    renderInstalledPackList({
      container: installedList,
      state,
      runtime,
      setStatus,
      sources,
      onChanged() {
        refresh();
      }
    });
  }

  function renderOptional(state) {
    optionalList.replaceChildren();
    const declared = (Array.isArray(sources) ? sources : [])
      .flatMap((source) => (Array.isArray(source?.packs) ? source.packs : [])
        .map((pack) => ({ source, pack })));

    if (!declared.length) {
      optionalList.textContent = "暂无官方推荐词典。只有完成来源、许可、质量与发布审核的 TranslateFlow 词典包才会出现在这里。";
      return;
    }

    for (const { source, pack } of declared) {
      const packId = String(pack.packId || "");
      const entry = state.packs?.[packId] || null;
      const row = document.createElement("div");
      row.className = "site-row";

      const summary = document.createElement("div");
      summary.className = "site-summary";
      const title = document.createElement("strong");
      title.textContent = pack.label || packId;
      const detail = document.createElement("small");
      detail.textContent = describePackState(source, entry);
      summary.append(title, detail);

      const actions = document.createElement("div");
      actions.className = "site-actions";
      const pendingRequestId = pendingByPack.get(packId);

      if (pendingRequestId) {
        actions.append(makeButton("取消", async (button) => {
          button.disabled = true;
          const response = await runtime.sendMessage({
            type: BACKGROUND_MESSAGES.DICTIONARY_PACK_CANCEL,
            requestId: pendingRequestId
          });
          if (!response?.ok) {
            setStatus?.(response?.error || "取消词典包操作失败。", true);
            button.disabled = false;
          }
        }));
      } else {
        actions.append(makeButton(entry?.active ? "更新 / 重装" : "安装", async (button) => {
          button.disabled = true;
          try {
            const granted = await requestDictionaryPackOriginPermission(source, permissions);
            if (!granted) {
              setStatus?.(`未授予词典包下载权限：${source.originPattern}`, true);
              return;
            }

            const requestId = cryptoProvider?.randomUUID?.() ||
              `pack-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            pendingByPack.set(packId, requestId);
            renderOptional(state);

            const response = await runtime.sendMessage({
              type: BACKGROUND_MESSAGES.DICTIONARY_PACK_INSTALL,
              sourceId: source.id,
              packId,
              requestId
            });
            if (!response?.ok) {
              const suffix = response?.errorCode ? `（${response.errorCode}）` : "";
              throw new Error(`${response?.error || "词典包安装失败"}${suffix}`);
            }
            setStatus?.(
              response.status === "already-installed"
                ? `${pack.label || packId} 已是最新且校验通过。`
                : `${pack.label || packId} 已完成安装/更新。`
            );
          } catch (error) {
            setStatus?.(error?.message || String(error), true);
          } finally {
            pendingByPack.delete(packId);
            await refresh();
          }
        }));
      }

      if (entry?.fallback && !pendingRequestId) {
        actions.append(makeButton("回滚", async (button) => {
          button.disabled = true;
          try {
            const response = await runtime.sendMessage({
              type: BACKGROUND_MESSAGES.DICTIONARY_PACK_ROLLBACK,
              packId
            });
            if (!response?.ok) throw new Error(response?.error || "词典包回滚失败。");
            setStatus?.(`${pack.label || packId} 已回滚到上一健康版本。`);
          } catch (error) {
            setStatus?.(error?.message || String(error), true);
          } finally {
            await refresh();
          }
        }));
      }

      if (entry && !pendingRequestId) {
        actions.append(makeButton("删除", async (button) => {
          button.disabled = true;
          try {
            const response = await runtime.sendMessage({
              type: BACKGROUND_MESSAGES.DICTIONARY_PACK_UNINSTALL,
              packId
            });
            if (!response?.ok) throw new Error(response?.error || "词典包删除失败。");
            setStatus?.(`${pack.label || packId} 已删除。`);
          } catch (error) {
            setStatus?.(error?.message || String(error), true);
          } finally {
            await refresh();
          }
        }));
      }

      row.append(summary, actions);
      optionalList.appendChild(row);
    }
  }

  function makeButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => action(button));
    return button;
  }

  return refresh();
}

export function getBundledPackPresentation(pack) {
  const version = String(pack?.packVersion || "").trim();
  const count = Number(pack?.recordCount || 0);
  const readyMeta = [
    version ? `版本 ${version}` : "版本未知",
    `${count.toLocaleString()} 条记录`
  ];

  if (pack?.status === "ready") {
    return {
      kind: "success",
      label: "已就绪",
      meta: readyMeta,
      detail: ""
    };
  }
  if (pack?.status === "unavailable") {
    return {
      kind: "error",
      label: "资源缺失",
      meta: [],
      detail: "内置词典资源不可用。请重新加载扩展；若仍未恢复，可查看下方修复说明。"
    };
  }
  if (pack?.status === "corrupt") {
    return {
      kind: "error",
      label: "校验失败",
      meta: [],
      detail: "词典资源校验失败或已损坏。请重新加载或重新安装词典资源。"
    };
  }
  if (pack?.status === "incompatible") {
    return {
      kind: "warning",
      label: "版本不兼容",
      meta: [],
      detail: "词典格式与当前扩展版本不兼容。请更新扩展或重新安装对应资源。"
    };
  }
  if (pack?.status === "unhealthy") {
    return {
      kind: "warning",
      label: "健康检查失败",
      meta: [],
      detail: "词典缺少必要的基准词条，当前不会作为正常可用资源。"
    };
  }
  return {
    kind: "error",
    label: "状态异常",
    meta: [],
    detail: pack?.message ? String(pack.message) : "无法确认词典状态。"
  };
}

export function describeBundledPackState(pack) {
  const view = getBundledPackPresentation(pack);
  return [view.label, ...view.meta, view.detail].filter(Boolean).join(" · ");
}

function describePackState(source, entry) {
  if (!entry) return `来源：${source.label || source.id} · 未安装`;
  if (entry.status === "needs-reinstall") {
    return `来源：${source.label || source.id} · 文件缺失或损坏，需要重新安装`;
  }
  if (!entry.active) return `来源：${source.label || source.id} · ${entry.status || "未激活"}`;
  const fallback = entry.fallback ? ` · 可回滚 ${entry.fallback.packVersion}` : "";
  return `来源：${source.label || source.id} · 当前 ${entry.active.packVersion}${fallback}`;
}
