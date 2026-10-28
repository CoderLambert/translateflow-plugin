import { useRef, useState } from "react";
import type { MessageKey } from "../i18n/index.js";
import { useOptionsI18n } from "./LocaleContext";

const TOPICS = [
  { id: "start", mark: "01", settings: "general" }, { id: "services", mark: "AI", settings: "provider" },
  { id: "page", mark: "文", settings: "general" }, { id: "text", mark: "Aa", settings: "provider" },
  { id: "selection", mark: "词", settings: "selection" }, { id: "subtitles", mark: "CC", settings: "youtube" },
  { id: "dictionary", mark: "辞", settings: "dictionary-packs" }, { id: "learning", mark: "学", settings: "" },
  { id: "sites", mark: "↗", settings: "sites" }, { id: "shortcuts", mark: "⌘", settings: "general" },
  { id: "privacy", mark: "◇", settings: "cache" }, { id: "troubleshoot", mark: "?", settings: "provider" }
] as const;
export function UserGuide() {
  const i18n = useOptionsI18n();
  const [index, setIndex] = useState(0), tabs = useRef<HTMLDivElement>(null);
  const topic = TOPICS[index]!;
  const text = (field: string) => i18n.t("guide." + topic.id + "." + field as MessageKey);
  function activate(next: number, focus = false) {
    setIndex(next);
    if (focus) (tabs.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next])?.focus();
  }
  return <section className="user-guide" id="help" aria-labelledby="guide-title">
    <header className="guide-intro"><span className="guide-kicker">TranslateFlow · {i18n.t("guide.title")}</span><h2 id="guide-title">{i18n.t("guide.title")}</h2><p>{i18n.t("guide.subtitle")}</p></header>
    <div className="guide-tablist" ref={tabs} role="tablist" aria-label={i18n.t("guide.topics")} onKeyDown={event => {
      if (!(event.target instanceof HTMLButtonElement) || !event.target.matches("[role=tab]") || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
      const next = event.key === "ArrowRight" ? (index + 1) % TOPICS.length : event.key === "ArrowLeft" ? (index - 1 + TOPICS.length) % TOPICS.length : event.key === "Home" ? 0 : event.key === "End" ? TOPICS.length - 1 : -1;
      if (next < 0) return; event.preventDefault(); activate(next, true);
    }}>{TOPICS.map((item, i) => <button key={item.id} type="button" role="tab" id={"guide-tab-" + item.id} aria-controls={index === i ? "guide-panel-" + item.id : undefined} aria-selected={index === i} tabIndex={index === i ? 0 : -1} onClick={() => activate(i)}><span className="guide-tab-mark" aria-hidden="true">{item.mark}</span>{i18n.t(("guide." + item.id + ".title") as MessageKey)}</button>)}</div>
    <article key={topic.id} className="guide-content" id={"guide-panel-" + topic.id} role="tabpanel" aria-labelledby={"guide-tab-" + topic.id} tabIndex={0}>
      <div className="guide-topic-header"><div><span className="guide-topic-count">{i18n.t("guide.position", { current: index + 1, total: TOPICS.length })}</span><h3>{text("title")}</h3><p>{text("intro")}</p></div>{topic.settings && <a className="guide-settings-link" href={"#" + topic.settings}>{i18n.t("guide.settings")} <span aria-hidden="true">↗</span></a>}</div>
      <div className="guide-entry"><span>{i18n.t("guide.entry")}</span><strong>{text("entry")}</strong></div>
      <h4 className="guide-section-label">{i18n.t("guide.steps")}</h4>
      <ol className="guide-steps">{[1, 2, 3].map(step => <li key={step}><span className="guide-step-number" aria-hidden="true">{step}</span><div><h4>{text("step" + step)}</h4><p>{text("body" + step)}</p></div></li>)}</ol>
      <div className="guide-notes"><section className="guide-result"><h4><span aria-hidden="true">✓</span> {text("resultTitle")}</h4><p>{text("result")}</p></section><section className="guide-recovery"><h4>{text("recoverTitle")}</h4><p>{text("recover")}</p></section></div>
      <details className="guide-detail"><summary>{text("detailTitle")}</summary><p>{text("detail")}</p></details>
      <nav className="guide-pagination" aria-label={i18n.t("guide.topics")}><button type="button" disabled={index === 0} onClick={() => activate(index - 1, true)}>← {i18n.t("guide.previous")}</button><button type="button" disabled={index === TOPICS.length - 1} onClick={() => activate(index + 1, true)}>{i18n.t("guide.next")} →</button></nav>
    </article>
    <p className="guide-offline"><span aria-hidden="true">◇</span> {i18n.t("guide.status")}</p>
  </section>;
}
