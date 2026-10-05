import { useEffect, useState } from "react";
import type { Detail as RecordDetail } from "./client/reading";
import { readingClient } from "./client/reading";
import { useLocale } from "./useLocale";
import { Button, Notice } from "./components/common";
import { RecordHistory } from "./views/RecordHistory";

const CLOSE_MESSAGE = "translateflow-reading-preview-close";
const CLAIM_MESSAGE = "translateflow-reading-preview-claim";
const BOUND_MESSAGE = "translateflow-reading-preview-bound";

export function ReadingPreview() {
  const { i18n, ready, error: localeError } = useLocale();
  const [detail, setDetail] = useState<RecordDetail | null>(null), [failed, setFailed] = useState(false);
  const previewId = new URLSearchParams(location.search).get("previewId") || "";

  useEffect(() => {
    let active = true, boundReceived = false, reading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => window.parent.postMessage({ type: CLOSE_MESSAGE, previewId }, "*");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    const onMessage = async (event: MessageEvent) => {
      let origin: URL;
      try { origin = new URL(event.origin); } catch { return; }
      if (!active || !event.isTrusted || event.source !== window.parent || !/^https?:$/u.test(origin.protocol) ||
          !event.data || Object.getPrototypeOf(event.data) !== Object.prototype) return;
      const message = event.data;
      if (message.type !== BOUND_MESSAGE || Object.keys(message).length !== 3 || message.previewId !== previewId ||
          typeof message.claimId !== "string" || boundReceived || reading) return;
      boundReceived = true; reading = true; clearTimeout(timer);
      try {
        const value = await readingClient.previewRead(previewId);
        if (active) setDetail(value);
      } catch { if (active) setFailed(true); }
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown, true);
    if (!previewId) setFailed(true);
    else void readingClient.previewClaim(previewId).then(({ claimId }) => {
      if (!active) return;
      window.parent.postMessage({ type: CLAIM_MESSAGE, previewId, claimId }, "*");
      timer = setTimeout(() => { if (active && !boundReceived) setFailed(true); }, 12_000);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false; clearTimeout(timer); window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [previewId]);

  return <main className="learning-center reading-preview">
    <header><div><p className="eyebrow">TranslateFlow</p><h1>{i18n.t("learning.previewTitle")}</h1></div>
      <Button onClick={() => window.parent.postMessage({ type: CLOSE_MESSAGE, previewId }, "*")}>{i18n.t("learning.previewClose")}</Button>
    </header>
    {!ready ? localeError ? <Notice error>{i18n.t("learning.previewUnavailable")}</Notice> : <Notice>{i18n.t("learning.previewLoading")}</Notice>
      : failed ? <Notice error>{i18n.t("learning.previewUnavailable")}</Notice>
        : !detail ? <Notice>{i18n.t("learning.previewLoading")}</Notice>
          : <section aria-labelledby="detail-title"><RecordHistory detail={detail} i18n={i18n} /></section>}
  </main>;
}
