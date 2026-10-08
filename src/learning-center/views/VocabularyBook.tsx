import { useCallback, useEffect, useRef, useState } from "react";
import type { VocabularyBookClient, VocabularyEntry, VocabularyList, ReviewRating } from "../client/vocabulary";
import { vocabularyBookClient, VocabularyClientError } from "../client/vocabulary";
import type { I18n } from "../../i18n/index.js";
import { Button, Confirmation, Notice } from "../components/common";

type Section = "wordbook" | "review";

export function VocabularyBook({ section, i18n, client = vocabularyBookClient }: {
  section: Section; i18n: I18n; client?: VocabularyBookClient;
}) {
  const [book, setBook] = useState<VocabularyList | null>(null);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [revealed, setRevealed] = useState(false), [confirmId, setConfirmId] = useState<string | null>(null);
  const active = useRef(false), generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setLoadError(false);
    try {
      const result = await client.list();
      if (active.current && request === generation.current) setBook(result);
    } catch {
      if (active.current && request === generation.current) setLoadError(true);
    } finally {
      if (active.current && request === generation.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    active.current = true;
    void refresh();
    return () => { active.current = false; generation.current++; };
  }, [refresh]);
  useEffect(() => { setRevealed(false); setNotice(""); }, [section]);
  useEffect(() => { setRevealed(false); }, [book?.due[0]?.id]);

  async function review(rating: ReviewRating, entry: VocabularyEntry) {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const updated = await client.review(entry.id, rating);
      if (active.current) {
        setNotice(i18n.t(rating === "again" ? "learning.reviewAgainSaved" : "learning.reviewKnowSaved", {
          date: i18n.formatDateTime(updated.nextReviewAt)
        }));
      }
      await refresh();
    } catch {
      if (active.current) setNotice(i18n.t("learning.reviewError"));
    } finally { if (active.current) setBusy(false); }
  }

  async function remove(id: string) {
    setConfirmId(null); setBusy(true); setNotice("");
    try {
      const removed = await client.remove(id);
      if (!removed) throw new VocabularyClientError("VOCABULARY_NOT_FOUND");
      await refresh();
    } catch {
      if (active.current) setNotice(i18n.t("learning.actionError"));
    } finally { if (active.current) setBusy(false); }
  }

  const due = book?.due ?? [];
  const current = due[0] ?? null;
  const nextReviewAt = book?.entries.reduce<number | null>((next, entry) =>
    entry.nextReviewAt > Date.now() && (next === null || entry.nextReviewAt < next) ? entry.nextReviewAt : next, null) ?? null;

  return <section className="vocabulary-section" aria-busy={loading}>
    <div className="vocabulary-heading">
      <div>
        <h2>{i18n.t(section === "review" ? "learning.reviewTitle" : "learning.wordbookTitle")}</h2>
        {book && <p className="muted">{i18n.t("learning.wordbookCount", { count: book.count })} · {i18n.t("learning.wordbookDueCount", { count: book.dueCount })}</p>}
      </div>
      <Button disabled={busy || loading} onClick={() => void refresh()}>{i18n.t("learning.retry")}</Button>
    </div>
    {loading && <Notice>{i18n.t("learning.loading")}</Notice>}
    {loadError && <><Notice error>{i18n.t("learning.wordbookLoadError")}</Notice><Button onClick={() => void refresh()}>{i18n.t("learning.retry")}</Button></>}
    {notice && <Notice>{notice}</Notice>}
    {!loading && !loadError && !book?.count && <Notice>{i18n.t("learning.wordbookEmpty")}</Notice>}
    {!loading && !loadError && section === "review" && book && book.count > 0 && !current && <Notice>
      {nextReviewAt === null ? i18n.t("learning.reviewAllCaughtUp") : i18n.t("learning.reviewEmpty", { date: i18n.formatDateTime(nextReviewAt) })}
    </Notice>}
    {!loading && !loadError && section === "review" && current && <ReviewCard entry={current} dueCount={due.length} revealed={revealed} busy={busy}
      i18n={i18n} onReveal={() => setRevealed(true)} onRate={rating => void review(rating, current)} />}
    {!loading && !loadError && section === "wordbook" && book && book.count > 0 && <ul className="vocabulary-list">
      {book.entries.map(entry => <li key={entry.id}>
        <article className="vocabulary-entry" data-entry-id={entry.id}>
          <div className="vocabulary-entry-copy">
            <h3>{entry.headword}</h3>
            {(entry.pronunciation || entry.partOfSpeech) && <p className="vocabulary-meta">{[entry.pronunciation, entry.partOfSpeech].filter(Boolean).join(" · ")}</p>}
            <ul className="vocabulary-definitions">{entry.definitions.map(definition => <li key={definition}>{definition}</li>)}</ul>
            {entry.examples.length > 0 && <blockquote>{entry.examples.map(example => <p key={example}>{example}</p>)}</blockquote>}
            <p className="muted">{i18n.t("learning.savedAt", { date: i18n.formatDateTime(entry.savedAt) })} · {i18n.t("learning.wordSource")}: {entry.sources.map(source => source.packId).filter((value, index, all) => all.indexOf(value) === index).join(", ")}</p>
          </div>
          <Button className="danger" disabled={busy} onClick={() => setConfirmId(entry.id)}>{i18n.t("learning.wordDelete")}</Button>
        </article>
      </li>)}
    </ul>}
    {confirmId && <Confirmation i18n={i18n} text={i18n.t("learning.wordDeleteConfirm")} help={i18n.t("learning.wordDeleteHelp")}
      onCancel={() => setConfirmId(null)} onConfirm={() => void remove(confirmId)} />}
  </section>;
}

function ReviewCard({ entry, dueCount, revealed, busy, i18n, onReveal, onRate }: {
  entry: VocabularyEntry; dueCount: number; revealed: boolean; busy: boolean; i18n: I18n;
  onReveal: () => void; onRate: (rating: ReviewRating) => void;
}) {
  return <article className="vocabulary-review-card" data-testid="vocabulary-review-card" data-entry-id={entry.id}>
    <p className="muted">{i18n.t("learning.wordbookDueCount", { count: dueCount })}</p>
    <h3>{entry.headword}</h3>
    {(entry.pronunciation || entry.partOfSpeech) && <p className="vocabulary-meta">{[entry.pronunciation, entry.partOfSpeech].filter(Boolean).join(" · ")}</p>}
    {revealed ? <div className="vocabulary-answer">
      <ul className="vocabulary-definitions">{entry.definitions.map(definition => <li key={definition}>{definition}</li>)}</ul>
      {entry.examples.length > 0 && <blockquote>{entry.examples.map(example => <p key={example}>{example}</p>)}</blockquote>}
      <p className="muted">{i18n.t("learning.wordSource")}: {entry.sources.map(source => source.packId).filter((value, index, all) => all.indexOf(value) === index).join(", ")}</p>
      <div className="actions">
        <Button disabled={busy} onClick={() => onRate("again")}>{i18n.t("learning.reviewAgain")}</Button>
        <Button className="primary" disabled={busy} onClick={() => onRate("know")}>{i18n.t("learning.reviewKnow")}</Button>
      </div>
    </div> : <Button className="primary" onClick={onReveal}>{i18n.t("learning.reviewReveal")}</Button>}
  </article>;
}
