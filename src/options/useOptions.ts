import { useCallback, useEffect, useRef, useState } from "react";
import type { CacheStats, OptionsClient, OptionsConfig, SiteEntry, SiteProfile } from "./client";
import type { I18n } from "../i18n/index.js";
import type { LocalizedMessage } from "../i18n/messages.js";

type Status = { message: string | LocalizedMessage; error: boolean };
type Resource<T> = { loading: boolean; value: T; error: string };

export function useOptions(client: OptionsClient, i18n: I18n, enabled = true) {
  const [config, setConfig] = useState<OptionsConfig | null>(null), [loadError, setLoadError] = useState(""), [busy, setBusy] = useState(false);
  const [status, setStatusState] = useState<Status>({ message: "", error: false });
  const [profiles, setProfiles] = useState<Resource<SiteEntry[]>>({ loading: true, value: [], error: "" });
  const [cache, setCache] = useState<Resource<CacheStats | null>>({ loading: true, value: null, error: "" });
  const [restoreSites, setRestoreSites] = useState<Resource<string[]>>({ loading: true, value: [], error: "" });
  const [autoSites, setAutoSites] = useState<Resource<string[]>>({ loading: true, value: [], error: "" });
  const active = useRef(false), generation = useRef(0);
  const setStatus = useCallback((message: string | LocalizedMessage, error = false) => setStatusState({ message, error }), []);

  const loadConfig = useCallback(async () => {
    const current = generation.current; setLoadError("");
    try { const value = await client.loadConfig(); if (active.current && current === generation.current) setConfig(value); }
    catch { if (active.current && current === generation.current) setLoadError(i18n.t("options.loadFallback")); }
  }, [client, i18n]);
  const refreshProfiles = useCallback(async () => {
    const current = generation.current; setProfiles(value => ({ ...value, loading: true, error: "" }));
    try { const value = await client.profiles(); if (active.current && current === generation.current) setProfiles({ loading: false, value, error: "" }); }
    catch { if (active.current && current === generation.current) setProfiles({ loading: false, value: [], error: i18n.t("options.profileReadFailed") }); }
  }, [client, i18n]);
  const refreshCache = useCallback(async () => {
    const current = generation.current; setCache(value => ({ ...value, loading: true, error: "" }));
    try { const value = await client.cacheStats(); if (active.current && current === generation.current) setCache({ loading: false, value, error: "" }); }
    catch { if (active.current && current === generation.current) setCache({ loading: false, value: null, error: i18n.t("options.cacheReadFailed") }); }
  }, [client, i18n]);
  const refreshBehaviors = useCallback(async () => {
    const current = generation.current;
    setRestoreSites(value => ({ ...value, loading: true, error: "" })); setAutoSites(value => ({ ...value, loading: true, error: "" }));
    const [restore, auto] = await Promise.allSettled([client.behaviorSites("cacheRestoreSites"), client.behaviorSites("autoSites")]);
    if (!active.current || current !== generation.current) return;
    setRestoreSites(restore.status === "fulfilled" ? { loading: false, value: restore.value, error: "" } : { loading: false, value: [], error: errorText(restore.reason, i18n) });
    setAutoSites(auto.status === "fulfilled" ? { loading: false, value: auto.value, error: "" } : { loading: false, value: [], error: errorText(auto.reason, i18n) });
  }, [client, i18n]);

  useEffect(() => {
    if (!enabled) return;
    active.current = true; generation.current += 1;
    void Promise.allSettled([loadConfig(), refreshProfiles(), refreshCache(), refreshBehaviors()]);
    return () => { active.current = false; generation.current += 1; };
  }, [enabled, loadConfig, refreshBehaviors, refreshCache, refreshProfiles]);

  async function save(test = false) {
    if (!config) return; setBusy(true); setStatus(i18n.t(test ? "options.savingAndTesting" : "options.saving"));
    try {
      const normalized = await client.saveConfig(config, true); if (active.current) setConfig(normalized);
      if (test) setStatus(i18n.t("options.testSucceeded", { message: await client.testProvider() }));
      else setStatus(i18n.t("options.saved"));
    } catch (error) { setStatus(errorText(error, i18n), true); }
    finally { if (active.current) setBusy(false); }
  }

  async function saveProfile(origin: string, profile: SiteProfile) {
    if (!config) return; setBusy(true);
    try { const result = await client.saveProfile(origin, profile, config.openAICompatible.baseUrl, config.provider); setStatus(i18n.t(result.saved ? "options.profileSaved" : "options.profileRemoved", { origin: result.origin })); await refreshProfiles(); }
    catch (error) { setStatus(errorText(error, i18n), true); }
    finally { if (active.current) setBusy(false); }
  }
  async function deleteProfile(origin: string) { try { await client.deleteProfile(origin); setStatus(i18n.t("options.profileDeleted", { origin })); await refreshProfiles(); } catch (error) { setStatus(errorText(error, i18n), true); } }
  async function prune() {
    if (!config) return; setBusy(true);
    try { const normalized = await client.saveConfig(config, false); if (active.current) setConfig(normalized); setStatus(i18n.t("options.cachePruned", { count: await client.pruneCache() })); await refreshCache(); }
    catch (error) { setStatus(errorText(error, i18n), true); } finally { if (active.current) setBusy(false); }
  }
  async function clear() { setBusy(true); try { await client.clearCache(); setStatus(i18n.t("options.cacheCleared")); await refreshCache(); } catch (error) { setStatus(errorText(error, i18n), true); } finally { if (active.current) setBusy(false); } }
  async function removeBehavior(key: "cacheRestoreSites" | "autoSites", origin: string) {
    setBusy(true); try { await client.removeBehavior(key, origin); setStatus(i18n.t("options.behaviorDisabled", { origin, feature: i18n.t(key === "autoSites" ? "options.feature.auto" : "options.feature.cache") })); await refreshBehaviors(); }
    catch (error) { setStatus(errorText(error, i18n), true); } finally { if (active.current) setBusy(false); }
  }
  return { config, setConfig, loadError, loadConfig, busy, status, setStatus, profiles, refreshProfiles, cache, refreshCache, restoreSites, autoSites, refreshBehaviors, save, saveProfile, deleteProfile, prune, clear, removeBehavior };
}

function errorText(error: unknown, i18n?: I18n) {
  if (error instanceof Error) {
    const uiMessage = (error as Error & { uiMessage?: unknown }).uiMessage;
    if (typeof uiMessage === "string" && uiMessage === error.message) return uiMessage;
  }
  return i18n?.t("common.unknownError") || "Operation failed";
}
