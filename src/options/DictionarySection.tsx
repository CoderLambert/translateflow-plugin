import { useCallback, useEffect, useRef, useState } from "react";
import { dictionaryClient, type DictionaryClient, type DictionarySnapshot } from "./dictionary-client";
import { BundledList, CuratedList, InstalledPackList, OfficialList, RichList } from "./DictionaryViews";
import { LocalDictionaryImport } from "./LocalDictionaryImport";
import { useOptionsI18n } from "./LocaleContext";
import type { LocalizedMessage } from "../i18n/messages.js";

export function DictionarySection({ client, setStatus }: {
  client: DictionaryClient;
  setStatus: (message: string | LocalizedMessage, error?: boolean) => void;
}) {
  const i18n = useOptionsI18n();
  const [snapshot, setSnapshot] = useState<DictionarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(false);
    try {
      const next = await client.load();
      if (mounted.current && request === generation.current) setSnapshot(next);
    } catch {
      if (mounted.current && request === generation.current) setError(true);
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    const changed = () => { void refresh(); };
    document.addEventListener("translateflow:dictionary-state-changed", changed);
    void refresh();
    return () => {
      mounted.current = false; generation.current += 1;
      document.removeEventListener("translateflow:dictionary-state-changed", changed);
      client.dispose();
    };
  }, [client, refresh]);

  const content = snapshot ? <>
    <div className="dictionary-library-group" aria-labelledby="dictionaryBuiltInHeading">
      <h3 id="dictionaryBuiltInHeading">{i18n.t("dictionary.builtIn")}</h3><p className="hint">{i18n.t("dictionary.builtInHelp")}</p>
      <BundledList packs={snapshot.bundled} />
      <details className="dictionary-repair-help"><summary>{i18n.t("dictionary.sourceRepair")}</summary><p>{i18n.t("dictionary.sourceRepairHelp")}</p></details>
    </div>
    <div className="dictionary-library-group" aria-labelledby="dictionaryDownloadHeading">
      <h3 id="dictionaryDownloadHeading">{i18n.t("dictionary.downloadHeading")}</h3><p className="hint">{i18n.t("dictionary.downloadHelp")}</p>
      <h4>{i18n.t("dictionary.official")}</h4><p className="hint">{i18n.t("dictionary.officialHelp")}</p>
      <OfficialList client={client} snapshot={snapshot} refresh={refresh} setStatus={setStatus} />
      <h4>{i18n.t("dictionary.curated")}</h4><p className="hint">{i18n.t("dictionary.curatedHelp")}</p>
      <CuratedList client={client} snapshot={snapshot} refresh={refresh} setStatus={setStatus} />
      <div className="actions"><button id="refreshDictionaryPacks" type="button" disabled={loading} onClick={() => void refresh()}>{i18n.t("dictionary.refresh")}</button></div>
      <p className="hint">{i18n.t("dictionary.failureSafety")}</p>
    </div>
    <div className="dictionary-library-group" aria-labelledby="dictionaryInstalledHeading">
      <h3 id="dictionaryInstalledHeading">{i18n.t("dictionary.installed")}</h3><p className="hint">{i18n.t("dictionary.installedHelp")}</p>
      <h4>{i18n.t("dictionary.packs")}</h4><InstalledPackList client={client} snapshot={snapshot} refresh={refresh} setStatus={setStatus} />
      <h4>{i18n.t("dictionary.rich")}</h4><p className="hint">{i18n.t("dictionary.richHelp")}</p>
      <RichList client={client} dictionaries={snapshot.rich} refresh={refresh} setStatus={setStatus} />
    </div>
  </> : null;

  return <section id="dictionary-packs" tabIndex={-1}>
    <h2>{i18n.t("dictionary.title")}</h2><p className="section-summary">{i18n.t("dictionary.summary")}</p>
    {error && !snapshot ? <div className="dictionary-library-group"><p role="alert">{i18n.t("dictionary.readFailed", { message: i18n.t("dictionary.client.readFailed") })}</p><button type="button" onClick={() => void refresh()}>{i18n.t("common.retry")}</button></div> : content}
    {!snapshot && !error ? <div className="dictionary-library-group" aria-busy="true">{i18n.t("dictionary.loading")}</div> : null}
    {error && snapshot ? <p role="alert">{i18n.t("dictionary.refreshFailed", { message: i18n.t("dictionary.client.readFailed") })}</p> : null}
    <div className="dictionary-library-group" aria-labelledby="dictionaryImportHeading">
      <h3 id="dictionaryImportHeading">{i18n.t("dictionary.import")}</h3><p className="hint">{i18n.t("dictionary.importHelp")}</p>
      <LocalDictionaryImport setStatus={setStatus} onChanged={refresh} />
    </div>
  </section>;
}

export function createDictionaryClient() { return dictionaryClient(); }
