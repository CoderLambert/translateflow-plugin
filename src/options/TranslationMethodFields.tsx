import { MACHINE_PROVIDERS } from "../shared/machine-translation.js";
import type { I18n, MessageKey } from "../i18n/index.js";
import type { MachineSettings } from "./machine-translation-client";

export function machineServiceLabel(id: string, i18n: I18n) {
  return i18n.t(`mt.service.${id}` as MessageKey);
}

export function machineMethodLabel(config: MachineSettings, i18n: I18n) {
  return config.method && config.method !== "free-online" ? i18n.t(`mt.method.${config.method}` as MessageKey) : `${i18n.t("mt.free")} · ${config.routing === "auto" ? i18n.t("mt.routingAuto") : machineServiceLabel(config.providerId, i18n)}`;
}

// Shared by the two trusted extension pages. Disclosure state never changes a setting.
export function TranslationMethodFields({ id, i18n, draft, disabled, change, online = draft.method === "free-online" }: {
  id: string; i18n: I18n; draft: MachineSettings; disabled: boolean; change: (patch: Partial<MachineSettings>) => void; online?: boolean;
}) {
  return <div className="translation-method-fields">
    {id === "mt" ? <fieldset className="mt-word-method mt-text-method"><legend>{i18n.t("mt.text")}</legend>
      {(["ai", "browser-local", "free-online"] as const).map(method => <label key={method}><input type="radio" name="text-method" value={method} checked={draft.method === method} disabled={disabled} onChange={() => change({ method })} />{i18n.t(`mt.method.${method}`)}</label>)}
    </fieldset> : <><label htmlFor={`${id}-mode`}>{i18n.t("mt.mode")}</label>
    <select id={`${id}-mode`} className="tf-select" disabled={disabled} value={draft.method || "free-online"} onChange={event => change({ method: event.target.value as NonNullable<MachineSettings["method"]> })}>
      <option value="ai">{i18n.t("mt.method.ai")}</option><option value="browser-local">{i18n.t("mt.method.browser-local")}</option><option value="free-online">{i18n.t("mt.free")}</option>
    </select></>}
    {online ? <>
      <label className="mt-auto-choice"><input type="radio" name={`${id}-routing`} checked={draft.routing === "auto"} disabled={disabled} onChange={() => change({ routing: "auto" })} />{i18n.t("mt.routingAuto")}</label>
      <p className="supporting hint">{i18n.t("mt.autoHelp")}</p>
      <details className="mt-manual"><summary>{i18n.t("mt.manual")}{draft.routing === "fixed" ? ` · ${machineServiceLabel(draft.providerId, i18n)}` : ""}</summary>
        <label htmlFor={`${id}-provider`}>{i18n.t("mt.provider")}</label>
        <select id={`${id}-provider`} className="tf-select" disabled={disabled} value={draft.routing === "fixed" ? draft.providerId : ""} onChange={event => { if (event.target.value) change({ routing: "fixed", providerId: event.target.value }); }}>
          <option value="" disabled>{i18n.t("mt.chooseService")}</option>
          {MACHINE_PROVIDERS.map(provider => <option key={provider.id} value={provider.id}>{machineServiceLabel(provider.id, i18n)}</option>)}
        </select>
      </details>
      {draft.routing === "fixed" ? <button type="button" className="mt-link" disabled={disabled} onClick={() => change({ routing: "auto" })}>{i18n.t("mt.restoreAuto")}</button> : null}
    </> : null}
  </div>;
}
