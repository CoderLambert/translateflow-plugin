import type { RecordItem, PageItem } from "../client/reading";
import type { I18n } from "../../i18n/index.js";
import { Button, Notice } from "../components/common";
export function Library({ i18n, records, pages, mode, loading, error, query, more, disabled, onMore, onRecord, onPage, onRetry }: {
  i18n: I18n; records: RecordItem[]; pages: PageItem[]; mode: "recent" | "pages"; loading: boolean; error: boolean; query: string;
  more: boolean; disabled: boolean; onMore: () => void; onRecord: (id: string) => void; onPage: (item: PageItem) => void; onRetry: () => void;
}) {
  return <section aria-busy={loading}>
    {loading && <Notice>{i18n.t("learning.loading")}</Notice>}
    {error && <><Notice error>{i18n.t("learning.error")}</Notice><Button onClick={onRetry}>{i18n.t("learning.retry")}</Button></>}
    {!loading && !error && !(mode === "pages" ? pages.length : records.length) && <Notice>{i18n.t(query ? "learning.noMatches" : "learning.empty")}</Notice>}
    <ul className="record-list">{mode === "pages" ? pages.map(page => <li key={page.pageKey}>
      <Button className="record" disabled={disabled} onClick={() => onPage(page)}><strong>{page.pageTitle || page.siteKey}</strong>
        <span>{page.siteKey}</span><span>{i18n.t("learning.count", { count: page.recordCount })}</span></Button>
    </li>) : records.map(record => <li key={record.recordId}>
      <Button className="record" data-record-id={record.recordId} disabled={disabled} onClick={() => onRecord(record.recordId)}>
        <strong>{record.itemText}</strong><span>{record.resultPreview?.text}</span><span className="context">{record.contextPreview}</span>
        <span className="muted">{record.pageTitle || record.siteKey} · {i18n.formatDateTime(record.lastLookupAt)}</span>
        {record.assistantTurnCount > 0 && <span>{i18n.t("learning.questionCount", { count: record.assistantTurnCount })}</span>}
      </Button>
    </li>)}</ul>
    {more && <Button disabled={disabled || loading} onClick={onMore}>{i18n.t("learning.more")}</Button>}
  </section>;
}
