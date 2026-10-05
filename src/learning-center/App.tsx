import { useCallback, useEffect, useRef, useState } from "react";
import { READING_METHOD as M } from "../shared/reading/constants.js";
import { recordId as validateRecordId } from "../shared/reading/validation.js";
import { readingClient, subscribe, ReadingError } from "./client/reading";
import type { ReadingClient, RecordingState, Detail as RecordDetail } from "./client/reading";
import { exportRecords, download } from "./client/export";
import { useLocale } from "./useLocale";
import { useLibrary } from "./useLibrary";
import { Button, Confirmation, Notice } from "./components/common";
import { Detail } from "./views/Detail";
import { Library } from "./views/Library";
import { Management } from "./views/Management";
function route(): string | null {
  if (!location.hash) return null;
  if (!location.hash.startsWith("#record=")) return "invalid";
  try { return validateRecordId(location.hash.slice(8), "route"); } catch { return "invalid"; }
}
export function App({ client = readingClient, listen = subscribe }: { client?: ReadingClient; listen?: typeof subscribe }) {
  const { i18n, ready: localeReady, error: localeError, retry: retryLocale } = useLocale();
  const [state, setState] = useState<RecordingState | null>(null), [revision, setRevision] = useState(0), [connection, setConnection] = useState(0);
  const [offline, setOffline] = useState(false), [stateError, setStateError] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"recent" | "pages">("recent"), [input, setInput] = useState(""), [query, setQuery] = useState("");
  const [page, setPage] = useState<{ pageKey: string; siteKey: string; title: string } | null>(null);
  const [id, setId] = useState(route), [detail, setDetail] = useState<RecordDetail | null>(null), [detailSiteKey, setDetailSiteKey] = useState<string | null>(null);
  const [detailSiteKeyStatus, setDetailSiteKeyStatus] = useState<"loading" | "ready" | "error">("loading");
  const [detailError, setDetailError] = useState(false), [detailLoading, setDetailLoading] = useState(false);
  const [notNow, setNotNow] = useState(false), [confirm, setConfirm] = useState<"record" | "page" | "all" | null>(null);
  const [exporting, setExporting] = useState(false), [bytes, setBytes] = useState(0);
  const active = useRef(false), readEpoch = useRef(0), detailEpoch = useRef(0), mutation = useRef(false), exportingRef = useRef<AbortController | null>(null);
  const originFocus = useRef<HTMLElement | null>(null), returnFocus = useRef(false);
  const library = useLibrary(client, mode, query, page?.pageKey ?? null, revision, !offline && !exporting && state !== null && localeReady && !id);
  const refresh = useCallback(() => { readEpoch.current++; detailEpoch.current++; setDetail(null); setRevision(value => value + 1); }, []);
  useEffect(() => {
    active.current = true;
    let stopped = false, reconnects = 0;
    let cleanup: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    function connect() {
      if (stopped) return;
      cleanup = listen(() => {
        reconnects = 0; setOffline(false);
        // The adapter deduplicates unchanged revisions, including our lastViewedAt write.
        refresh();
      }, () => {
        readEpoch.current++; detailEpoch.current++; setOffline(true); setDetail(null); setState(null);
        exportingRef.current?.abort(); cleanup?.();
        if (!stopped && reconnects++ < 3) timer = setTimeout(connect, 250 * reconnects);
      });
    }
    connect();
    return () => { active.current = false; stopped = true; readEpoch.current++; detailEpoch.current++; cleanup?.(); clearTimeout(timer); exportingRef.current?.abort(); };
  }, [listen, refresh, connection]);
  useEffect(() => {
    const generation = ++readEpoch.current;
    if (offline) return;
    setStateError(false);
    client.state().then(value => { if (active.current && generation === readEpoch.current) setState(value); })
      .catch(() => { if (active.current && generation === readEpoch.current) { setState(null); setStateError(true); } });
  }, [client, revision, offline]);
  useEffect(() => {
    const change = () => { detailEpoch.current++; setDetail(null); setId(route()); };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const generation = ++detailEpoch.current; setDetail(null); setDetailSiteKey(null); setDetailSiteKeyStatus("loading"); setDetailError(false);
    if (!id || offline || exporting || !state || !localeReady) { setDetailLoading(false); return; }
    setDetailLoading(true);
    Promise.allSettled([client.getRecord(id), client.recordSiteKey(id)]).then(([recordResult, siteResult]) => {
      if (!active.current || detailEpoch.current !== generation) return;
      if (recordResult.status === "rejected") { setDetailError(true); return; }
      setDetail(recordResult.value);
      if (siteResult.status === "fulfilled") {
        setDetailSiteKey(siteResult.value.siteKey); setDetailSiteKeyStatus("ready");
      } else { setDetailSiteKey(null); setDetailSiteKeyStatus("error"); }
    }).finally(() => { if (active.current && detailEpoch.current === generation) setDetailLoading(false); });
    return () => { detailEpoch.current++; };
  }, [client, id, revision, offline, exporting, state !== null, localeReady]);
  async function retryDetailSiteKey() {
    const generation = detailEpoch.current, recordId = id;
    if (!recordId || offline || detailSiteKeyStatus === "loading") return;
    setDetailSiteKeyStatus("loading");
    try {
      const value = await client.recordSiteKey(recordId);
      if (active.current && detailEpoch.current === generation) { setDetailSiteKey(value.siteKey); setDetailSiteKeyStatus("ready"); }
    } catch {
      if (active.current && detailEpoch.current === generation) { setDetailSiteKey(null); setDetailSiteKeyStatus("error"); }
    }
  }
  function navigate(next: string | null) {
    detailEpoch.current++; setDetail(null); setId(next);
    history.pushState(null, "", next ? `#record=${next}` : location.pathname);
    returnFocus.current = next === null;
  }
  useEffect(() => {
    if (id || !returnFocus.current || !library.settled || offline || !state || detailLoading) return;
    const previousId = originFocus.current?.dataset.recordId;
    const original = previousId ? document.querySelector<HTMLButtonElement>(`[data-record-id="${previousId}"]`) : null;
    const target = original ?? document.querySelector<HTMLButtonElement>("#recent-records");
    if (target && !target.disabled) { target.focus(); returnFocus.current = false; }
  }, [id, library.settled, library.records, offline, state, detailLoading]);

  const blocked = busy || detailLoading || exporting || offline || state === null || !localeReady;
  async function action(operation: () => Promise<unknown>) {
    if (mutation.current || exportingRef.current || offline || !state) return;
    mutation.current = true; setBusy(true); setNotice("");
    try { await operation(); if (active.current) { refresh(); } }
    catch (error) { if (active.current) { setNotice(i18n.t(error instanceof ReadingError && ["READING_REVISION_CONFLICT", "READING_STALE_OPERATION"].includes(error.code) ? "learning.changed" : error instanceof ReadingError && ["READING_QUOTA", "READING_CAPACITY"].includes(error.code) ? "learning.capacity" : "learning.actionError")); refresh(); } }
    finally { mutation.current = false; if (active.current) setBusy(false); }
  }
  async function remove() {
    const kind = confirm; setConfirm(null);
    if (!state) return;
    const record = detail?.record;
    await action(async () => {
      if (kind === "record" && record) await client.request(M.DELETE_RECORD, { recordId: record.recordId, expectedRevision: record.revision });
      else if (kind === "page" && page) await client.request(M.DELETE_PAGE, { pageKey: page.pageKey });
      else if (kind === "all") await client.request(M.CLEAR_RECORDS, { expectedDataGeneration: state.dataGeneration });
      if (kind === "record" || kind === "all") navigate(null);
    });
  }
  async function startExport() {
    if (blocked || exportingRef.current || mutation.current) return;
    const controller = new AbortController(); exportingRef.current = controller;
    detailEpoch.current++; setExporting(true); setBytes(0); setNotice("");
    try {
      const blob = await exportRecords(client, controller.signal, value => { if (active.current) setBytes(value); });
      if (active.current) { download(blob); setNotice(i18n.t("learning.exportReady")); }
    } catch (error) {
      if (active.current) setNotice(i18n.t(error instanceof ReadingError && error.code === "READING_EXPORT_CANCELLED" ? "learning.exportCancelled" : "learning.exportChanged"));
    } finally { exportingRef.current = null; if (active.current) { setExporting(false); refresh(); } }
  }
  if (!localeReady) return <main className="learning-center" aria-busy="true">
    {localeError ? <><Notice error>{i18n.t("settings.readError")}</Notice><Button onClick={retryLocale}>{i18n.t("learning.retry")}</Button></> : null}
  </main>;
  return <main className="learning-center">
    <header><div><p className="eyebrow">TranslateFlow</p><h1>{i18n.t("learning.title")}</h1></div>
      {state && <p>{i18n.t("learning.count", { count: state.recordCount })}</p>}</header>
    {offline || stateError ? <><Notice error>{i18n.t(offline ? "learning.unconfirmed" : "learning.error")}</Notice><Button onClick={() => { setOffline(false); setConnection(value => value + 1); refresh(); }}>{i18n.t("learning.retry")}</Button></>
      : !state ? <Notice>{i18n.t("learning.loading")}</Notice> : null}
    {state && <section className="consent">
      <p>{i18n.t("learning.privacy")}</p>
      {!state.enabled && state.consentGeneration === 1 && !notNow ? <><p>{i18n.t("learning.consent")}</p><div className="actions">
        <Button className="primary" disabled={blocked} onClick={event => { if (event.isTrusted) void action(() => client.recording(true, state.consentGeneration)); }}>{i18n.t("learning.enable")}</Button>
        <Button onClick={() => setNotNow(true)}>{i18n.t("learning.notNow")}</Button></div></>
        : <><p>{!state.enabled ? i18n.t(state.consentGeneration === 1 ? "learning.notSaved" : "learning.paused") : i18n.t("learning.enabledNotice")}</p>
          <Button disabled={blocked} onClick={event => { if (event.isTrusted) void action(() => client.recording(!state.enabled, state.consentGeneration)); }}>{i18n.t(state.enabled ? "learning.pause" : state.consentGeneration === 1 ? "learning.enable" : "learning.resume")}</Button></>}
      {state.capacityReached && <Notice error>{i18n.t("learning.capacity")}</Notice>}
    </section>}
    {notice && <Notice>{notice}</Notice>}
    {exporting && <Notice>{i18n.t("learning.exportProgress", { bytes: i18n.formatNumber(bytes) })} <Button onClick={() => exportingRef.current?.abort()}>{i18n.t("learning.cancel")}</Button></Notice>}
    {id ? <>
      {detailLoading && <Notice>{i18n.t("learning.loading")}</Notice>}
      {detailError && <><Notice error>{i18n.t("learning.notFound")}</Notice><Button onClick={refresh}>{i18n.t("learning.retry")}</Button></>}
      {detail ? <Detail detail={detail} siteKey={detailSiteKey} siteKeyStatus={detailSiteKeyStatus} onRetrySiteKey={retryDetailSiteKey}
        markersRevision={revision} i18n={i18n} onBack={() => navigate(null)} onDelete={() => setConfirm("record")}
        onAssistantSaved={refresh} disabled={blocked} assistantDisabled={blocked || !state?.enabled} client={client} />
        : <Button onClick={() => navigate(null)}>{i18n.t("learning.back")}</Button>}
    </> : <>
      <nav className="actions" aria-label={i18n.t("learning.title")}>
        <Button id="recent-records" aria-pressed={mode === "recent" && !page} disabled={blocked} onClick={() => { setMode("recent"); setPage(null); setInput(""); setQuery(""); }}>{i18n.t("learning.recent")}</Button>
        <Button aria-pressed={mode === "pages"} disabled={blocked} onClick={() => { setMode("pages"); setPage(null); setInput(""); setQuery(""); }}>{i18n.t("learning.pages")}</Button>
      </nav>
      <form className="search" onSubmit={event => { event.preventDefault(); setQuery(input.trim()); }}>
        <label htmlFor="record-search">{i18n.t("learning.search")}</label><div className="actions">
          <input id="record-search" maxLength={200} value={input} onChange={event => setInput(event.target.value)} placeholder={i18n.t("learning.searchPlaceholder")} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} aria-describedby="search-help" />
          <button disabled={blocked}>{i18n.t("learning.search")}</button></div><p id="search-help" className="muted">{i18n.t("learning.searchHelp")}</p>
      </form>
      {page && <div className="actions"><h2>{page.title || page.siteKey}</h2><Button disabled={blocked} className="danger" onClick={() => setConfirm("page")}>{i18n.t("learning.deletePage")}</Button></div>}
      {library.stale && <Notice>{i18n.t("learning.changed")}</Notice>}
      {state && !offline && <Library {...library} i18n={i18n} mode={mode} query={query} disabled={blocked} onMore={library.next} onRetry={library.retry}
        onPage={item => { setPage({ pageKey: item.pageKey, siteKey: item.siteKey, title: item.pageTitle }); setMode("recent"); setInput(""); setQuery(""); }}
        onRecord={next => { originFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; navigate(next); }} />}
    </>}
    {state && <><Management client={client} i18n={i18n} revision={revision} disabled={blocked} selectedSite={page?.siteKey ?? null} />
      <footer><p>{i18n.t("learning.exportWarning")}</p><div className="actions">
        <Button disabled={blocked} onClick={() => void startExport()}>{i18n.t("learning.export")}</Button>
        <Button disabled={blocked || !state.recordCount} className="danger" onClick={() => setConfirm("all")}>{i18n.t("learning.clear")}</Button></div><p className="muted">{i18n.t("learning.deleteHelp")}</p></footer></>}
    {confirm && <Confirmation i18n={i18n} text={i18n.t(confirm === "record" ? "learning.deleteConfirm" : confirm === "page" ? "learning.deletePageConfirm" : "learning.clearConfirm")} onCancel={() => setConfirm(null)} onConfirm={() => void remove()} />}
  </main>;
}
