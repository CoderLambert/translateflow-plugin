import { useOptionsI18n } from "./LocaleContext";

const sources = [
  { href: "https://freedict.org/downloads/", name: "FreeDict · StarDict", description: "dictionary.sourcesFreeDict" },
  { href: "https://www.wikdict.com/page/download", name: "WikDict · StarDict", description: "dictionary.sourcesWikDict" }
] as const;
export function DictionarySources() {
  const i18n = useOptionsI18n();
  return <details className="dictionary-v2-details dictionary-source-guide">
    <summary>{i18n.t("dictionary.sourcesHeading")}</summary>
    <div className="dictionary-v2-details-body">
      <p>{i18n.t("dictionary.sourcesIntro")}</p>
      <ul>{sources.map(source => <li key={source.href}>
        <a href={source.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.name} ↗</a>
        <p className="hint">{i18n.t(source.description)}</p>
      </li>)}</ul>
      <p className="hint">{i18n.t("dictionary.sourcesImport")}</p>
      <p className="hint">{i18n.t("dictionary.sourcesMdx")}</p>
    </div>
  </details>;
}
