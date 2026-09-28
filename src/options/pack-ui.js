import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { OPTIONAL_PACK_SOURCES } from "../shared/pack-sources.js";

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
  const optionalList = document.getElementById("dictionaryPacksList");
  const refreshButton = document.getElementById("refreshDictionaryPacks");
  if (!bundledList && !optionalList) return Promise.resolve();

  const pendingByPack = new Map();
  refreshButton?.addEventListener("click", () => refresh());

  async function refresh() {
    if (bundledList) bundledList.textContent = "正在检查内置词典…";
    if (optionalList) optionalList.textContent = "正在读取可选词典包状态…";

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

    if (optionalList) {
      if (!optionalResponse?.ok) {
        optionalList.textContent = `读取可选词典包状态失败：${optionalResponse?.error || "未知错误"}`;
      } else {
        renderOptional(optionalResponse.state || { packs: {} });
      }
    }
  }

  function renderBundled(packs) {
    bundledList.replaceChildren();
    if (!Array.isArray(packs) || !packs.length) {
      bundledList.textContent = "当前版本没有声明内置词典。";
      return;
    }

    for (const pack of packs) {
      const row = document.createElement("div");
      row.className = "site-row";

      const summary = document.createElement("div");
      summary.className = "site-summary";
      const title = document.createElement("strong");
      title.textContent = pack.label || pack.packId || pack.id;
      const detail = document.createElement("small");
      detail.textContent = describeBundledPackState(pack);
      summary.append(title, detail);

      row.append(summary);
      bundledList.appendChild(row);
    }
  }

  function renderOptional(state) {
    optionalList.replaceChildren();
    const declared = (Array.isArray(sources) ? sources : [])
      .flatMap((source) => (Array.isArray(source?.packs) ? source.packs : [])
        .map((pack) => ({ source, pack })));

    if (!declared.length) {
      optionalList.textContent = "当前版本没有通过产品质量门并注册为可下载来源的可选词典包。";
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
        actions.append(makeButton(entry?.active ? "检查更新 / 重装" : "安装", async (button) => {
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
        actions.append(makeButton("卸载", async (button) => {
          button.disabled = true;
          try {
            const response = await runtime.sendMessage({
              type: BACKGROUND_MESSAGES.DICTIONARY_PACK_UNINSTALL,
              packId
            });
            if (!response?.ok) throw new Error(response?.error || "词典包卸载失败。");
            setStatus?.(`${pack.label || packId} 已卸载。`);
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

export function describeBundledPackState(pack) {
  if (pack?.status === "ready") {
    return `已就绪 · ${pack.packVersion || "版本未知"} · ${Number(pack.recordCount || 0).toLocaleString()} 条记录`;
  }
  if (pack?.status === "unavailable") {
    return "资源缺失或不可读。源码开发安装请运行 npm run setup:lexicon，然后重新加载扩展。";
  }
  if (pack?.status === "corrupt") {
    return "资源校验失败或已损坏。请重新生成/安装后再试。";
  }
  if (pack?.status === "incompatible") {
    return "词典格式与当前扩展版本不兼容。";
  }
  if (pack?.status === "unhealthy") {
    return "健康检查未通过，缺少必要的基准词条。";
  }
  return `状态异常：${pack?.message || "未知错误"}`;
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
