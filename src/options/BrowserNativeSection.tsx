import { useEffect, useRef, useState } from "react";
import { LANGUAGE_NAMES, browserLanguage } from "../shared/browser-translation.js";
import { createBrowserNativeRuntime } from "../browser-native/runtime.js";
import { createNativePortClient, attachNativeModelHost } from "../browser-native/transport.js";
import { createPreparationController, resolvePreparationPair } from "../browser-native/preparation.js";
import { useOptionsI18n } from "./LocaleContext";

type ModelStatus = { phase?: string; loaded?: number };
type Pending = { sourceLanguage: string; targetLanguage: string; verifiedAt?: number };
type Result = { sampleText: string; translatedText: string; detectedLanguage: string };
type View = { phase: string; busy: boolean; models: Record<string, ModelStatus>; result: Result | null; errorCode: string; nativeErrorName: string; failureModel: string; warning: string; pending: Pending[] };
type Props = { enabled: boolean; sourceLanguage: string; targetLanguage: string };

export function BrowserNativeSection({ enabled, sourceLanguage, targetLanguage }: Props) {
  const i18n = useOptionsI18n();
  const message = (key: string) => i18n.t(key as Parameters<typeof i18n.t>[0]);
  const t = (key: string) => message(`options.native.${key}`);
  const [view, setView] = useState<View>({ phase: "idle", busy: false, models: {}, result: null, errorCode: "", nativeErrorName: "", failureModel: "", warning: "", pending: [] });
  const [source, setSource] = useState(browserLanguage(sourceLanguage) || "en");
  const [target, setTarget] = useState(browserLanguage(targetLanguage) || "zh");
  const controller = useRef<ReturnType<typeof createPreparationController> | null>(null);
  useEffect(() => {
    const engine = createBrowserNativeRuntime(globalThis);
    const owned = createPreparationController(engine, { onChange: (state: View) => setView(state), client: createNativePortClient(chrome.runtime) });
    controller.current = owned;
    setView(owned.state());
    void owned.refresh();
    const detach = enabled ? attachNativeModelHost(chrome.runtime, engine) : () => {};
    return () => { detach(); owned.dispose(); if (controller.current === owned) controller.current = null; };
  }, [enabled]);
  useEffect(() => { controller.current?.reset(); setSource(browserLanguage(sourceLanguage) || "en"); setTarget(browserLanguage(targetLanguage) || "zh"); }, [sourceLanguage, targetLanguage]);
  const unsupported = typeof (globalThis as unknown as { Translator?: { create?: unknown } }).Translator?.create !== "function" ||
    typeof (globalThis as unknown as { LanguageDetector?: { create?: unknown } }).LanguageDetector?.create !== "function";
  const pair = resolvePreparationPair(source, target);
  return <div id="native-models" className="data-source-card" aria-busy={view.busy} onKeyDown={event => {
    if (event.key === "Escape" && view.busy) { event.preventDefault(); controller.current?.cancel(); }
  }}>
    <h3>{t("title")}</h3><p className="hint">{t("description")}</p>
    <p className="hint">{t("sharing")}</p>
    {unsupported ? <p role="status">{t("unsupported")}</p> : null}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
      <label>{t("source")}<select value={source} disabled={!enabled || view.busy} onChange={event => { controller.current?.reset(); setSource(event.target.value); }}>
        {Object.entries(LANGUAGE_NAMES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select></label>
      <label>{t("target")}<select value={target} disabled={!enabled || view.busy} onChange={event => { controller.current?.reset(); setTarget(event.target.value); }}>
        {Object.entries(LANGUAGE_NAMES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select></label>
    </div>
    <p>{t("testPair")}: {pair.sourceLanguage} → {pair.targetLanguage}</p>
    <p className="hint">{t("testOnly")}</p>
    <button type="button" className="primary" disabled={!enabled || unsupported || view.busy} onClick={event => {
      if (event.nativeEvent.isTrusted) void controller.current?.start(source, target).catch(() => {});
    }}>{t(view.phase === "failed" ? "retry" : "prepare")}</button>
    {view.busy ? <button type="button" onClick={() => controller.current?.cancel()}>{t("cancel")}</button> : null}
    <div role="status" aria-live="polite">
      <p>{t(enabled ? view.phase : "disabled")}</p>
      {["detector", "translator"].map(model => {
        const status = view.models[model];
        if (!status) return null;
        return <div key={model}><span>{t(model)}: {t(status.phase === "ready" ? "modelReady" : status.phase || "initializing")}</span>
          {view.busy ? <progress aria-label={t(model)} max={1} {...(typeof status.loaded === "number" ? { value: status.loaded } : {})} /> : null}
        </div>;
      })}
    </div>
    {view.errorCode ? <p role="alert">{["BROWSER_PREPARE", "BROWSER_UNAVAILABLE"].includes(view.errorCode)
      ? t("prepareFailureHelp") : message(`content.basic.${view.errorCode}`)}</p> : null}
    {view.errorCode ? <details className="hint"><summary>{t("diagnostic")}</summary><p>{view.failureModel ? `${t(view.failureModel)} · ` : ""}{view.errorCode}{view.nativeErrorName ? ` · ${view.nativeErrorName}` : ""}</p></details> : null}
    {view.warning ? <p className="hint">{t("statusWarning")}</p> : null}
    {view.result ? <div><p>{t("verifiedLanguage")}: {view.result.detectedLanguage}</p>
      <label>{t("sample")}<textarea readOnly rows={2} value={view.result.sampleText} /></label>
      <label>{t("result")}<textarea readOnly rows={3} value={view.result.translatedText} /></label>
      <p className="hint">{t("notQualityCertificate")}</p>
    </div> : null}
    {view.pending.length ? <details><summary>{t("pending")}</summary><p className="hint">{t("pendingHint")}</p>
      {view.pending.map(item => <button type="button" key={`${item.sourceLanguage}:${item.targetLanguage}`} disabled={view.busy}
        onClick={() => { controller.current?.reset(); setSource(item.sourceLanguage); setTarget(item.targetLanguage); }}>
        {item.sourceLanguage} → {item.targetLanguage}{item.verifiedAt ? ` · ${t("lastVerified")}` : ""}
      </button>)}
    </details> : null}
  </div>;
}
