import { PROJECT_REPOSITORY_URL } from "../shared/author-support.js";
import { useOptionsI18n } from "./LocaleContext";

export function RepositoryLink() {
  const i18n = useOptionsI18n();
  return <div className="settings-repo-footer"><a className="settings-repo-link" href={PROJECT_REPOSITORY_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={i18n.t("project.openRepository")}>
    <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .5a12 12 0 0 0-3.793 23.385c.6.113.82-.258.82-.577 0-.285-.01-1.04-.016-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.757-1.333-1.757-1.09-.744.083-.729.083-.729 1.205.085 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.419-1.305.762-1.605-2.665-.303-5.467-1.334-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 6.004 0c2.291-1.552 3.297-1.23 3.297-1.23.655 1.652.243 2.873.119 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.625-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .319.216.694.825.576A12 12 0 0 0 12 .5Z" /></svg>
    <span className="settings-repo-name">GitHub <small>{i18n.t("project.star")}</small></span><span className="settings-repo-arrow" aria-hidden="true">↗</span>
  </a></div>;
}
