import { BRAND_ICONS } from "../shared/runtime-assets.js";
import type { I18n, MessageKey } from "../i18n/index.js";
import { INPUT_LANGUAGES, INPUT_SCENES, serviceLabel } from "../shared/input-translation.js";
import type { Turn } from "./session";
import { enhanceSelect } from "./select";

export function createView(t: I18n["t"]) {
  const root = document.querySelector<HTMLElement>("#app")!;
  // Static application template only; model/user text is always textContent.
  root.innerHTML = `<header class="topbar"><div class="brand"><img id="brand-icon" alt="" width="38" height="38"><div><h1 data-i18n="input.title"></h1><p data-i18n="input.tagline"></p></div></div><div class="header-actions"><button id="clear" class="quiet"><span aria-hidden="true">＋</span><span data-i18n="input.new"></span></button><button id="settings" class="quiet"><span data-i18n="input.settings"></span><span aria-hidden="true">↗</span></button></div></header>
  <section class="preferences"><div class="preference-field"><label id="target-label" for="target-trigger" data-i18n="input.language"></label><select id="target"></select></div><div class="preference-field service-field"><label id="service-label" for="service-trigger" data-i18n="input.service"></label><select id="service"></select></div><small data-i18n="input.auto"></small></section>
  <section id="conversation" aria-label="Translation"><div id="empty"><span class="empty-mark" aria-hidden="true">Aa <span>↔</span> 文</span><h2 data-i18n="input.emptyTitle"></h2><p data-i18n="input.emptyHint"></p></div><div id="turns"></div></section>
  <section class="composer"><div id="adjust-bar" hidden><span data-i18n="input.adjusting"></span><button id="exit-adjust" class="quiet" data-i18n="input.exitAdjust"></button></div><div class="status-line"><p id="status" role="status" aria-live="polite"></p><button id="recover" class="quiet" hidden data-i18n="input.retry"></button></div><form id="form"><div class="input-heading"><label for="input" id="input-label" data-i18n="input.input"></label><span id="counter"></span></div><textarea id="input" rows="3" dir="auto"></textarea><div id="scene-section"><div class="scene-heading" data-i18n="input.scenes"></div><div id="scenes" role="group"></div><p id="scene-hint"></p></div><details id="brief"><summary data-i18n="input.requirements"></summary><textarea id="requirement" rows="2" maxlength="600" dir="auto"></textarea></details><div class="composer-footer"><small data-i18n="input.shortcut"></small><button id="stop" type="button" class="secondary" hidden data-i18n="input.stop"></button><button id="send" type="submit" class="primary" data-i18n="input.send"></button></div></form><p class="privacy" data-i18n="input.privacy"></p></section>`;
  const get = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const target = get<HTMLSelectElement>("target"), service = get<HTMLSelectElement>("service");
  const targetPicker = enhanceSelect(target), servicePicker = enhanceSelect(service);
  const view = { root, target, service, targetPicker, servicePicker,
    input: get<HTMLTextAreaElement>("input"), requirement: get<HTMLTextAreaElement>("requirement"), form: get<HTMLFormElement>("form"),
    status: get<HTMLParagraphElement>("status"), recover: get<HTMLButtonElement>("recover"), send: get<HTMLButtonElement>("send"), stop: get<HTMLButtonElement>("stop"),
    clear: get<HTMLButtonElement>("clear"), settings: get<HTMLButtonElement>("settings"), exit: get<HTMLButtonElement>("exit-adjust"),
    conversation: get<HTMLElement>("conversation"), turns: get<HTMLDivElement>("turns"), empty: get<HTMLDivElement>("empty"),
    counter: get<HTMLSpanElement>("counter"), brief: get<HTMLDetailsElement>("brief"), adjust: get<HTMLDivElement>("adjust-bar"),
    scenes: get<HTMLDivElement>("scenes"), sceneSection: get<HTMLDivElement>("scene-section"), sceneHint: get<HTMLParagraphElement>("scene-hint"),
    localize() {
      root.querySelectorAll<HTMLElement>("[data-i18n]").forEach(node => { node.textContent = t(node.dataset.i18n as MessageKey); });
      document.title = `${t("input.title")} · TranslateFlow`;
      view.requirement.placeholder = t("input.requirementsHint");
      view.conversation.setAttribute("aria-label", t("input.result")); view.scenes.setAttribute("aria-label", t("input.scenes"));
      view.scenes.replaceChildren(...INPUT_SCENES.map(scene => {
        const item = document.createElement("button"); item.type = "button"; item.className = "scene-pill"; item.dataset.scene = scene.id;
        item.textContent = t(`input.scene.${scene.id}` as MessageKey); item.title = t(`input.sceneHelp.${scene.id}` as MessageKey);
        item.setAttribute("aria-pressed", "false"); return item;
      }));
      targetPicker.sync(); servicePicker.sync();
    },
    setScene(id: string, disabled: boolean) {
      view.scenes.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.scene === id)); button.disabled = disabled;
      });
      view.sceneHint.textContent = t(`input.sceneHelp.${id}` as MessageKey);
    },
    dispose() { targetPicker.dispose(); servicePicker.dispose(); }
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
  const card = document.createElement("article"); card.className = "turn"; card.dataset.turn = turn.id; card.dataset.status = turn.status;
  const source = document.createElement("details"), title = document.createElement("summary"), original = document.createElement("p");
  const sourceLabel = document.createElement("span"); sourceLabel.textContent = `${t("input.original")} ${index + 1}`;
  const preview = document.createElement("span"); preview.className = "source-preview"; preview.textContent = turn.text; preview.dir = "auto";
  title.append(sourceLabel, preview); original.textContent = turn.text; original.dir = "auto"; original.className = "source-text";
  source.append(title, original); card.append(source);
  if (turn.instruction) { const brief = document.createElement("p"); brief.className = "turn-brief"; brief.textContent = turn.instruction; brief.dir = "auto"; card.append(brief); }
  const heading = document.createElement("div"); heading.className = "turn-heading";
  const label = document.createElement("strong"); label.textContent = t(turn.parentId ? "input.revision" : "input.result");
  const language = document.createElement("span"); language.className = "result-language";
  language.textContent = INPUT_LANGUAGES.find(([value]) => value === turn.targetLanguage)?.[1] || turn.targetLanguage;
  const scene = document.createElement("span"); scene.className = "result-scene";
  scene.textContent = t(`input.scene.${INPUT_SCENES.some(item => item.id === turn.scene) ? turn.scene : "general"}` as MessageKey);
  heading.append(label, language, scene); card.append(heading);
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
  if (turn.label) { const model = document.createElement("small"); model.className = "turn-model"; model.textContent = serviceLabel(turn.label); card.append(model); }
  return card;
}
