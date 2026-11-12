import { useCallback, useEffect, useRef, useState } from "react";
import { CONTENT_MESSAGES } from "../shared/constants.js";
import { getPresetLabel } from "../shared/presets.js";
import type { I18n } from "../i18n/index.js";
import type { AppearanceStatus, CacheStatus, EffectiveContext, PopupClient, TaskStatus, ToggleStatus } from "./client";

type Notice = { message: string; error: boolean };
type Loadable<T> = { loading: boolean; value: T | null; error: string };
const loading = <T,>(): Loadable<T> => ({ loading: true, value: null, error: "" });

export function usePopup(client: PopupClient, i18n: I18n, enabled = true) {
  const [notice, setNotice] = useState<Notice>({ message: "", error: false });
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [pageTask, setPageTask] = useState<TaskStatus | null>(null);
  const [context, setContext] = useState<Loadable<EffectiveContext>>(loading);
  const [cache, setCache] = useState<Loadable<CacheStatus>>(loading);
  const [auto, setAuto] = useState<Loadable<ToggleStatus>>(loading);
  const [cacheRestore, setCacheRestore] = useState<Loadable<ToggleStatus>>(loading);
  const [quick, setQuick] = useState<Loadable<ToggleStatus>>(loading);
  const [appearance, setAppearance] = useState<Loadable<AppearanceStatus>>(loading);
  const [preset, setPreset] = useState("inherit");
  const active = useRef(false), generation = useRef(0), task = useRef<{ id: string; tabId: number; owned: boolean } | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const taskEpoch = useRef(0);
  const show = useCallback((message: string, error = false) => setNotice({ message, error }), []);
  const read = useCallback(async <T,>(loader: () => Promise<T>, setter: (value: Loadable<T> | ((previous: Loadable<T>) => Loadable<T>)) => void, fallback: string) => {
    const current = generation.current;
    setter(previous => ({ loading: true, value: null, error: previous.error }));
    try { const value = await loader(); if (active.current && current === generation.current) setter({ loading: false, value, error: "" }); }
    catch (error) { if (active.current && current === generation.current) setter({ loading: false, value: null, error: error instanceof Error ? error.message : fallback }); }
  }, []);

  const refreshContext = useCallback(() => read(client.context, value => {
    setContext(value);
    const item = typeof value === "function" ? null : value.value;
    if (item) setPreset(item.temporaryPresetActive ? item.temporaryPresetId || "none" : item.savedPresetId || "inherit");
  }, i18n.t("popup.contextError")), [client, i18n, read]);
  const refreshCache = useCallback(() => read(client.cacheStatus, setCache, i18n.t("popup.cacheError")), [client, i18n, read]);
  const refreshAuto = useCallback(() => read(() => client.toggleStatus("auto"), setAuto, i18n.t("popup.autoError")), [client, i18n, read]);
  const refreshCacheRestore = useCallback(() => read(() => client.toggleStatus("cache"), setCacheRestore, i18n.t("popup.cacheRestoreError")), [client, i18n, read]);
  const refreshQuick = useCallback(() => read(() => client.toggleStatus("quick"), setQuick, i18n.t("popup.quickError")), [client, i18n, read]);
  const refreshAppearance = useCallback(() => read(client.appearance, setAppearance, i18n.t("popup.appearanceError")), [client, i18n, read]);

  useEffect(() => {
    if (!enabled) return;
    active.current = true; generation.current += 1;
    setBusy(false); setTranslating(false); setPageTask(null);
    void Promise.allSettled([refreshContext(), refreshCache(), refreshAuto(), refreshCacheRestore(), refreshQuick(), refreshAppearance()]);
    return () => { active.current = false; generation.current += 1; if (timer.current) clearTimeout(timer.current); timer.current = null; task.current = null; };
  }, [enabled, refreshAppearance, refreshAuto, refreshCache, refreshCacheRestore, refreshContext, refreshQuick]);

  const stopPolling = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; task.current = null;
  }, []);

  const renderTask = useCallback((value: TaskStatus) => {
    setPageTask(value);
    const working = ["queued", "cache_lookup", "translating", "storing"].includes(value.state);
    setTranslating(working);
    const progress = value.total > 0 ? ` ${Math.min(value.done, value.total)}/${value.total}` : "";
    const labels: Record<string, string> = {
      queued: i18n.t("popup.taskQueued"), cache_lookup: i18n.t("popup.taskCache", { progress }),
      translating: i18n.t("popup.taskTranslating", { progress }), storing: i18n.t("popup.taskStoring", { progress }),
      completed: i18n.t("popup.taskCompleted", { progress }), failed: value.error || i18n.t("popup.taskFailed"),
      cancelled: i18n.t("popup.taskCancelled")
    };
    const provider = value.machineProvider ? ` · ${value.machineSwitching ? i18n.t("mt.switching") : ""}${value.machineProvider}` : "";
    show((labels[value.state] || i18n.t("common.working")) + provider, value.state === "failed");
    if (!working && task.current && !task.current.owned) { stopPolling(); void refreshCache(); }
  }, [i18n, refreshCache, show, stopPolling]);

  const poll = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const run = async () => {
      const current = task.current;
      if (!current || !active.current) return;
      try {
        const result = await client.taskStatus(current.tabId, current.id);
        if (active.current && task.current === current) {
          if (result.task) renderTask(result.task);
          else if (!current.owned) { stopPolling(); setPageTask(null); setTranslating(false); show(""); }
        }
      } catch { if (active.current && task.current === current && !current.owned) { stopPolling(); setPageTask(null); setTranslating(false); show(""); } }
      if (task.current === current && active.current) timer.current = setTimeout(run, 250);
    };
    timer.current = setTimeout(run, 100);
  }, [client, renderTask, show, stopPolling]);

  useEffect(() => {
    if (!enabled) return;
    const current = generation.current, epoch = taskEpoch.current;
    void client.currentPageTask().then(result => {
      if (!active.current || current !== generation.current || epoch !== taskEpoch.current || task.current || !result.task) return;
      const value = result.task;
      if (value.id && ["queued", "cache_lookup", "translating", "storing"].includes(value.state)) {
        task.current = {id:value.id, tabId:result.tabId, owned:false};
        renderTask(value); poll();
      } else renderTask(value);
    }).catch(() => {});
  }, [client, enabled, poll, renderTask]);

  const translate = useCallback(async () => {
    if (busy) return;
    const scope = generation.current;
    const current = () => active.current && scope === generation.current;
    taskEpoch.current += 1; setPageTask({state:"queued",done:0,total:0});
    setBusy(true); show(i18n.t("popup.taskPreparing"));
    try {
      const id = crypto.randomUUID();
      const prepared = await client.prepareTranslation(id);
      if (!current()) return;
      task.current = { id, tabId: prepared.site.tab.id, owned: true }; setTranslating(true); poll();
      const response = await prepared.run();
      if (!current()) return;
      stopPolling();
      setPageTask(value => response.task || (value ? {...value,
        state:response.cancelled ? "cancelled" : !response.ok || response.missing ? "failed" : "completed",
        total:value.total || Number(response.count || 0),
        ...(response.ok && !response.cancelled && !response.missing ? {done:value.total || Number(response.count || 0)} : {})} : null));
      if (!response.ok) throw new Error(String(response.error || i18n.t("popup.taskFailed")));
      show(response.cancelled ? i18n.t("popup.taskCancelled") : String(response.message || i18n.t("popup.taskProcessed", { count: Number(response.count || 0) })), Number(response.missing || 0) > 0);
      await refreshCache();
    } catch (error) { if (current()) { stopPolling(); setPageTask(value => value ? {...value,state:"failed"} : null); show(error instanceof Error ? error.message : String(error), true); } }
    finally { if (current()) { stopPolling(); setTranslating(false); setBusy(false); } }
  }, [client, i18n, poll, refreshCache, show, stopPolling]);

  const cancel = useCallback(async () => {
    const current = task.current; if (!current) return;
    show(i18n.t("popup.taskCancelling"));
    try { await client.cancel(current.tabId, current.id); }
    catch (error) { show(i18n.t("popup.cancelFailed", { message: error instanceof Error ? error.message : String(error) }), true); }
  }, [client, i18n, show]);

  const pageAction = useCallback(async (type: string) => {
    setBusy(true); show(type === CONTENT_MESSAGES.RESTORE_CACHE ? i18n.t("popup.pageProcessing") : i18n.t("common.working"));
    try {
      const response = await client.action(type);
      if (!response.ok) throw new Error(String(response.error || i18n.t("common.unknownError")));
      if (type === CONTENT_MESSAGES.TOGGLE_TRANSLATIONS) show(response.hidden ? i18n.t("popup.translationHidden") : i18n.t("popup.translationShown"));
      else if (type === CONTENT_MESSAGES.CLEAR_TRANSLATIONS) show(i18n.t("popup.translationRemoved"));
      else if (type === CONTENT_MESSAGES.CLEAR_PAGE_CACHE) show(i18n.t("popup.cacheDeleted", { count: Number(response.deleted || 0) }));
      else show(String(response.message || i18n.t("popup.taskProcessed", { count: Number(response.count || 0) })));
      await refreshCache();
    } catch (error) { show(error instanceof Error ? error.message : String(error), true); }
    finally { if (active.current) setBusy(false); }
  }, [client, i18n, refreshCache, show]);

  const toggleSite = useCallback(async (kind: "auto" | "cache" | "quick", value: Loadable<ToggleStatus>) => {
    if (!value.value) return;
    setBusy(true); show(i18n.t("popup.siteUpdating"));
    try { show(await client.toggleSite(kind, value.value)); }
    catch (error) { show(error instanceof Error ? error.message : String(error), true); }
    finally {
      if (active.current) setBusy(false);
      await (kind === "auto" ? refreshAuto() : kind === "cache" ? refreshCacheRestore() : refreshQuick());
      if (kind !== "quick") await refreshCache();
    }
  }, [client, i18n, refreshAuto, refreshCache, refreshCacheRestore, refreshQuick, show]);

  const changeAppearance = useCallback(async (value: string) => {
    setAppearance(current => ({ ...current, loading: true }));
    try { const next = await client.saveAppearance(value); if (active.current) setAppearance({ loading: false, value: next, error: "" }); }
    catch (error) { show(error instanceof Error ? error.message : String(error), true); await refreshAppearance(); }
  }, [client, refreshAppearance, show]);

  const applyPreset = useCallback(async (persist: boolean) => {
    setBusy(true); show(i18n.t("popup.modeUpdating"));
    try {
      const result = await client.applyPreset(preset, persist); setContext({ loading: false, value: result.context, error: "" });
      if (result.context.hasSitePromptOverride) show(i18n.t(persist ? "popup.modeSavedPromptWins" : "popup.modeTemporaryPromptWins"));
      else { show(i18n.t(persist ? "popup.modeSaved" : "popup.modeTemporary")); if (result.before.presetId !== result.context.presetId) await translate(); }
    } catch (error) { show(error instanceof Error ? error.message : String(error), true); }
    finally { if (active.current) setBusy(false); }
  }, [client, i18n, preset, show, translate]);

  const openLearning = useCallback(async () => { try { await client.openLearning(); } catch (error) { show(error instanceof Error ? error.message : String(error), true); } }, [client, show]);
  return { notice, busy, translating, pageTask, context, cache, auto, cacheRestore, quick, appearance, preset, setPreset, refreshContext, refreshCache, refreshAuto, refreshCacheRestore, refreshQuick, refreshAppearance, translate, cancel, pageAction, toggleSite, changeAppearance, applyPreset, openLearning };
}

export function contextHint(value: EffectiveContext, i18n: I18n) {
  const preset = localizedPresetLabel(value.selectedPresetId || value.presetId, i18n);
  if (value.hasSitePromptOverride) return preset ? i18n.t("popup.customPromptWithPreset", { preset }) : i18n.t("popup.customPrompt");
  if (value.presetSource === "temporary") return value.presetId ? i18n.t("popup.temporaryPreset", { preset }) : i18n.t("popup.temporaryPresetOff");
  if (value.presetSource === "site") return i18n.t("popup.sitePreset", { preset });
  return value.glossaryCount ? i18n.t("popup.defaultGlossary", { count: value.glossaryCount }) : i18n.t("popup.defaultPrompt");
}

export function localizedPresetLabel(id: unknown, i18n: I18n) {
  const normalized = String(id || "");
  return (["technical", "academic", "news", "natural"] as const).includes(normalized as "technical")
    ? i18n.t(`preset.${normalized}.label` as "preset.technical.label") : getPresetLabel(id);
}
