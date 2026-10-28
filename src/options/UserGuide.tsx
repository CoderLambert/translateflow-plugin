import { useRef, useState } from "react";
import type { MessageKey } from "../i18n/index.js";
import { useOptionsI18n } from "./LocaleContext";
import { StyledSelect } from "./StyledSelect";

const GROUPS = [
  { id: "start", topics: [{ id: "start", settings: "general" }, { id: "services", settings: "provider" }] },
  { id: "translate", topics: [{ id: "page", settings: "general" }, { id: "text", settings: "provider" },
    { id: "selection", settings: "selection" }, { id: "subtitles", settings: "youtube" }] },
  { id: "manage", topics: [{ id: "dictionary", settings: "dictionary-packs" }, { id: "learning", settings: "" },
    { id: "sites", settings: "sites" }, { id: "shortcuts", settings: "general" },
    { id: "privacy", settings: "cache" }, { id: "troubleshoot", settings: "provider" }] }
] as const;
const TOPICS = GROUPS.flatMap<{ id: string; settings: string }>(group => [...group.topics]);

export function UserGuide() {
  const i18n = useOptionsI18n();
  const [index, setIndex] = useState(0), tabs = useRef<HTMLDivElement>(null), content = useRef<HTMLElement>(null);
  const topic = TOPICS[index]!;
  const title = (id: string) => i18n.t(("guide." + id + ".title") as MessageKey);
  const text = (field: string) => i18n.t(("guide." + topic.id + "." + field) as MessageKey);
  function activate(next: number, focus = false) {
    if (next < 0 || next >= TOPICS.length) return;
    setIndex(next);
    requestAnimationFrame(() => {
      if (!content.current?.getClientRects().length) return;
      if (focus) {
        if (tabs.current?.getClientRects().length) {
          const tab = tabs.current.querySelectorAll<HTMLButtonElement>("[role=tab]")[next];
          tab?.focus({ preventScroll: true }); tab?.scrollIntoView({ block: "nearest" });
        } else document.getElementById("guide-topic-select")?.focus({ preventScroll: true });
      }
      // A chapter opened after reading the footer starts at its heading.
      const top = content.current.getBoundingClientRect().top;
      if (top < 16 || top > innerHeight * .5) content.current.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }
  return <section className="user-guide" id="help" aria-labelledby="guide-title">
    <header className="guide-intro"><h1 id="guide-title">{i18n.t("guide.title")}</h1><p>{i18n.t("guide.subtitle")}</p></header>
    <div className="guide-layout">
      <aside className="guide-directory" aria-label={i18n.t("guide.directory")}>
        <div className="guide-tablist" ref={tabs} role="tablist" aria-orientation="vertical" aria-label={i18n.t("guide.topics")} onKeyDown={event => {
          if (!(event.target instanceof HTMLButtonElement) || !event.target.matches("[role=tab]") || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
          const next = ["ArrowDown", "ArrowRight"].includes(event.key) ? (index + 1) % TOPICS.length : ["ArrowUp", "ArrowLeft"].includes(event.key) ? (index - 1 + TOPICS.length) % TOPICS.length : event.key === "Home" ? 0 : event.key === "End" ? TOPICS.length - 1 : -1;
          if (next < 0) return; event.preventDefault(); activate(next, true);
        }}>{GROUPS.map(group => <div className="guide-topic-group" role="presentation" key={group.id}>
          <p className="guide-group-label" aria-hidden="true">{i18n.t(("guide.group." + group.id) as MessageKey)}</p>
          {group.topics.map(item => {
            const i = TOPICS.findIndex(value => value.id === item.id);
            return <button key={item.id} type="button" role="tab" id={"guide-tab-" + item.id} aria-controls={index === i ? "guide-panel-" + item.id : undefined} aria-selected={index === i} tabIndex={index === i ? 0 : -1} onClick={() => activate(i)}>{title(item.id)}</button>;
          })}
        </div>)}</div>
      </aside>
      <div className="guide-mobile-picker"><label htmlFor="guide-topic-select">{i18n.t("guide.topicPicker")}</label><StyledSelect id="guide-topic-select" value={topic.id} onChange={event => activate(TOPICS.findIndex(item => item.id === event.target.value))}>
        {GROUPS.map(group => <optgroup key={group.id} label={i18n.t(("guide.group." + group.id) as MessageKey)}>{group.topics.map(item => <option key={item.id} value={item.id}>{title(item.id)}</option>)}</optgroup>)}
      </StyledSelect></div>
      <article ref={content} key={topic.id} className="guide-content" id={"guide-panel-" + topic.id} role="tabpanel" aria-labelledby="guide-topic-title" tabIndex={0}>
        <div className="guide-topic-header"><div><span className="guide-topic-count">{i18n.t("guide.position", { current: index + 1, total: TOPICS.length })}</span><h3 id="guide-topic-title">{text("title")}</h3><p>{text("intro")}</p></div>{topic.settings && <a className="guide-settings-link" href={"#" + topic.settings}>{i18n.t("guide.settings")} <span aria-hidden="true">↗</span></a>}</div>
        <div className="guide-entry"><span>{i18n.t("guide.entry")}</span><strong>{text("entry")}</strong></div>
        <h4 className="guide-section-label">{i18n.t("guide.steps")}</h4>
        <ol className="guide-steps">{[1, 2, 3].map(step => <li key={step}><span className="guide-step-number" aria-hidden="true">{step}</span><div><h4>{text("step" + step)}</h4><p>{text("body" + step)}</p></div></li>)}</ol>
        <div className="guide-notes"><section className="guide-result"><h4><span aria-hidden="true">✓</span> {text("resultTitle")}</h4><p>{text("result")}</p></section><section className="guide-recovery"><h4>{text("recoverTitle")}</h4><p>{text("recover")}</p></section></div>
        <details className="guide-detail"><summary>{text("detailTitle")}</summary><p>{text("detail")}</p></details>
        <nav className="guide-pagination" aria-label={i18n.t("guide.topics")}><button type="button" disabled={index === 0} onClick={() => activate(index - 1, true)}>← {i18n.t("guide.previous")}</button><button type="button" disabled={index === TOPICS.length - 1} onClick={() => activate(index + 1, true)}>{i18n.t("guide.next")} →</button></nav>
        <p className="guide-offline"><span aria-hidden="true">◇</span> {i18n.t("guide.status")}</p>
      </article>
    </div>
  </section>;
}
