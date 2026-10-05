import { useEffect, useRef, useState } from "react";
import type { Detail as RecordDetail, ReadingClient } from "../client/reading";
import type { I18n } from "../../i18n/index.js";
import { Button } from "../components/common";
import { openAssistant } from "../client/assistant";
import { ReturnToPage } from "./ReturnToPage";
import { RecordHistory } from "./RecordHistory";
type AssistantArtifact = RecordDetail["artifacts"][number] & { kind: "assistant"; payload: {
  userQuestion: string; assistantAnswer: string; action: "understand" | "analyze" | "usage" | "follow-up";
  threadId: string; turnId: string; parentTurnId: string | null; branchId: string; regenerationOf: string | null; completionStatus: "completed";
} };
export function Detail({ detail, siteKey, siteKeyStatus = "ready", onRetrySiteKey, markersRevision, i18n, onBack, onDelete, onAssistantSaved, disabled, assistantDisabled = disabled, client }: {
  detail: RecordDetail; i18n: I18n; onBack: () => void; onDelete: () => void; onAssistantSaved?: () => void;
  disabled: boolean; siteKey?: string | null; siteKeyStatus?: "loading" | "ready" | "error"; onRetrySiteKey?: () => void;
  markersRevision?: number; assistantDisabled?: boolean; client?: ReadingClient;
}) {
  const { record } = detail;
  return <section onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) onBack(); }} aria-labelledby="detail-title">
    <Button onClick={onBack}>{i18n.t("learning.back")}</Button>
    <RecordHistory detail={detail} i18n={i18n} beforeArtifacts={<ReturnToPage record={record} i18n={i18n} disabled={disabled}
      {...(siteKey !== undefined ? { siteKey } : {})} siteKeyStatus={siteKeyStatus}
      {...(onRetrySiteKey ? { onRetrySiteKey } : {})} {...(markersRevision !== undefined ? { markersRevision } : {})}
      {...(client ? { client } : {})} />}>
      {artifact => artifact.kind === "assistant" && "userQuestion" in artifact.payload ? <AssistantControls artifact={artifact as AssistantArtifact}
        recordId={record.recordId} recordRevision={record.revision} i18n={i18n} disabled={assistantDisabled}
        onSaved={onAssistantSaved ?? (() => {})} /> : null}
    </RecordHistory>
    <div className="actions"><Button className="danger" disabled={disabled} onClick={onDelete}>{i18n.t("learning.delete")}</Button></div>
  </section>;
}

function AssistantControls({ artifact, recordId, recordRevision, i18n, disabled, onSaved }: {
  artifact: AssistantArtifact; recordId: string; recordRevision: number; i18n: I18n; disabled: boolean; onSaved: () => void;
}) {
  type Phase = "idle" | "connecting" | "streaming" | "stopping" | "stopped" | "failed" | "saved";
  const [expanded, setExpanded] = useState(false), [question, setQuestion] = useState(""), [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<Phase>("idle"), [lastAction, setLastAction] = useState<"follow-up" | "regenerate">("follow-up");
  const session = useRef<ReturnType<typeof openAssistant> | null>(null), sequence = useRef(0), partial = useRef(""), terminal = useRef(true);
  useEffect(() => () => { terminal.current = true; session.current?.close(); }, [artifact.artifactId]);
  function start(historyAction: "follow-up" | "regenerate") {
    const nextQuestion = question.trim();
    if (disabled || session.current || (historyAction === "follow-up" && !nextQuestion)) return;
    terminal.current = false; sequence.current = 0; partial.current = ""; setAnswer(""); setPhase("connecting"); setLastAction(historyAction);
    session.current = openAssistant({ recordId, recordRevision, sourceSnapshotId: artifact.sourceSnapshotId,
      targetTurnId: artifact.payload.turnId, historyAction, ...(historyAction === "follow-up" ? { question: nextQuestion } : {}) }, event => {
      if (terminal.current) return;
      if (event.type === "started") { setPhase("streaming"); return; }
      if (event.type === "delta") {
        if (event.sequence !== sequence.current++) return finish("failed");
        partial.current += event.text; setAnswer(partial.current); setPhase("streaming"); return;
      }
      if (event.type === "interrupted") return finish(event.code === "CANCELLED" ? "stopped" : "failed");
      if (event.type === "complete") {
        if (event.text !== partial.current || event.saved.state !== "saved" || event.saved.recordId !== recordId || event.saved.revision <= recordRevision) return finish("failed");
        setAnswer(event.text); finish("saved"); onSaved();
      }
    }, () => { if (!terminal.current) finish("failed"); });
  }
  function finish(next: Phase) {
    terminal.current = true; session.current?.close(); session.current = null; setPhase(next);
  }
  function stop() {
    if (!session.current || terminal.current || phase === "stopping") return;
    setPhase("stopping"); session.current.stop();
  }
  const status = phase === "connecting" ? "learning.assistantConnecting" : phase === "streaming" ? "learning.assistantStreaming"
    : phase === "stopping" ? "learning.assistantStopping" : phase === "stopped" ? "learning.assistantStopped"
      : phase === "failed" ? "learning.assistantFailed" : phase === "saved" ? "learning.assistantSaved" : null;
  return <div className="assistant-controls" onKeyDown={event => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation();
    if (session.current) stop(); else setExpanded(false);
  }}>
    <div className="actions">
      <Button disabled={disabled || Boolean(session.current)} onClick={() => setExpanded(value => !value)}>{i18n.t("learning.followUp")}</Button>
      {artifact.payload.parentTurnId === null && <Button disabled={disabled || Boolean(session.current)}
        onClick={() => start("regenerate")}>{i18n.t("learning.regenerate")}</Button>}
    </div>
    {expanded && <form onSubmit={event => { event.preventDefault(); start("follow-up"); }}>
      <label htmlFor={`follow-up-${artifact.artifactId}`}>{i18n.t("learning.followUp")}</label>
      <textarea id={`follow-up-${artifact.artifactId}`} autoFocus maxLength={2000} value={question} disabled={disabled || Boolean(session.current)}
        placeholder={i18n.t("learning.followUpPlaceholder")} onChange={event => setQuestion(event.target.value)}
        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault(); start("follow-up");
        } }} />
      <div className="actions"><Button type="submit" className="primary" disabled={disabled || Boolean(session.current) || !question.trim()}>{i18n.t("learning.send")}</Button></div>
    </form>}
    {answer && <p className="assistant-partial text">{answer}</p>}
    {status && <p className={phase === "failed" ? "notice error" : "notice"} aria-live="polite">{i18n.t(status)}</p>}
    {session.current && <Button onClick={stop}>{i18n.t("learning.stop")}</Button>}
    {!session.current && ["failed", "stopped"].includes(phase) && <Button disabled={disabled}
      onClick={() => start(lastAction)}>{i18n.t("learning.retry")}</Button>}
  </div>;
}
