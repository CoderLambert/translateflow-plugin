import { useEffect, useRef, useState } from "react";
import type { I18n } from "../../i18n/index.js";
import type { ReadingClient } from "../client/reading";
import { importRecords } from "../client/import";
import type { VocabularyBookClient } from "../client/vocabulary";
import { VOCABULARY_BOOK_LIMITS } from "../../shared/vocabulary-book.js";
import { Button, Confirmation, Notice } from "./common";

export function Backup({ i18n, reading, vocabulary, disabled = false, onImported }: {
  i18n: I18n; reading?: ReadingClient; vocabulary?: VocabularyBookClient; disabled?: boolean; onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [committing, setCommitting] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState(false);
  const active = useRef(false), operation = useRef<AbortController | null>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; operation.current?.abort(); }; }, []);
  async function restore() {
    if (!file || busy || operation.current) return;
    const source = file; setFile(null); setBusy(true); setNotice(i18n.t("learning.importing")); setError(false);
    const controller = new AbortController(); operation.current = controller;
    try {
      let result;
      if (reading) result = await importRecords(reading, source, controller.signal, () => {}, () => { if (active.current) setCommitting(true); });
      else {
        if (source.size > VOCABULARY_BOOK_LIMITS.totalBytes + 1024) throw new Error("limit");
        const data: unknown = JSON.parse(await source.text());
        if (controller.signal.aborted) return;
        setCommitting(true); result = await vocabulary!.restore(data);
      }
      if (active.current) { setNotice(i18n.t("learning.imported", result)); onImported(); }
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
      if (active.current) { setError(true); setNotice(i18n.t(code === "READING_IMPORT_CANCELLED" ? "learning.importCancelled" : code === "READING_UNSUPPORTED_VERSION" ? "learning.importVersion" : "learning.importFailed")); }
    } finally { operation.current = null; if (active.current) { setBusy(false); setCommitting(false); } }
  }
  async function exportBook() {
    if (!vocabulary || busy || operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(false); setNotice("");
    try {
      const backup = await vocabulary.backup();
      if (!active.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `translateflow-wordbook-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor); try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
      setNotice(i18n.t("learning.exportReady"));
    } catch { if (active.current) { setError(true); setNotice(i18n.t("learning.actionError")); } }
    finally { operation.current = null; if (active.current) setBusy(false); }
  }
  return <section className="learning-backup" aria-busy={busy}>
    <h3>{i18n.t(reading ? "learning.readingBackup" : "learning.wordbookBackup")}</h3>
    <p className="muted">{i18n.t("learning.backupHelp")}</p>
    <div className="actions">
      {vocabulary && <Button disabled={disabled || busy} onClick={() => void exportBook()}>{i18n.t("learning.exportWordbook")}</Button>}
      <Button disabled={disabled || busy} onClick={() => input.current?.click()}>{i18n.t("learning.importFile")}</Button>
      {busy && !committing && <Button onClick={() => operation.current?.abort()}>{i18n.t("learning.cancel")}</Button>}
    </div>
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={event => { setFile(event.target.files?.[0] ?? null); event.target.value = ""; }} />
    {notice && <Notice error={error}>{notice}</Notice>}
    {file && <Confirmation i18n={i18n} text={i18n.t("learning.importConfirm")} help={i18n.t("learning.backupHelp")} onCancel={() => setFile(null)} onConfirm={() => void restore()} />}
  </section>;
}
