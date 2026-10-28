import { useCallback, useEffect, useRef, useState } from "react";
import { dictionaryClient, type DictionaryClient, type DictionarySnapshot } from "./dictionary-client";
import { CuratedList, InstalledPackList, OfficialList, RichList } from "./DictionaryViews";
import type { InstalledDictionaryTarget } from "./local-dictionary-client";
import { LocalDictionaryImport } from "./LocalDictionaryImport";
import { DictionarySources } from "./DictionarySources";
import { useOptionsI18n } from "./LocaleContext";

export function DictionarySection({ client, setStatus }: {
  client: DictionaryClient;
  setStatus: (message: string, error?: boolean) => void;
}) {
  const i18n = useOptionsI18n();
  const [snapshot, setSnapshot] = useState<DictionarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [locateRequest, setLocateRequest] = useState<{ target: InstalledDictionaryTarget } | null>(null);
  const locatedRequest = useRef<typeof locateRequest>(null);
  const highlighted = useRef<HTMLElement | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const mounted = useRef(false);

  const refresh = useCallback(async (reportFailure = false) => {
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const next = await client.load({ metadataOnly: true });
      if (!mounted.current || request !== generation.current) return;
      setSnapshot(next);
      // Full checks may queue behind an active import. They must not hide
      // committed metadata or delay the import owner's completion message.
      void client.load().then(checked => {
        if (mounted.current && request === generation.current) setSnapshot(checked);
      }).catch(cause => {
        if (!mounted.current || request !== generation.current) return;
        setError(cause instanceof Error ? cause.message : i18n.t("common.unknownError"));
        setSnapshot(current => current ? { ...current, rich: current.rich.map(dictionary =>
          dictionary.status === "checking" ? { ...dictionary, status: "unknown" } : dictionary) } : current);
      });
    } catch (cause) {
      if (mounted.current && request === generation.current) setError(cause instanceof Error ? cause.message : i18n.t("dictionary.readFailed", { message: i18n.t("common.unknownError") }));
      if (reportFailure) throw cause;
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, [client, i18n]);

  useEffect(() => {
    mounted.current = true;
    const changed = () => { void refresh(); };
    document.addEventListener("translateflow:dictionary-state-changed", changed);
    const unsubscribe = client.subscribe?.(changed);
    void refresh();
    return () => {
      mounted.current = false; generation.current += 1;
      document.removeEventListener("translateflow:dictionary-state-changed", changed);
      unsubscribe?.();
      client.dispose();
    };
  }, [client, refresh]);

  useEffect(() => {
    if (!locateRequest || locateRequest === locatedRequest.current) return;
    const section = document.getElementById("dictionary-packs");
    // Finishing an import in a hidden settings panel must not steal focus.
    if (!section || section.closest("[hidden]")) { locatedRequest.current = locateRequest; return; }
    const { kind, id } = locateRequest.target;
    const list = section.querySelector(kind === "rich" ? "#richMdictInstalledList" : "#installedDictionaryList");
    const row = Array.from(list?.querySelectorAll<HTMLElement>(".dictionary-pack-row") || []).find(element =>
      (kind === "rich" ? element.dataset.dictionaryId : element.dataset.packId) === id);
    const target = row || (!id ? document.getElementById("dictionaryInstalledHeading") : null);
    if (!target) return;
    locatedRequest.current = locateRequest;
    clearTimeout(highlightTimer.current);
    highlighted.current?.removeAttribute("data-import-highlight");
    highlighted.current = target;
    target.setAttribute("data-import-highlight", "true");
    target.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    target.focus({ preventScroll: true });
    highlightTimer.current = setTimeout(() => target.removeAttribute("data-import-highlight"), 4000);
  }, [locateRequest, snapshot]);

  useEffect(() => () => { clearTimeout(highlightTimer.current); highlighted.current?.removeAttribute("data-import-highlight"); }, []);

  const content = snapshot ? <>
    <div className="dictionary-library-group" aria-labelledby="dictionaryDownloadHeading">
      <h3 id="dictionaryDownloadHeading" tabIndex={-1}>{i18n.t("dictionary.downloadHeading")}</h3><p className="hint">{i18n.t("dictionary.downloadHelp")}</p>
      <h4>{i18n.t("dictionary.official")}</h4><p className="hint">{i18n.t("dictionary.officialHelp")}</p>
      <OfficialList client={client} snapshot={snapshot} refresh={refresh} setStatus={setStatus} />
      <h4>{i18n.t("dictionary.curated")}</h4><p className="hint">{i18n.t("dictionary.curatedHelp")}</p>
      <CuratedList client={client} snapshot={snapshot} refresh={refresh} setStatus={setStatus} />
      <div className="actions"><button id="refreshDictionaryPacks" type="button" disabled={loading} onClick={() => void refresh()}>{i18n.t("dictionary.refresh")}</button></div>
      <p className="hint">{i18n.t("dictionary.failureSafety")}</p>
    </div>
    <div className="dictionary-library-group" aria-labelledby="dictionaryInstalledHeading">
      <h3 id="dictionaryInstalledHeading" tabIndex={-1}>{i18n.t("dictionary.installed")}</h3><p className="hint">{i18n.t("dictionary.installedHelp")}</p>
      <h4>{i18n.t("dictionary.packs")}</h4><InstalledPackList client={client} snapshot={snapshot} refresh={refresh} setStatus={setStatus} />
      <h4>{i18n.t("dictionary.rich")}</h4><p className="hint">{i18n.t("dictionary.richHelp")}</p>
      <RichList client={client} dictionaries={snapshot.rich} refresh={refresh} setStatus={setStatus} />
    </div>
  </> : null;

  return <section id="dictionary-packs" tabIndex={-1}>
    <h2>{i18n.t("dictionary.title")}</h2><p className="section-summary">{i18n.t("dictionary.summary")}</p>
    {error && !snapshot ? <div className="dictionary-library-group"><p role="alert">{i18n.t("dictionary.readFailed", { message: error })}</p><button type="button" onClick={() => void refresh()}>{i18n.t("common.retry")}</button></div> : content}
    {!snapshot && !error ? <div className="dictionary-library-group" aria-busy="true">{i18n.t("dictionary.loading")}</div> : null}
    {error && snapshot ? <p role="alert">{i18n.t("dictionary.refreshFailed", { message: error })}</p> : null}
    <div className="dictionary-library-group" aria-labelledby="dictionaryImportHeading">
      <h3 id="dictionaryImportHeading" tabIndex={-1}>{i18n.t("dictionary.import")}</h3><p className="hint">{i18n.t("dictionary.importHelp")}</p>
      <DictionarySources />
      <LocalDictionaryImport setStatus={setStatus} onChanged={() => refresh(true)} onLocateInstalled={target => setLocateRequest({ target })} />
    </div>
  </section>;
}

export function createDictionaryClient() { return dictionaryClient(); }
