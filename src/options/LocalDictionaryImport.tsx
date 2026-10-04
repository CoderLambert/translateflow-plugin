import { useEffect, useMemo, useRef, useState } from "react";
import { isInstalledStateKnownForFamily } from "./local-dictionary-installed-state.js";
import {
  findDuplicateCandidate, formatBytes, getLocalPreflightView, isTflexOverInstallLimit, safeFileLabel
} from "./local-dictionary-import-presentation.js";
import { createLocalDictionaryClient, type InstalledDictionaryState, type LocalDictionaryClient, type LocalPreflight } from "./local-dictionary-client";

const emptyInstalled: InstalledDictionaryState = { candidates: [], known: { rich: false, packs: false } };

export function LocalDictionaryImport({ setStatus, onChanged }: {
  setStatus: (message: string, error?: boolean) => void;
  onChanged: () => Promise<void>;
}) {
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
  const [semantic, setSemantic] = useState(false);
  const [limitations, setLimitations] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryMdd, setRetryMdd] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    mounted.current = true;
    const client = createLocalDictionaryClient({ onProgress: message => { if (mounted.current) setProgress(message); } });
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
        if (abort.signal.aborted || isAbort(error)) { setPhase("cancelled"); setProgress("本机检查已取消；文件尚未导入。重新选择文件后可以再次检查。"); }
        else { setPhase("invalid"); setProgress(errorText(error, "本机兼容性检查失败。")); setStatus("无法完成本地词典检查。请重新选择文件后重试。", true); }
      }
    })();
    return () => abort.abort();
  }, [files, ready, semantic, setStatus]);

  async function refreshInstalled(client = service.current, request = generation.current) {
    if (!client) return;
    const next = await client.installed();
    if (mounted.current && request === generation.current) setInstalled(next);
  }

  function replaceSelection(next: File[]) {
    if (busy) return;
    generation.current += 1; preflightAbort.current?.abort();
    setFiles(next.filter(file => file && typeof file.name === "string"));
    setReport(null); setPhase(next.length ? "checking" : "empty"); setProgress("");
    setSemantic(false); setLimitations(false); setDuplicate(false); setRetryMdd(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function importSelected() {
    const client = service.current;
    if (!client || !report || !canImport(report, files, installed, semantic, limitations, duplicate) || busy) return;
    setBusy(true); setProgress("准备导入…");
    try {
      const result = await client.importFiles(report, files);
      if (!mounted.current) return;
      setProgress(result.progress); setRetryMdd(result.retryMdd); setStatus(result.status, result.error);
      if (result.changed) await onChanged();
    } finally { if (mounted.current) setBusy(false); }
  }

  async function cancelActive() {
    if (busy) {
      const result = await service.current?.cancel();
      if (!mounted.current) return;
      if (result?.cancelled) setProgress("正在取消并清理临时数据…");
      else if (result?.phase === "commitpoint") setProgress("词典已进入最终提交阶段，当前已不能取消；正在完成保存…");
      else setProgress("当前操作已经结束或无法取消。");
    } else {
      preflightAbort.current?.abort(); setProgress("已取消本机检查。");
    }
  }

  async function retryAttachment() {
    if (!service.current || busy) return;
    setBusy(true); setProgress("正在检查 MDD 并原子更新附件…");
    try {
      const result = await service.current.retryMdd();
      if (!mounted.current) return;
      setProgress(result.progress); setRetryMdd(result.retryMdd); setStatus(result.status, result.error);
      if (result.changed) await onChanged();
    } finally { if (mounted.current) setBusy(false); }
  }

  const view = useMemo(() => report ? getLocalPreflightView(report, files, installed.candidates) : null, [files, installed.candidates, report]);
  const importEnabled = report ? canImport(report, files, installed, semantic, limitations, duplicate) && !busy : false;
  const showPreflight = files.length > 0;

  return <div id="localDictionaryImport" className="data-source-card local-dictionary-import" data-status={report?.compatibility.status || phase} data-busy={busy ? "true" : "false"}>
    <strong>从本地文件添加词典</strong><p>选择或拖入一套词典文件。TranslateFlow 会在本机检查格式并说明可用方式；格式本身不会证明词典的语义方向或来源。</p>
    <label id="localDictionaryDropZone" className="local-dictionary-drop-zone" htmlFor="localDictionaryFiles" tabIndex={0} data-dragging={dragging ? "true" : undefined}
      onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && event.nativeEvent.isTrusted) { event.preventDefault(); inputRef.current?.click(); } }}
      onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (event.nativeEvent.isTrusted) replaceSelection(Array.from(event.dataTransfer.files)); }}>
      <span>拖放文件到这里，或选择文件</span><small>支持 MDX / MDD、StarDict、TranslateFlow TFLex 文件；文件只在本机处理</small>
    </label>
    <input ref={inputRef} id="localDictionaryFiles" className="visually-hidden-file-input" type="file" multiple accept=".mdx,.mdd,.ifo,.idx,.dict,.dict.dz,.syn,.json,.dat" aria-describedby="localDictionaryHelp" disabled={busy}
      onChange={event => replaceSelection(Array.from(event.target.files || []))} />
    <p id="localDictionaryHelp" className="hint">可一次选择 MDX 与同名 MDD、编号 MDD，或同名 StarDict 文件组。TFLex 导入会由安装流程重新校验完整文件与记录。</p>
    <ul id="localDictionaryFileList" className="local-dictionary-file-list" aria-label="已选择的词典文件">{files.map((file, index) => <li className="local-dictionary-file" key={`${file.name}:${file.size}:${index}`}><span className="local-dictionary-file-name">{safeFileLabel(file.name)} · {formatBytes(file.size)}</span><button type="button" disabled={busy} aria-label={`移除文件 ${safeFileLabel(file.name)}`} onClick={() => replaceSelection(files.filter((_, at) => at !== index))}>移除</button></li>)}</ul>
    <div className="actions"><button id="localDictionaryChooseFiles" type="button" disabled={busy} onClick={event => { if (event.nativeEvent.isTrusted) inputRef.current?.click(); }}>选择 / 重新选择文件</button><button id="localDictionaryClearFiles" type="button" disabled={busy || !files.length} onClick={() => replaceSelection([])}>清空文件</button></div>
    <section id="localDictionaryPreflight" className="local-dictionary-preflight" aria-labelledby="localDictionaryPreflightHeading" hidden={!showPreflight}>
      <h4 id="localDictionaryPreflightHeading">本机兼容性检查</h4>
      <div id="localDictionaryPreflightSummary" className="local-dictionary-preflight-summary" aria-live="polite">
        {phase === "checking" ? <SummaryRow label="检查状态" value="正在本机检查文件结构…" /> : view ? view.rows.map((row: { label: string; value: string }, index: number) => <SummaryRow key={`${row.label}:${index}`} {...row} />) : progress ? <SummaryRow label="检查状态" value={progress} /> : null}
        {report && !isInstalledStateKnownForFamily(report.identity.family, installed.known) ? <SummaryRow label="重复检查" value="暂时无法读取对应的已安装词典状态；为避免重复或误覆盖，安装已暂停。" /> : null}
      </div>
      <label id="localDictionarySemanticLabel" className="checkbox-label" htmlFor="localDictionarySemanticConfirmation" hidden={!view?.needsSemantic}><input id="localDictionarySemanticConfirmation" type="checkbox" checked={semantic} disabled={busy || !view?.needsSemantic} onChange={event => setSemantic(event.target.checked)} /><span id="localDictionarySemanticText">{view?.semanticText}</span></label>
      <label id="localDictionaryLimitationsLabel" className="checkbox-label" htmlFor="localDictionaryLimitationsConfirmation" hidden={!view?.needsLimitations}><input id="localDictionaryLimitationsConfirmation" type="checkbox" checked={limitations} disabled={busy || !view?.needsLimitations} onChange={event => setLimitations(event.target.checked)} /><span id="localDictionaryLimitationsText">{view?.limitationsText}</span></label>
      <label id="localDictionaryDuplicateLabel" className="checkbox-label" htmlFor="localDictionaryDuplicateConfirmation" hidden={!view?.duplicate}><input id="localDictionaryDuplicateConfirmation" type="checkbox" checked={duplicate} disabled={busy || !view?.duplicate} onChange={event => setDuplicate(event.target.checked)} /><span id="localDictionaryDuplicateText">{view?.duplicateText}</span></label>
      <div className="actions"><button id="localDictionaryImportButton" className="primary" type="button" disabled={!importEnabled} onClick={event => { if (event.nativeEvent.isTrusted) void importSelected(); }}>安装词典</button><button id="localDictionaryCancelButton" type="button" hidden={!busy && phase !== "checking"} onClick={() => void cancelActive()}>取消</button><button id="localDictionaryRetryMddButton" type="button" hidden={!retryMdd} disabled={busy} onClick={event => { if (event.nativeEvent.isTrusted) void retryAttachment(); }}>重试添加 MDD</button></div>
      <p id="localDictionaryImportProgress" className="hint" aria-live="polite">{progress}</p>
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
function errorText(error: unknown, fallback: string) { return error instanceof Error ? error.message : String(error || fallback); }
