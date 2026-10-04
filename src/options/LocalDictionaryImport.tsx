import { useEffect, useMemo, useRef, useState } from "react";
import { isInstalledStateKnownForFamily } from "./local-dictionary-installed-state.js";
import {
  findDuplicateCandidate, formatBytes, getLocalPreflightView, isTflexOverInstallLimit, safeFileLabel
} from "./local-dictionary-import-presentation.js";
import { createLocalDictionaryClient, type InstalledDictionaryState, type LocalDictionaryClient, type LocalPreflight } from "./local-dictionary-client";
import { useOptionsI18n } from "./LocaleContext";

const emptyInstalled: InstalledDictionaryState = { candidates: [], known: { rich: false, packs: false } };

export function LocalDictionaryImport({ setStatus, onChanged }: {
  setStatus: (message: string, error?: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const i18n = useOptionsI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const service = useRef<LocalDictionaryClient | null>(null);
  const preflightAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const [ready, setReady] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<LocalPreflight | null>(null);
  const [installed, setInstalled] = useState<InstalledDictionaryState>(emptyInstalled);
  const [phase, setPhase] = useState<"empty" | "checking" | "ready" | "cancelled" | "invalid">("empty");
  const [progress, setProgress] = useState("");
  const [workerPhase, setWorkerPhase] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [limitations, setLimitations] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryMdd, setRetryMdd] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    mounted.current = true;
    const client = createLocalDictionaryClient({ onProgress: (message, nextPhase) => { if (mounted.current) { setProgress(message); setWorkerPhase(nextPhase); } } });
    service.current = client; setReady(true);
    void refreshInstalled(client);
    return () => {
      mounted.current = false; generation.current += 1; preflightAbort.current?.abort();
      client.dispose(); if (service.current === client) service.current = null;
    };
  }, []);

  useEffect(() => {
    const client = service.current;
    if (!ready || !client || !files.length) return;
    const request = ++generation.current;
    preflightAbort.current?.abort();
    const abort = new AbortController(); preflightAbort.current = abort;
    setReport(null); setPhase("checking"); setProgress(""); setLimitations(false); setDuplicate(false); setRetryMdd(false);
    void (async () => {
      try {
        const next = await client.preflight(files, semantic, abort.signal);
        if (!mounted.current || request !== generation.current || abort.signal.aborted) return;
        setReport(next); setPhase(["supported", "partial"].includes(next.compatibility.status) ? "ready" : "invalid");
        await refreshInstalled(client, request);
      } catch (error) {
        if (!mounted.current || request !== generation.current) return;
        if (abort.signal.aborted || isAbort(error)) { setPhase("cancelled"); setProgress(i18n.t("localImport.checkCancelled")); }
        else { setPhase("invalid"); setProgress(errorText(error, i18n.t("localImport.checkFailed"))); setStatus(i18n.t("localImport.checkFailedNotice"), true); }
      }
    })();
    return () => abort.abort();
  }, [files, i18n, ready, semantic, setStatus]);

  async function refreshInstalled(client = service.current, request = generation.current) {
    if (!client) return;
    const next = await client.installed();
    if (mounted.current && request === generation.current) setInstalled(next);
  }

  function replaceSelection(next: File[]) {
    if (busy) return;
    generation.current += 1; preflightAbort.current?.abort();
    setFiles(next.filter(file => file && typeof file.name === "string"));
    setReport(null); setPhase(next.length ? "checking" : "empty"); setProgress(""); setWorkerPhase("");
    setSemantic(false); setLimitations(false); setDuplicate(false); setRetryMdd(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function importSelected() {
    const client = service.current;
    if (!client || !report || !canImport(report, files, installed, semantic, limitations, duplicate) || busy) return;
    setBusy(true); setProgress(i18n.t("localImport.preparing")); setWorkerPhase("");
    try {
      const result = await client.importFiles(report, files);
      if (!mounted.current) return;
      setProgress(result.progress); setWorkerPhase(""); setRetryMdd(result.retryMdd); setStatus(result.status, result.error);
      if (result.changed) await onChanged();
    } finally { if (mounted.current) setBusy(false); }
  }

  async function cancelActive() {
    if (busy) {
      const result = await service.current?.cancel();
      if (!mounted.current) return;
      if (result?.cancelled) setProgress(i18n.t("localImport.cancelling"));
      else if (result?.phase === "commitpoint") setProgress(i18n.t("localImport.commitPoint"));
      else setProgress(i18n.t("localImport.alreadyEnded"));
    } else {
      preflightAbort.current?.abort(); setProgress(i18n.t("localImport.cancelled"));
    }
  }

  async function retryAttachment() {
    if (!service.current || busy) return;
    setBusy(true); setProgress(i18n.t("localImport.retryingMdd")); setWorkerPhase("");
    try {
      const result = await service.current.retryMdd();
      if (!mounted.current) return;
      setProgress(result.progress); setWorkerPhase(""); setRetryMdd(result.retryMdd); setStatus(result.status, result.error);
      if (result.changed) await onChanged();
    } finally { if (mounted.current) setBusy(false); }
  }

  const view = useMemo(() => report ? getLocalPreflightView(report, files, installed.candidates) : null, [files, installed.candidates, report]);
  const importEnabled = report ? canImport(report, files, installed, semantic, limitations, duplicate) && !busy : false;
  const showPreflight = files.length > 0;

  return <div id="localDictionaryImport" className="data-source-card local-dictionary-import" data-status={report?.compatibility.status || phase} data-busy={busy ? "true" : "false"}>
    <strong>{i18n.t("localImport.title")}</strong><p>{i18n.t("localImport.summary")}</p>
    <label id="localDictionaryDropZone" className="local-dictionary-drop-zone" htmlFor="localDictionaryFiles" tabIndex={0} data-dragging={dragging ? "true" : undefined}
      onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && event.nativeEvent.isTrusted) { event.preventDefault(); inputRef.current?.click(); } }}
      onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (event.nativeEvent.isTrusted) replaceSelection(Array.from(event.dataTransfer.files)); }}>
      <span>{i18n.t("localImport.drop")}</span><small>{i18n.t("localImport.support")}</small>
    </label>
    <input ref={inputRef} id="localDictionaryFiles" className="visually-hidden-file-input" type="file" multiple accept=".mdx,.mdd,.ifo,.idx,.dict,.dict.dz,.syn,.json,.dat" aria-describedby="localDictionaryHelp" disabled={busy}
      onChange={event => replaceSelection(Array.from(event.target.files || []))} />
    <p id="localDictionaryHelp" className="hint">{i18n.t("localImport.help")}</p>
    <ul id="localDictionaryFileList" className="local-dictionary-file-list" aria-label={i18n.t("localImport.selectedAria")}>{files.map((file, index) => <li className="local-dictionary-file" key={`${file.name}:${file.size}:${index}`}><span className="local-dictionary-file-name">{safeFileLabel(file.name)} · {formatBytes(file.size)}</span><button type="button" disabled={busy} aria-label={i18n.t("localImport.removeFile", { name: safeFileLabel(file.name) })} onClick={() => replaceSelection(files.filter((_, at) => at !== index))}>{i18n.t("common.delete")}</button></li>)}</ul>
    <div className="actions"><button id="localDictionaryChooseFiles" type="button" disabled={busy} onClick={event => { if (event.nativeEvent.isTrusted) inputRef.current?.click(); }}>{i18n.t("localImport.choose")}</button><button id="localDictionaryClearFiles" type="button" disabled={busy || !files.length} onClick={() => replaceSelection([])}>{i18n.t("localImport.clear")}</button></div>
    <section id="localDictionaryPreflight" className="local-dictionary-preflight" aria-labelledby="localDictionaryPreflightHeading" hidden={!showPreflight}>
      <h4 id="localDictionaryPreflightHeading">{i18n.t("localImport.preflight")}</h4>
      <div id="localDictionaryPreflightSummary" className="local-dictionary-preflight-summary" aria-live="polite">
        {phase === "checking" ? <SummaryRow label={i18n.t("localImport.checkStatus")} value={i18n.t("localImport.checking")} /> : view ? view.rows.map((row: { label: string; value: string }, index: number) => <SummaryRow key={`${row.label}:${index}`} {...row} />) : progress ? <SummaryRow label={i18n.t("localImport.checkStatus")} value={progress} /> : null}
        {report && !isInstalledStateKnownForFamily(report.identity.family, installed.known) ? <SummaryRow label={i18n.t("localImport.duplicateCheck")} value={i18n.t("localImport.installedUnknown")} /> : null}
      </div>
      <label id="localDictionarySemanticLabel" className="checkbox-label" htmlFor="localDictionarySemanticConfirmation" hidden={!view?.needsSemantic}><input id="localDictionarySemanticConfirmation" type="checkbox" checked={semantic} disabled={busy || !view?.needsSemantic} onChange={event => setSemantic(event.target.checked)} /><span id="localDictionarySemanticText">{view?.semanticText}</span></label>
      <label id="localDictionaryLimitationsLabel" className="checkbox-label" htmlFor="localDictionaryLimitationsConfirmation" hidden={!view?.needsLimitations}><input id="localDictionaryLimitationsConfirmation" type="checkbox" checked={limitations} disabled={busy || !view?.needsLimitations} onChange={event => setLimitations(event.target.checked)} /><span id="localDictionaryLimitationsText">{view?.limitationsText}</span></label>
      <label id="localDictionaryDuplicateLabel" className="checkbox-label" htmlFor="localDictionaryDuplicateConfirmation" hidden={!view?.duplicate}><input id="localDictionaryDuplicateConfirmation" type="checkbox" checked={duplicate} disabled={busy || !view?.duplicate} onChange={event => setDuplicate(event.target.checked)} /><span id="localDictionaryDuplicateText">{view?.duplicateText}</span></label>
      <div className="actions"><button id="localDictionaryImportButton" className="primary" type="button" disabled={!importEnabled} onClick={event => { if (event.nativeEvent.isTrusted) void importSelected(); }}>{i18n.t("localImport.install")}</button><button id="localDictionaryCancelButton" type="button" hidden={!busy && phase !== "checking"} onClick={() => void cancelActive()}>{i18n.t("common.cancel")}</button><button id="localDictionaryRetryMddButton" type="button" hidden={!retryMdd} disabled={busy} onClick={event => { if (event.nativeEvent.isTrusted) void retryAttachment(); }}>{i18n.t("localImport.retryMdd")}</button></div>
      <p id="localDictionaryImportProgress" className="hint" data-phase={workerPhase} aria-live="polite">{progress}</p>
    </section>
  </div>;
}

function SummaryRow({ label, value }: { label: string; value: string }) { return <div><strong>{label}</strong><span>{String(value || "")}</span></div>; }

function canImport(report: LocalPreflight, files: File[], installed: InstalledDictionaryState, semantic: boolean, limitations: boolean, duplicateConfirmed: boolean) {
  const status = report.compatibility.status;
  const route = report.route.importer;
  const selectedMdd = files.filter(file => /\.mdd$/iu.test(file.name)).length;
  const semanticRequired = report.identity.family === "stardict" || report.route.requiresSemanticConfirmation;
  const mdxStructuredConfirmed = report.identity.family === "mdict-structured";
  const duplicate = findDuplicateCandidate(report, installed.candidates, files);
  return ["supported", "partial"].includes(status) && route !== "none" &&
    !(report.resources.missingCompanionHints.length && report.identity.family !== "mdict-rich") &&
    !report.resources.unassociatedFiles.length &&
    !(report.identity.family === "mdict-rich" && selectedMdd !== report.resources.associatedMdd.length) &&
    !(report.identity.family === "tflex" && isTflexOverInstallLimit(files)) &&
    (!semanticRequired || semantic || mdxStructuredConfirmed) && (status !== "partial" || limitations) &&
    (!duplicate || duplicateConfirmed) && isInstalledStateKnownForFamily(report.identity.family, installed.known);
}

function isAbort(error: unknown) { return error instanceof Error && error.name === "AbortError"; }
function errorText(_error: unknown, fallback: string) { return fallback; }
