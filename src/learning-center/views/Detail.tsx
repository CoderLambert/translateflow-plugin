import { useEffect, useRef, useState } from "react";
import type { Detail as RecordDetail, ReadingClient } from "../client/reading";
import type { I18n } from "../../i18n/index.js";
import { Button } from "../components/common";
import { ReturnToPage } from "./ReturnToPage";
export function Detail({ detail, i18n, onBack, onDelete, disabled, client }: { detail: RecordDetail; i18n: I18n; onBack: () => void; onDelete: () => void; disabled: boolean; client?: ReadingClient }) {
  const [shown, setShown] = useState(5);
  const heading = useRef<HTMLHeadingElement>(null);
  const { record, snapshots, artifacts } = detail;
  useEffect(() => { setShown(5); heading.current?.focus(); }, [record.recordId]);
  return <section onKeyDown={event => { if (event.key === "Escape") onBack(); }} aria-labelledby="detail-title">
    <Button onClick={onBack}>{i18n.t("learning.back")}</Button>
    <h2 id="detail-title" ref={heading} tabIndex={-1}>{record.itemText}</h2>
    <p className="eyebrow">{i18n.t("learning.snapshot")}</p>
    <p>{record.pageTitle}</p>
    <p>{i18n.t("learning.savedAt", { date: i18n.formatDateTime(record.firstSeenAt) })}</p>
    <ReturnToPage record={record} i18n={i18n} disabled={disabled} {...(client ? { client } : {})} />
    {artifacts.slice(0, shown).map(artifact => {
      const source = snapshots.find(snapshot => snapshot.sourceSnapshotId === artifact.sourceSnapshotId);
      const payload = artifact.payload;
      return <article className="artifact" key={artifact.artifactId}>
        <h3>{i18n.t(artifact.kind === "assistant" ? "learning.questions" : "learning.result")}</h3>
        {artifact.kind === "assistant" && "userQuestion" in payload ? <><h4>{payload.userQuestion}</h4><p className="text">{payload.assistantAnswer}</p></>
          : "definitions" in payload ? <><p>{payload.headword} {payload.phonetic} {payload.partOfSpeech}</p>
            {payload.outcome === "no-hit" ? <p>{i18n.t("learning.noHit")}</p> : <ul>{payload.definitions.map((value: string, index: number) => <li key={index}>{value}</li>)}</ul>}</>
            : "text" in payload ? <p className="text">{payload.text}</p> : null}
        {source && <details><summary>{i18n.t("learning.context")}</summary><blockquote>{source.selectedText}</blockquote><p className="text">{source.contextText}</p></details>}
        <details><summary>{i18n.t("learning.diagnostics")}</summary>
          <pre>{JSON.stringify(artifact.provenance, null, 2)}</pre><p>{artifact.targetLanguage} · {i18n.formatDateTime(artifact.createdAt)}</p>
        </details>
      </article>;
    })}
    {shown < artifacts.length && <Button onClick={() => setShown(value => value + 5)}>{i18n.t("learning.more")}</Button>}
    <div className="actions"><Button className="danger" disabled={disabled} onClick={onDelete}>{i18n.t("learning.delete")}</Button></div>
  </section>;
}
