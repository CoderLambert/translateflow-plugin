import { useCallback, useEffect, useRef, useState } from "react";
import { CONTENT_MESSAGES } from "../shared/constants.js";
import { createI18n } from "../i18n/index.js";
import { getPresetLabel } from "../shared/presets.js";
import type { AppearanceStatus, CacheStatus, EffectiveContext, PopupClient, TaskStatus, ToggleStatus } from "./client";

type Notice = { message: string; error: boolean };
type Loadable<T> = { loading: boolean; value: T | null; error: string };
const loading = <T,>(): Loadable<T> => ({ loading: true, value: null, error: "" });

export function usePopup(client: PopupClient) {
  const [notice, setNotice] = useState<Notice>({ message: "准备就绪", error: false });
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [context, setContext] = useState<Loadable<EffectiveContext>>(loading);
  const [cache, setCache] = useState<Loadable<CacheStatus>>(loading);
  const [auto, setAuto] = useState<Loadable<ToggleStatus>>(loading);
  const [cacheRestore, setCacheRestore] = useState<Loadable<ToggleStatus>>(loading);
  const [quick, setQuick] = useState<Loadable<ToggleStatus>>(loading);
  const [appearance, setAppearance] = useState<Loadable<AppearanceStatus>>(loading);
  const [preset, setPreset] = useState("inherit");
  const [learningLabel, setLearningLabel] = useState("学习中心");
  const active = useRef(false), generation = useRef(0), task = useRef<{ id: string; tabId: number } | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, error = false) => setNotice({ message, error }), []);
  const read = useCallback(async <T,>(loader: () => Promise<T>, setter: (value: Loadable<T>) => void, fallback: string) => {
    const current = generation.current;
    setter({ loading: true, value: null, error: "" });
    try { const value = await loader(); if (active.current && current === generation.current) setter({ loading: false, value, error: "" }); }
    catch (error) { if (active.current && current === generation.current) setter({ loading: false, value: null, error: error instanceof Error ? error.message : fallback }); }
  }, []);

  const refreshContext = useCallback(() => read(client.context, value => {
    setContext(value);
    const item = value.value;
    if (item) setPreset(item.temporaryPresetActive ? item.temporaryPresetId || "none" : item.savedPresetId || "inherit");
  }, "当前页面无法读取翻译模式。"), [client, read]);
  const refreshCache = useCallback(() => read(client.cacheStatus, setCache, "普通 http/https 网页可使用翻译缓存"), [client, read]);
  const refreshAuto = useCallback(() => read(() => client.toggleStatus("auto"), setAuto, "当前页面不支持站点自动翻译"), [client, read]);
  const refreshCacheRestore = useCallback(() => read(() => client.toggleStatus("cache"), setCacheRestore, "当前页面不支持自动缓存恢复"), [client, read]);
  const refreshQuick = useCallback(() => read(() => client.toggleStatus("quick"), setQuick, "当前页面不支持 Quick Control"), [client, read]);
  const refreshAppearance = useCallback(() => read(client.appearance, setAppearance, "当前页面不支持阅读外观"), [client, read]);

  useEffect(() => {
    active.current = true; generation.current += 1;
    void Promise.allSettled([refreshContext(), refreshCache(), refreshAuto(), refreshCacheRestore(), refreshQuick(), refreshAppearance()]);
    chrome.storage.local.get("uiLocale").then(({ uiLocale }) => { if (active.current) setLearningLabel(createI18n({ uiLocale, browserLocale: chrome.i18n.getUILanguage() }).t("learning.title")); }).catch(() => {});
    return () => { active.current = false; generation.current += 1; if (timer.current) clearTimeout(timer.current); timer.current = null; task.current = null; };
  }, [refreshAppearance, refreshAuto, refreshCache, refreshCacheRestore, refreshContext, refreshQuick]);

  const poll = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const run = async () => {
      const current = task.current;
      if (!current || !active.current) return;
      try { const result = await client.taskStatus(current.tabId, current.id); if (result.task) renderTask(result.task); } catch {}
      if (task.current && active.current) timer.current = setTimeout(run, 250);
    };
    timer.current = setTimeout(run, 100);
  }, [client]);

  function renderTask(value: TaskStatus) {
    const progress = value.total > 0 ? ` ${Math.min(value.done, value.total)}/${value.total}` : "";
    const labels: Record<string, string> = { queued: "准备翻译…", cache_lookup: `正在检查缓存…${progress}`, translating: `正在调用模型翻译…${progress}`, storing: `正在保存译文…${progress}`, completed: `翻译完成${progress}`, failed: value.error || "翻译失败", cancelled: "翻译已取消" };
    show(labels[value.state] || "正在处理…", value.state === "failed");
  }

  const translate = useCallback(async () => {
    if (busy) return;
    setBusy(true); show("正在准备翻译…");
    try {
      const id = crypto.randomUUID();
      const prepared = await client.prepareTranslation(id);
      task.current = { id, tabId: prepared.site.tab.id }; setTranslating(true); poll();
      const response = await prepared.run();
      if (!response.ok) throw new Error(String(response.error || "翻译失败"));
      show(response.cancelled ? "翻译已取消。" : String(response.message || `已处理 ${Number(response.count || 0)} 个段落`));
      await refreshCache();
    } catch (error) { show(error instanceof Error ? error.message : String(error), true); }
    finally { if (timer.current) clearTimeout(timer.current); timer.current = null; task.current = null; if (active.current) { setTranslating(false); setBusy(false); } }
  }, [client, poll, refreshCache, show]);

  const cancel = useCallback(async () => {
    const current = task.current; if (!current) return;
    show("正在取消翻译…");
    try { await client.cancel(current.tabId, current.id); }
    catch (error) { show(`取消失败：${error instanceof Error ? error.message : String(error)}`, true); }
  }, [client, show]);

  const pageAction = useCallback(async (type: string) => {
    setBusy(true); show(type === CONTENT_MESSAGES.RESTORE_CACHE ? "正在处理页面…" : "处理中…");
    try {
      const response = await client.action(type);
      if (!response.ok) throw new Error(String(response.error || "操作失败"));
      if (type === CONTENT_MESSAGES.TOGGLE_TRANSLATIONS) show(response.hidden ? "译文已隐藏" : "译文已显示");
      else if (type === CONTENT_MESSAGES.CLEAR_TRANSLATIONS) show("已从页面移除译文；IndexedDB 缓存仍保留。");
      else if (type === CONTENT_MESSAGES.CLEAR_PAGE_CACHE) show(`已删除本页 ${Number(response.deleted || 0)} 条缓存记录。`);
      else show(String(response.message || `已处理 ${Number(response.count || 0)} 个段落`));
      await refreshCache();
    } catch (error) { show(error instanceof Error ? error.message : String(error), true); }
    finally { if (active.current) setBusy(false); }
  }, [client, refreshCache, show]);

  const toggleSite = useCallback(async (kind: "auto" | "cache" | "quick", value: Loadable<ToggleStatus>) => {
    if (!value.value) return;
    setBusy(true); show("正在更新本站设置…");
    try { show(await client.toggleSite(kind, value.value)); }
    catch (error) { show(error instanceof Error ? error.message : String(error), true); }
    finally {
      if (active.current) setBusy(false);
      await (kind === "auto" ? refreshAuto() : kind === "cache" ? refreshCacheRestore() : refreshQuick());
      if (kind !== "quick") await refreshCache();
    }
  }, [client, refreshAuto, refreshCache, refreshCacheRestore, refreshQuick, show]);

  const changeAppearance = useCallback(async (value: string) => {
    setAppearance(current => ({ ...current, loading: true }));
    try { const next = await client.saveAppearance(value); if (active.current) setAppearance({ loading: false, value: next, error: "" }); }
    catch (error) { show(error instanceof Error ? error.message : String(error), true); await refreshAppearance(); }
  }, [client, refreshAppearance, show]);

  const applyPreset = useCallback(async (persist: boolean) => {
    setBusy(true); show("正在更新翻译模式…");
    try {
      const result = await client.applyPreset(preset, persist); setContext({ loading: false, value: result.context, error: "" });
      if (result.context.hasSitePromptOverride) show(persist ? "模式已保存到本站，但本站自定义 Prompt 优先，因此当前翻译行为不变。" : "已记录临时模式，但本站自定义 Prompt 优先，因此当前翻译行为不变。");
      else { show(persist ? "翻译模式已保存到本站。" : "已临时切换当前站点的翻译模式。"); if (result.before.presetId !== result.context.presetId) await translate(); }
    } catch (error) { show(error instanceof Error ? error.message : String(error), true); }
    finally { if (active.current) setBusy(false); }
  }, [client, preset, show, translate]);

  const openLearning = useCallback(async () => { try { await client.openLearning(); } catch (error) { show(error instanceof Error ? error.message : String(error), true); } }, [client, show]);
  return { notice, busy, translating, context, cache, auto, cacheRestore, quick, appearance, preset, setPreset, learningLabel, refreshContext, refreshCache, refreshAuto, refreshCacheRestore, refreshQuick, translate, cancel, pageAction, toggleSite, changeAppearance, applyPreset, openLearning };
}

export function contextHint(value: EffectiveContext) {
  if (value.hasSitePromptOverride) return getPresetLabel(value.selectedPresetId) ? `本站自定义 Prompt 优先；已配置 ${getPresetLabel(value.selectedPresetId)}，当前不生效。` : "本站自定义 Prompt 优先。";
  if (value.presetSource === "temporary") return value.presetId ? `临时模式：${getPresetLabel(value.presetId)}；浏览器会话结束后自动清除。` : "临时关闭 Preset；浏览器会话结束后自动清除。";
  if (value.presetSource === "site") return `本站已保存模式：${getPresetLabel(value.presetId)}。`;
  return value.glossaryCount ? `默认 Prompt · 当前有效术语 ${value.glossaryCount} 条。` : "使用默认/自定义全局 Prompt。";
}
