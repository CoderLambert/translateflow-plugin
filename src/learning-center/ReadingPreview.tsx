import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Detail as RecordDetail, PreviewDetail } from "./client/reading";
import { readingClient } from "./client/reading";
import { compareAssistantArtifacts } from "../shared/reading/artifact.js";
import { useLocale } from "./useLocale";
import { Button, Notice } from "./components/common";

const CLOSE_MESSAGE = "translateflow-reading-preview-close";
const CLAIM_MESSAGE = "translateflow-reading-preview-claim";
const BOUND_MESSAGE = "translateflow-reading-preview-bound";
const SIZE_MESSAGE = "translateflow-reading-preview-size";

export function ReadingPreview() {
  const { i18n, ready, error: localeError } = useLocale();
  const [detail, setDetail] = useState<PreviewDetail | null>(null), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const previewId = new URLSearchParams(location.search).get("previewId") || "";
  const boundPreview = useRef("");

  useEffect(() => {
    let active = true, boundReceived = false, reading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => window.parent.postMessage({ type: CLOSE_MESSAGE, previewId }, "*");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    const read = async () => {
      if (reading) return;
      reading = true; clearTimeout(timer);
      try {
        const value = await readingClient.previewRead(previewId);
        if (active) setDetail(value);
      } catch { if (active) setFailed(true); }
    };
    const onMessage = async (event: MessageEvent) => {
      let origin: URL;
      try { origin = new URL(event.origin); } catch { return; }
      if (!active || !event.isTrusted || event.source !== window.parent || !/^https?:$/u.test(origin.protocol) ||
          !event.data || Object.getPrototypeOf(event.data) !== Object.prototype) return;
      const message = event.data;
      if (message.type !== BOUND_MESSAGE || Object.keys(message).length !== 3 || message.previewId !== previewId ||
          typeof message.claimId !== "string" || boundReceived || reading) return;
      boundReceived = true; boundPreview.current = previewId;
      await read();
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown, true);
    if (!previewId) setFailed(true);
    else if (boundPreview.current === previewId) void read();
    else void readingClient.previewClaim(previewId).then(({ claimId }) => {
      if (!active) return;
      window.parent.postMessage({ type: CLAIM_MESSAGE, previewId, claimId }, "*");
      timer = setTimeout(() => { if (active && !boundReceived) setFailed(true); }, 12_000);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false; clearTimeout(timer); window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [attempt, previewId]);

  useLayoutEffect(() => {
    if (!previewId) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => window.parent.postMessage({ type: SIZE_MESSAGE, previewId,
        height: Math.ceil(document.documentElement.scrollHeight) }, "*"));
    };
    const observer = new ResizeObserver(report); observer.observe(document.documentElement); report();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [detail, failed, previewId, ready]);

  return <main className="learning-center reading-preview">
    <header><div><p className="eyebrow">TranslateFlow</p><span>{i18n.t("learning.previewTitle")}</span></div>
      <Button className="reading-preview-close" aria-label={i18n.t("learning.previewClose")}
        onClick={() => window.parent.postMessage({ type: CLOSE_MESSAGE, previewId }, "*")}>×</Button>
    </header>
    {!ready ? localeError ? <Notice error>{i18n.t("learning.previewUnavailable")}</Notice> : <Notice>{i18n.t("learning.previewLoading")}</Notice>
      : failed ? <><Notice error>{i18n.t("learning.previewUnavailable")}</Notice>
        <Button onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>{i18n.t("learning.retry")}</Button></>
        : !detail ? <Notice>{i18n.t("learning.previewLoading")}</Notice>
          : <PreviewSummary detail={detail} i18n={i18n} />}
  </main>;
}

function PreviewSummary({ detail, i18n }: { detail: PreviewDetail; i18n: ReturnType<typeof useLocale>["i18n"] }) {
  const dictionary = dictionarySummary(detail), translations = unique(detail.artifacts.flatMap(artifact => {
    if (artifact.kind !== "translation" || !("text" in artifact.payload)) return [];
    return [String(artifact.payload.text)];
  }));
  const context = usefulContext(detail), assistants = [detail, ...detail.related].flatMap(owner => owner.artifacts
    .filter(artifact => artifact.kind === "assistant" && "userQuestion" in artifact.payload)
    .map(artifact => ({ artifact, owner, context: usefulContext(owner, artifact.sourceSnapshotId) })))
    .sort((left, right) => compareAssistantArtifacts(left.artifact, right.artifact)).slice(-12);
  return <section className="reading-preview-summary" aria-labelledby="detail-title">
    <h1 id="detail-title">{detail.record.itemText}</h1>
    {dictionary.definitions.length > 0 && <article className="reading-preview-result reading-preview-dictionary">
      <h2>{i18n.t("learning.previewDictionary")}</h2>
      {(dictionary.phonetics.length > 0 || dictionary.parts.length > 0) && <p className="reading-preview-lexical-meta">
        {[...dictionary.phonetics, ...dictionary.parts].join(" · ")}</p>}
      <ul>{dictionary.definitions.map((definition, index) => <li key={`${index}:${definition}`}>{definition}</li>)}</ul>
    </article>}
    {translations.map((translation, index) => <article className="reading-preview-result" key={`translation:${index}:${translation}`}>
      <h2>{i18n.t("learning.previewTranslation")}</h2><p className="text">{translation}</p>
    </article>)}
    {context && <article className="reading-preview-result reading-preview-context">
      <h2>{i18n.t("learning.previewContext")}</h2><blockquote>{context}</blockquote>
    </article>}
    {assistants.length > 0 && <p className="reading-preview-section-label">{i18n.t("learning.previewAiHistory")}</p>}
    {assistants.map(({ artifact, owner, context: assistantContext }) => <PreviewAssistant
      key={`${owner.record.recordId}:${artifact.artifactId}`} artifact={artifact} context={assistantContext} i18n={i18n} />)}
    {assistants.length === 0 && <p className="reading-preview-ai-empty">
      <span>{i18n.t("learning.previewAiEmpty")}</span>
      <span className="reading-preview-info" role="note" tabIndex={0}
        aria-label={i18n.t("learning.previewAiEmptyHelp")} title={i18n.t("learning.previewAiEmptyHelp")}>i</span>
    </p>}
  </section>;
}

function PreviewAssistant({ artifact, context, i18n }: {
  artifact: RecordDetail["artifacts"][number]; context: string; i18n: ReturnType<typeof useLocale>["i18n"];
}) {
  const payload = artifact.payload;
  if (!("userQuestion" in payload)) return null;
  const labels = { understand: "learning.previewAiUnderstand", analyze: "learning.previewAiAnalyze",
    usage: "learning.previewAiUsage", "follow-up": "learning.previewAiFollowUp" } as const;
  const label = labels[payload.action as keyof typeof labels] || labels.understand;
  return <article className="reading-preview-result">
    <h2>{i18n.t(label)}</h2>
    <p className="reading-preview-question"><span>{i18n.t("learning.previewQuestion")}</span>
      <strong>{payload.userQuestion}</strong></p>
    <p className="text">{payload.assistantAnswer}</p>
    {context && <p className="reading-preview-assistant-context"><span>{i18n.t("learning.previewContext")}</span>{context}</p>}
  </article>;
}

function usefulContext(detail: RecordDetail, sourceSnapshotId = "") {
  const snapshots = sourceSnapshotId ? detail.snapshots.filter(snapshot => snapshot.sourceSnapshotId === sourceSnapshotId) : detail.snapshots;
  for (const snapshot of [...snapshots].sort((left, right) => right.capturedAt - left.capturedAt)) {
    const text = String(snapshot.contextText || "").replace(/\s+/gu, " ").trim();
    if (text && text.normalize("NFKC") !== detail.record.itemText.normalize("NFKC").trim()) return text;
  }
  return "";
}

function dictionarySummary(detail: RecordDetail) {
  const definitions: string[] = [], phonetics: string[] = [], parts: string[] = [], seen = new Set<string>();
  for (const artifact of detail.artifacts) {
    if (artifact.kind !== "dictionary" || !("definitions" in artifact.payload) || artifact.payload.outcome !== "hit") continue;
    addUnique(phonetics, artifact.payload.phonetic); addUnique(parts, artifact.payload.partOfSpeech);
    for (const value of artifact.payload.definitions) {
      const definition = usefulDefinition(value, artifact.payload.headword || detail.record.itemText);
      const key = definition?.normalize("NFKC").toLocaleLowerCase("en-US");
      if (definition && key && !seen.has(key)) { seen.add(key); definitions.push(definition); }
      if (definitions.length >= 8) break;
    }
    if (definitions.length >= 8) break;
  }
  return { definitions, phonetics, parts };
}

function usefulDefinition(value: string, headword: string) {
  const text = String(value || "").replace(/[\t\r\f ]+/gu, " ").trim();
  if (!text || text.normalize("NFKC").toLocaleLowerCase("en-US") === headword.normalize("NFKC").trim().toLocaleLowerCase("en-US")) return "";
  if (/^(?:\[(?:图片|图像|音频|发音|image|picture|audio|pronunciation)[^\]]*\]|(?:载入|加载|播放).*(?:音频|发音)|(?:牛津|oxford)\s*(?:3000|5000).*词汇表?)$/iu.test(text)) return "";
  const metadata = text.match(/(?:key_[a-z0-9_-]+|ox(?:ford)?\s*(?:3000|5000)|牛津\s*(?:3000|5000)|cefr[_\s-]?[abc][12]|cet[46]|tem[48]|nmet|播放(?:英音|美音))/giu) || [];
  const dialects = text.match(/\b(?:BrE|NAmE)\b/gu) || [];
  return metadata.length + dialects.length >= 2 || /key_[a-z0-9_-]+/iu.test(text) ? "" : text;
}

function addUnique(target: string[], value: string) {
  const text = String(value || "").trim();
  if (text && !target.includes(text)) target.push(text);
}
function unique(values: string[]) { return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))].slice(0, 4); }
