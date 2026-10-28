import { BRAND_ICONS } from "../shared/runtime-assets.js";
import type { I18n, MessageKey } from "../i18n/index.js";
import { INPUT_LANGUAGES } from "../shared/input-translation.js";
import type { Turn } from "./session";

export function createView(t: I18n["t"]) {
  const root = document.querySelector<HTMLElement>("#app")!;
  // Static application template only; all user/model content uses textContent.
  root.innerHTML = `<header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true"><img id="brand-icon" alt="" width="42" height="42"></span><div><h1 data-i18n="input.title"></h1><p data-i18n="input.tagline"></p></div></div><div class="header-actions"><button id="clear" class="quiet" data-i18n="input.clear"></button><button id="settings" class="quiet" data-i18n="input.settings"></button></div></header>
  <section class="preferences"><label><span data-i18n="input.target"></span><select id="target"></select></label><label class="service-field"><span data-i18n="input.service"></span><select id="service"></select></label><small data-i18n="input.auto"></small></section>
  <section id="conversation" aria-label="Translation"><div id="empty"><span class="empty-mark" aria-hidden="true">文 <span>↔</span> A</span><h2 data-i18n="input.emptyTitle"></h2><p data-i18n="input.emptyHint"></p></div><div id="turns"></div></section>
  <section class="composer"><div id="adjust-bar" hidden><span data-i18n="input.adjusting"></span><button id="exit-adjust" class="quiet" data-i18n="input.exitAdjust"></button></div><div class="status-line"><p id="status" role="status" aria-live="polite"></p><button id="recover" class="quiet" hidden data-i18n="input.retry"></button></div><form id="form"><label for="input" id="input-label" data-i18n="input.input"></label><textarea id="input" rows="3" dir="auto"></textarea><details id="brief"><summary data-i18n="input.requirements"></summary><textarea id="requirement" rows="2" maxlength="600" dir="auto"></textarea></details><div class="composer-footer"><div><span id="counter"></span><small data-i18n="input.shortcut"></small></div><button id="stop" type="button" class="secondary" hidden data-i18n="input.stop"></button><button id="send" type="submit" class="primary" data-i18n="input.send"></button></div></form><p class="privacy" data-i18n="input.privacy"></p></section>`;
  const get = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const view = { root, input: get<HTMLTextAreaElement>("input"), requirement: get<HTMLTextAreaElement>("requirement"),
    target: get<HTMLSelectElement>("target"), service: get<HTMLSelectElement>("service"), form: get<HTMLFormElement>("form"),
    status: get<HTMLParagraphElement>("status"), recover: get<HTMLButtonElement>("recover"), send: get<HTMLButtonElement>("send"), stop: get<HTMLButtonElement>("stop"),
    clear: get<HTMLButtonElement>("clear"), settings: get<HTMLButtonElement>("settings"), exit: get<HTMLButtonElement>("exit-adjust"),
    conversation: get<HTMLElement>("conversation"), turns: get<HTMLDivElement>("turns"), empty: get<HTMLDivElement>("empty"),
    counter: get<HTMLSpanElement>("counter"), brief: get<HTMLDetailsElement>("brief"), adjust: get<HTMLDivElement>("adjust-bar"),
    localize() {
      root.querySelectorAll<HTMLElement>("[data-i18n]").forEach(node => { node.textContent = t(node.dataset.i18n as MessageKey); });
      document.title = `${t("input.title")} · TranslateFlow`;
      view.requirement.placeholder = t("input.requirementsHint");
      view.conversation.setAttribute("aria-label", t("input.result"));
    }
  };
  get<HTMLImageElement>("brand-icon").src = chrome.runtime.getURL(BRAND_ICONS[64]);
  view.localize(); return view;
}
export type View = ReturnType<typeof createView>;
export function errorMessage(code: string, t: I18n["t"]) {
  if (code === "CANCELLED") return t("input.cancelled");
  if (code === "INTERRUPTED") return t("input.interrupted");
  if (code === "INPUT_LIMIT") return t("input.limit");
  if (code === "MALFORMED_RESPONSE") return t("input.malformed");
  if (/CONFIG|CONNECTION|API_KEY|AUTH|MODEL|DEVELOPER_BUILD/u.test(code)) return t("input.unconfigured");
  if (/PERMISSION/u.test(code)) return t("input.permission");
  return t("input.failed");
}
export function turnCard(turn: Turn, index: number, t: I18n["t"], actions: { copy: () => void; refine: () => void; retry: () => void }, busy: boolean) {
  const card = document.createElement("article"); card.className = "turn"; card.dataset.turn = turn.id;
  const source = document.createElement("details"), title = document.createElement("summary"), original = document.createElement("p");
  title.textContent = `${t("input.original")} · ${index + 1}`;
  original.textContent = turn.text; original.dir = "auto"; original.className = "source-text";
  source.append(title, original); card.append(source);
  if (turn.instruction) { const brief = document.createElement("p"); brief.className = "turn-brief"; brief.textContent = turn.instruction; brief.dir = "auto"; card.append(brief); }
  const heading = document.createElement("div"); heading.className = "turn-heading";
  const label = document.createElement("strong"); label.textContent = t(turn.parentId ? "input.revision" : "input.result");
  const language = document.createElement("span"); language.textContent = INPUT_LANGUAGES.find(([value]) => value === turn.targetLanguage)?.[1] || turn.targetLanguage; heading.append(label, language); card.append(heading);
  const answer = document.createElement("p"); answer.className = "answer"; answer.dir = "auto";
  answer.textContent = turn.status === "complete" ? turn.result : turn.status === "working" ? t("input.working") : errorMessage(turn.error, t);
  if (turn.status !== "complete") answer.classList.add(turn.status);
  card.append(answer);
  const footer = document.createElement("div"); footer.className = "turn-actions";
  function button(key: MessageKey, action: () => void, disabled = false) {
    const item = document.createElement("button"); item.type = "button"; item.className = "quiet"; item.textContent = t(key); item.disabled = disabled; item.onclick = action; footer.append(item);
  }
  if (turn.status === "complete") { button("input.copy", actions.copy); button("input.adjust", actions.refine, busy); button("input.regenerate", actions.retry, busy); }
  else if (turn.status === "error") button("input.retry", actions.retry, busy);
  card.append(footer);
  if (turn.label) { const model = document.createElement("small"); model.className = "turn-model"; model.textContent = turn.label; card.append(model); }
  return card;
}
