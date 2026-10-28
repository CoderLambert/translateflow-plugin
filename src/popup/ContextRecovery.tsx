import type { I18n } from "../i18n/index.js";
import { PopupIcon } from "./PopupIcon";

export function ContextRecovery({ message, pending, disabled, retry, i18n }: {
  message: string; pending: boolean; disabled: boolean; retry: () => Promise<void>; i18n: I18n;
}) {
  return <section className="context-recovery" role="alert" aria-busy={pending} aria-labelledby="context-recovery-title">
    <span className="recovery-symbol"><PopupIcon name="globe" /></span>
    <div className="recovery-copy">
      <strong id="context-recovery-title">{i18n.t("popup.contextUnavailable")}</strong>
      <p>{message}</p>
      <button type="button" className="tf-button tf-button--secondary recovery-retry" disabled={pending || disabled} onClick={() => void retry()}>
        {pending ? <span className="action-spinner" aria-hidden="true" /> : <PopupIcon name="cache" />}
        {i18n.t(pending ? "popup.retryingContext" : "common.retry")}
      </button>
    </div>
  </section>;
}
