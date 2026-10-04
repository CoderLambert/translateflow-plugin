import { useCallback, useEffect, useRef, useState } from "react";
import type { CacheStats, OptionsClient, OptionsConfig, SiteEntry, SiteProfile } from "./client";

type Status = { message: string; error: boolean };
type Resource<T> = { loading: boolean; value: T; error: string };

export function useOptions(client: OptionsClient) {
  const [config, setConfig] = useState<OptionsConfig | null>(null), [loadError, setLoadError] = useState(""), [busy, setBusy] = useState(false);
  const [status, setStatusState] = useState<Status>({ message: "", error: false });
  const [profiles, setProfiles] = useState<Resource<SiteEntry[]>>({ loading: true, value: [], error: "" });
  const [cache, setCache] = useState<Resource<CacheStats | null>>({ loading: true, value: null, error: "" });
  const [restoreSites, setRestoreSites] = useState<Resource<string[]>>({ loading: true, value: [], error: "" });
  const [autoSites, setAutoSites] = useState<Resource<string[]>>({ loading: true, value: [], error: "" });
  const active = useRef(false), generation = useRef(0);
  const setStatus = useCallback((message: string, error = false) => setStatusState({ message, error }), []);

  const loadConfig = useCallback(async () => {
    const current = generation.current; setLoadError("");
    try { const value = await client.loadConfig(); if (active.current && current === generation.current) setConfig(value); }
    catch (error) { if (active.current && current === generation.current) setLoadError(error instanceof Error ? error.message : "读取设置失败"); }
  }, [client]);
  const refreshProfiles = useCallback(async () => {
    const current = generation.current; setProfiles(value => ({ ...value, loading: true, error: "" }));
    try { const value = await client.profiles(); if (active.current && current === generation.current) setProfiles({ loading: false, value, error: "" }); }
    catch (error) { if (active.current && current === generation.current) setProfiles({ loading: false, value: [], error: error instanceof Error ? error.message : "读取站点配置失败" }); }
  }, [client]);
  const refreshCache = useCallback(async () => {
    const current = generation.current; setCache(value => ({ ...value, loading: true, error: "" }));
    try { const value = await client.cacheStats(); if (active.current && current === generation.current) setCache({ loading: false, value, error: "" }); }
    catch (error) { if (active.current && current === generation.current) setCache({ loading: false, value: null, error: error instanceof Error ? error.message : "读取缓存统计失败" }); }
  }, [client]);
  const refreshBehaviors = useCallback(async () => {
    const current = generation.current;
    setRestoreSites(value => ({ ...value, loading: true, error: "" })); setAutoSites(value => ({ ...value, loading: true, error: "" }));
    const [restore, auto] = await Promise.allSettled([client.behaviorSites("cacheRestoreSites"), client.behaviorSites("autoSites")]);
    if (!active.current || current !== generation.current) return;
    setRestoreSites(restore.status === "fulfilled" ? { loading: false, value: restore.value, error: "" } : { loading: false, value: [], error: errorText(restore.reason) });
    setAutoSites(auto.status === "fulfilled" ? { loading: false, value: auto.value, error: "" } : { loading: false, value: [], error: errorText(auto.reason) });
  }, [client]);

  useEffect(() => {
    active.current = true; generation.current += 1;
    void Promise.allSettled([loadConfig(), refreshProfiles(), refreshCache(), refreshBehaviors()]);
    return () => { active.current = false; generation.current += 1; };
  }, [loadConfig, refreshBehaviors, refreshCache, refreshProfiles]);

  async function save(test = false) {
    if (!config) return; setBusy(true); setStatus(test ? "正在保存并测试当前默认 Provider…" : "正在保存全局设置…");
    try {
      const normalized = await client.saveConfig(config, true); if (active.current) setConfig(normalized);
      if (test) setStatus(`连接成功。模型返回：${await client.testProvider()}`);
      else setStatus("全局设置已保存。翻译配置变化会使用新的缓存版本；阅读外观只改变显示，不影响缓存版本。");
    } catch (error) { setStatus(errorText(error), true); }
    finally { if (active.current) setBusy(false); }
  }

  async function saveProfile(origin: string, profile: SiteProfile) {
    if (!config) return; setBusy(true);
    try { const result = await client.saveProfile(origin, profile, config.openAICompatible.baseUrl, config.provider); setStatus(result.saved ? `已保存 ${result.origin} 的站点配置。` : `已移除 ${result.origin} 的站点覆盖。`); await refreshProfiles(); }
    catch (error) { setStatus(errorText(error), true); }
    finally { if (active.current) setBusy(false); }
  }
  async function deleteProfile(origin: string) { try { await client.deleteProfile(origin); setStatus(`已删除 ${origin} 的站点配置。`); await refreshProfiles(); } catch (error) { setStatus(errorText(error), true); } }
  async function prune() {
    if (!config) return; setBusy(true);
    try { const normalized = await client.saveConfig(config, false); if (active.current) setConfig(normalized); setStatus(`清理完成，删除 ${await client.pruneCache()} 条旧记录。`); await refreshCache(); }
    catch (error) { setStatus(errorText(error), true); } finally { if (active.current) setBusy(false); }
  }
  async function clear() { setBusy(true); try { await client.clearCache(); setStatus("全部翻译缓存已清空。"); await refreshCache(); } catch (error) { setStatus(errorText(error), true); } finally { if (active.current) setBusy(false); } }
  async function removeBehavior(key: "cacheRestoreSites" | "autoSites", origin: string) {
    setBusy(true); try { await client.removeBehavior(key, origin); setStatus(`已关闭 ${origin} 的${key === "autoSites" ? "自动翻译" : "自动缓存恢复"}。`); await refreshBehaviors(); }
    catch (error) { setStatus(errorText(error), true); } finally { if (active.current) setBusy(false); }
  }
  return { config, setConfig, loadError, loadConfig, busy, status, setStatus, profiles, refreshProfiles, cache, refreshCache, restoreSites, autoSites, refreshBehaviors, save, saveProfile, deleteProfile, prune, clear, removeBehavior };
}

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error || "操作失败"); }
