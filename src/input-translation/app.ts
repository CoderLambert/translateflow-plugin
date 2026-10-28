import { createI18n } from "../i18n/index.js";
import type { I18n } from "../i18n/index.js";
import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { INPUT_TRANSLATION_PORT, INPUT_TRANSLATION_LIMITS as LIMIT, INPUT_LANGUAGES } from "../shared/input-translation.js";
import { createView, errorMessage, turnCard } from "./view";
import { freshSession, loadSession, sessionWriter } from "./session";
import type { Request, Turn } from "./session";

type Port = ReturnType<typeof chrome.runtime.connect>;
type Settings = { ok: boolean; targetLanguage: string; defaultLabel: string; defaultPermission: string; services: { id: string; label: string; model: string; permission: string }[] };
export async function startInputTranslation() {
  let i18n: I18n = createI18n({ browserLocale: chrome.i18n.getUILanguage() });
  const t: I18n["t"] = (key, ...args) => i18n.t(key, ...args);
  const view = createView(t);
  let state = freshSession(), loaded = false, active: { turn: Turn; port: Port | null; stopping: boolean } | null = null;
  let settings: Settings | null = null, readGeneration = 0, disposed = false;
  const notice = (text: string, error = false) => { view.status.textContent = text; view.status.classList.toggle("error", error); };
  const save = sessionWriter(() => notice(t("input.savedError"), true));
  function persist() { if (loaded && !disposed) void save(state); }
  function options() {
    const languages = INPUT_LANGUAGES.map(([value, label]) => new Option(label, value));
    if (state.targetLanguage && !languages.some(option => option.value === state.targetLanguage)) languages.push(new Option(state.targetLanguage, state.targetLanguage));
    view.target.replaceChildren(...languages); view.target.value = state.targetLanguage;
    const services = [new Option(`${t("input.default")}${settings?.defaultLabel ? ` · ${settings.defaultLabel}` : ""}`, ""),
      ...(settings?.services || []).map(item => new Option([item.label, item.model].filter(Boolean).join(" · "), item.id))];
    if (state.service && !services.some(option => option.value === state.service)) services.push(new Option(t("input.missingService"), state.service));
    view.service.replaceChildren(...services); view.service.value = state.service;
  }
  function renderCards(scroll = false) {
    const nearEnd = view.conversation.scrollHeight - view.conversation.scrollTop - view.conversation.clientHeight < 60;
    view.empty.hidden = state.turns.length > 0;
    view.turns.replaceChildren(...state.turns.map((turn, index) => turnCard(turn, index, t, {
      copy: () => { void navigator.clipboard.writeText(turn.result).then(() => notice(t("input.copied")), () => notice(t("input.copyFailed"), true)); },
      refine: () => { if (active) return; state.adjusting = turn.id; state.adjustment = ""; fillComposer(); persist(); view.input.focus(); },
      retry: () => { if (!active) void submit({ ...turn }, turn.status === "error" ? turn : undefined, turn.parentId); }
    }, Boolean(active))));
    if (scroll || nearEnd) view.conversation.scrollTop = view.conversation.scrollHeight;
  }
  function renderControls() {
    const adjusting = Boolean(state.adjusting), length = view.input.value.length;
    const maximum = adjusting ? LIMIT.instruction : LIMIT.text;
    view.adjust.hidden = !adjusting; view.brief.hidden = adjusting;
    view.input.placeholder = t(adjusting ? "input.adjustPlaceholder" : "input.placeholder");
    // Do not truncate pasted text: preserve it and explicitly reject over-limit sends.
    view.counter.textContent = `${length.toLocaleString()} / ${maximum.toLocaleString()}`;
    view.counter.style.color = length > maximum ? "var(--tf-danger)" : "";
    view.send.textContent = t(active ? "input.working" : adjusting ? "input.apply" : "input.send");
    view.send.disabled = !loaded || !settings || Boolean(active) || !view.input.value.trim() || length > maximum;
    view.stop.hidden = !active; view.stop.disabled = Boolean(active?.stopping);
    view.stop.textContent = t(active?.stopping ? "input.stopping" : "input.stop");
    view.target.disabled = view.service.disabled = !loaded || Boolean(active);
    view.clear.disabled = !loaded || Boolean(active);
    view.input.disabled = view.requirement.disabled = !loaded;
    view.form.setAttribute("aria-busy", String(Boolean(active)));
  }
  function fillComposer() {
    view.input.value = state.adjusting ? state.adjustment : state.draft;
    view.requirement.value = state.requirement; renderControls();
  }
  async function refreshSettings() {
    const generation = ++readGeneration;
    try {
      const response = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGES.INPUT_TRANSLATION_SETTINGS }) as Settings;
      if (disposed || generation !== readGeneration) return;
      if (!response?.ok) throw new Error("settings");
      if (!view.recover.hidden) notice("");
      view.recover.hidden = true; settings = response;
      if (!state.targetLanguage) state.targetLanguage = response.targetLanguage || "Simplified Chinese";
      options();
      if (!response.defaultLabel && !state.service) notice(t("input.unconfigured"), true);
    } catch { if (!disposed && generation === readGeneration) { view.recover.hidden = false; notice(t("input.failed"), true); } }
    renderControls();
  }
  async function submit(request: Request, retryTurn?: Turn, parentId = "", consumeDraft = false) {
    if (active || !loaded) return;
    if (!request.text.trim() || request.text.length > LIMIT.text || request.instruction.length > LIMIT.instruction) { notice(t("input.limit"), true); return; }
    const turn: Turn = retryTurn || { ...request, id: crypto.randomUUID(), parentId,
      result: "", error: "", label: "", status: "working" };
    turn.status = "working"; turn.error = "";
    const job = { turn, port: null as Port | null, stopping: false };
    active = job;
    if (!retryTurn) state.turns = [...state.turns, turn].slice(-LIMIT.turns);
    // Only consume the submitted draft; later typing stays independent of this job.
    if (consumeDraft && !retryTurn && view.input.value === (state.adjusting ? request.instruction : request.text)) {
      if (state.adjusting) { state.adjustment = ""; state.adjusting = ""; } else state.draft = "";
      fillComposer();
    }
    notice(t("input.working")); persist(); renderCards(true); renderControls();
    function finish(text: string, code = "") {
      if (disposed || active !== job) return;
      turn.status = code ? "error" : "complete"; turn.result = text; turn.error = code;
      active = null;
      job.port?.disconnect();
      notice(code ? errorMessage(code, t) : t("input.complete"), Boolean(code));
      persist(); renderCards(); renderControls();
    }
    try {
      const permission = request.service ? settings?.services.find(item => item.id === request.service)?.permission : settings?.defaultPermission;
      // Invoked synchronously inside the submit/retry gesture.
      if (permission && !await chrome.permissions.request({ origins: [permission] })) { finish("", "PERMISSION"); return; }
      if (disposed || active !== job) return;
      if (job.stopping) { finish("", "CANCELLED"); return; }
      const port = chrome.runtime.connect({ name: INPUT_TRANSLATION_PORT }); job.port = port;
      port.onMessage.addListener(message => {
        if (active !== job || disposed) return;
        if (message?.type === "started") { turn.label = String(message.service || ""); persist(); renderCards(); }
        else if (message?.type === "complete" && typeof message.text === "string") finish(message.text);
        else if (message?.type === "error") finish("", String(message.code || "FAILED"));
      });
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (active === job) finish("", "INTERRUPTED"); });
      port.postMessage({ type: "start", version: 1, text: request.text, previous: request.previous,
        instruction: request.instruction, targetLanguage: request.targetLanguage, service: request.service });
    } catch { finish("", "FAILED"); }
  }
  view.input.addEventListener("input", () => {
    if (state.adjusting) state.adjustment = view.input.value; else state.draft = view.input.value;
    renderControls(); persist();
  });
  view.requirement.addEventListener("input", () => { state.requirement = view.requirement.value; persist(); });
  view.form.addEventListener("submit", event => {
    event.preventDefault();
    if (active || !loaded || !view.input.value.trim()) return;
    const parent = state.turns.find(turn => turn.id === state.adjusting);
    void submit({ text: parent?.text || state.draft, previous: parent?.result || "",
      instruction: parent ? state.adjustment : state.requirement, targetLanguage: state.targetLanguage, service: state.service }, undefined, parent?.id || "", true);
  });
  view.input.addEventListener("keydown", event => {
    if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); view.form.requestSubmit(); }
    if (event.key === "Escape" && !event.isComposing && state.adjusting) view.exit.click();
  });
  view.stop.onclick = () => {
    if (!active || active.stopping) return;
    active.stopping = true;
    try { active.port?.postMessage({ type: "stop" }); } catch { active.port?.disconnect(); }
    notice(t("input.stopping")); renderControls();
  };
  view.exit.onclick = () => { state.adjusting = ""; fillComposer(); persist(); view.input.focus(); };
  view.target.onchange = () => { state.targetLanguage = view.target.value; persist(); };
  view.service.onchange = () => { state.service = view.service.value; persist(); notice(""); };
  view.clear.onclick = () => {
    if (active || !confirm(t("input.clearConfirm"))) return;
    state = { ...freshSession(), targetLanguage: state.targetLanguage, service: state.service };
    fillComposer(); renderCards(); persist(); notice(""); view.input.focus();
  };
  view.recover.onclick = () => { if (!loaded) location.reload(); else void refreshSettings(); };
  view.settings.onclick = () => { void chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGES.OPEN_OPTIONS, hash: "#provider" }).catch(() => notice(t("input.failed"), true)); };
  const focus = () => { if (loaded && !active) void refreshSettings(); };
  const changed: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area !== "local") return;
    if (changes.uiLocale) { i18n = createI18n({ uiLocale: changes.uiLocale.newValue, browserLocale: chrome.i18n.getUILanguage() }); view.localize(); options(); renderCards(); renderControls(); }
  };
  window.addEventListener("focus", focus); chrome.storage.onChanged.addListener(changed);
  window.addEventListener("pagehide", () => {
    disposed = true; active?.port?.disconnect(); window.removeEventListener("focus", focus); chrome.storage.onChanged.removeListener(changed);
  }, { once: true });
  renderControls(); notice(t("input.loading"));
  try {
    const { uiLocale } = await chrome.storage.local.get("uiLocale");
    i18n = createI18n({ uiLocale, browserLocale: chrome.i18n.getUILanguage() }); view.localize();
    if (chrome.extension.inIncognitoContext) { notice(t("input.incognito"), true); return; }
    state = await loadSession(); notice("");
    await refreshSettings(); loaded = true;
    fillComposer(); renderCards(true); view.input.focus();
  } catch { view.recover.hidden = false; notice(t("input.loadFailed"), true); }
}
