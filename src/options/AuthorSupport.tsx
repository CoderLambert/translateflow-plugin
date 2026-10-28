import { AUTHOR_SUPPORT_QR, AUTHOR_SUPPORT_URL } from "../shared/author-support.js";
import { useOptionsI18n } from "./LocaleContext";

export function AuthorSupport() {
  const i18n = useOptionsI18n();
  return <section className="author-support" aria-labelledby="author-support-title">
    <div className="author-support-copy"><h3 id="author-support-title"><span aria-hidden="true">☕</span> {i18n.t("authorSupport.title")}</h3>
      <p>{i18n.t("authorSupport.description")}</p><small>{i18n.t("authorSupport.optional")}</small></div>
    <div className="author-support-actions"><a className="author-support-link" href={AUTHOR_SUPPORT_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{i18n.t("authorSupport.open")} <span aria-hidden="true">↗</span></a>
      <details className="author-support-qr"><summary>{i18n.t("authorSupport.scan")}</summary><figure><img src={AUTHOR_SUPPORT_QR} alt={i18n.t("authorSupport.qrAlt")} width="232" height="232" loading="lazy" /><figcaption>{i18n.t("authorSupport.payment")}</figcaption></figure></details>
    </div>
  </section>;
}
