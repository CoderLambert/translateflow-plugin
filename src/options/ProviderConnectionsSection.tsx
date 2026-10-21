import { useEffect, useMemo, useState } from "react";
import { PROVIDER_PLATFORMS, PROVIDER_PROTOCOLS, providerPlatformPreset } from "../shared/provider-connections.js";
import type { OptionsClient, ProviderConnection, ProviderConnectionState, ServiceRef } from "./client";
import { useOptionsI18n } from "./LocaleContext";
import { isChatGPTPlanDeveloperBuild } from "../shared/chatgpt-native-host.js";

type Draft = Omit<ProviderConnection, "hasApiKey">;
type ConnectionTestStatus = { connectionId: string; message: string; kind: "loading" | "success" | "error" };
type Props = { client: Pick<OptionsClient, "saveProviderConnection" | "deleteProviderConnection" | "setDefaultService" | "testProviderConnection">; state: ProviderConnectionState | null; loading: boolean; error: string; disabled: boolean; reload: () => Promise<void>; setStatus: (message: string, error?: boolean) => void };

export function ProviderConnectionsSection({ client, state, loading, error, disabled, reload, setStatus }: Props) {
  const i18n = useOptionsI18n();
  const [editing, setEditing] = useState<ProviderConnection | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testStatus, setTestStatus] = useState<ConnectionTestStatus | null>(null);
  const connections = state?.connections || [];
  const defaultValue = serviceValue(state?.defaultService || null);
  const developer = isChatGPTPlanDeveloperBuild(globalThis.chrome?.runtime?.getManifest?.());
  const platformOptions = useMemo(() => PROVIDER_PLATFORMS, []);
  const update = (patch: Partial<Draft>) => setDraft(value => ({ ...value, ...patch }));
  const settings = (patch: Partial<Draft["settings"]>) => update({ settings: { ...draft.settings, ...patch } });

  useEffect(() => {
    if (editing || !connections.some(connection => connection.id === draft.id)) return;
    const id = uniqueId(providerPlatformPreset(draft.platform)?.id || "connection", connections);
    setDraft(value => ({ ...value, id, credentialId: id }));
  }, [connections, draft.id, draft.platform, editing]);

  function choosePlatform(platform: string) {
    const preset = providerPlatformPreset(platform)!;
    const baseId = preset.id === "custom" ? "custom" : preset.id;
    const id = editing ? draft.id : uniqueId(baseId, connections);
    update({ platform: preset.id, protocol: preset.protocol, baseUrl: preset.baseUrl,
      id, credentialId: editing ? draft.credentialId : id, name: editing ? draft.name : preset.label,
      settings: { ...draft.settings, allowEmptyApiKey: preset.allowEmptyApiKey, allowInsecureHttp: /^http:/iu.test(preset.baseUrl) } });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setStatus(i18n.t("options.connections.saving"));
    try {
      const result = await client.saveProviderConnection(draft, editing?.revision || 0, clearApiKey ? "" : apiKey, clearApiKey || Boolean(apiKey) || !editing?.hasApiKey);
      setStatus(i18n.t("options.connections.saved", { name: result.name })); reset(); await reload();
    } catch (cause) { setStatus(errorText(cause), true); }
    finally { setBusy(false); }
  }

  async function selectDefault(value: string) {
    setBusy(true);
    try { await client.setDefaultService(parseService(value)); setStatus(i18n.t("options.connections.defaultSaved")); await reload(); }
    catch (cause) { setStatus(errorText(cause), true); } finally { setBusy(false); }
  }

  async function test(connection: ProviderConnection) {
    const testing = i18n.t("options.connections.testing", { name: connection.name });
    setBusy(true); setTestStatus({ connectionId: connection.id, message: testing, kind: "loading" }); setStatus(testing);
    try {
      const message = i18n.t("options.testSucceeded", { message: await client.testProviderConnection(connection.id) });
      setTestStatus({ connectionId: connection.id, message, kind: "success" }); setStatus(message);
    } catch (cause) {
      const message = errorText(cause);
      setTestStatus({ connectionId: connection.id, message, kind: "error" }); setStatus(message, true);
    } finally { setBusy(false); }
  }

  async function remove(connection: ProviderConnection) {
    if (!globalThis.confirm(i18n.t("options.connections.deleteConfirm", { name: connection.name }))) return;
    setBusy(true);
    try { await client.deleteProviderConnection(connection); setStatus(i18n.t("options.connections.deleted", { name: connection.name })); if (editing?.id === connection.id) reset(); await reload(); }
    catch (cause) { setStatus(errorText(cause), true); } finally { setBusy(false); }
  }

  function edit(connection: ProviderConnection) { setEditing(connection); setDraft(stripPublic(connection)); setApiKey(""); setClearApiKey(false); }
  function reset() { setEditing(null); setDraft(emptyDraft()); setApiKey(""); setClearApiKey(false); }
  const locked = disabled || busy;
  const connectionHelp = draft.platform === "ollama" ? "options.connections.ollamaHelp"
    : draft.platform === "ollama-cloud" ? "options.connections.ollamaCloudHelp"
    : draft.platform === "lmstudio" ? "options.connections.lmstudioHelp" : "options.connections.customHelp";

  return <section id="provider" className="advanced" tabIndex={-1}><h2>{i18n.t("options.connections.title")}</h2><p className="section-summary">{i18n.t("options.connections.summary")}</p>
    <label htmlFor="defaultService">{i18n.t("options.connections.default")}</label><select id="defaultService" disabled={locked || loading || !state} value={defaultValue} onChange={event => void selectDefault(event.target.value)}>{connections.map(connection => <option key={connection.id} value={`api-key:${connection.id}`}>{connection.name} · {connection.defaultModel || i18n.t("options.connections.modelUnset")}</option>)}{developer ? <option value="chatgpt-plan">{i18n.t("options.chatgptPlan.providerName")}</option> : defaultValue === "chatgpt-plan" ? <option value="chatgpt-plan" disabled>{i18n.t("options.chatgptPlan.savedDevChoice")}</option> : null}</select>
    <div className="connection-list" aria-busy={loading}>{loading ? <p>{i18n.t("options.connections.loading")}</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => void reload()}>{i18n.t("common.retry")}</button></div> : connections.map(connection => <div className="connection-card" key={connection.id}><div><strong>{connection.name}</strong><small>{connection.platform} · {connection.protocol} · {connection.defaultModel || i18n.t("options.connections.modelUnset")}</small><small>{connection.baseUrl}</small><span className={`connection-key-state ${connection.hasApiKey ? "ready" : "empty"}`}>{connection.hasApiKey ? i18n.t("options.connections.keySaved") : connection.settings.allowEmptyApiKey ? i18n.t("options.connections.keyOptional") : i18n.t("options.connections.keyMissing")}</span>{testStatus?.connectionId === connection.id ? <span className="connection-test-status" data-kind={testStatus.kind} role={testStatus.kind === "error" ? "alert" : "status"} aria-live="polite">{testStatus.message}</span> : null}</div><div className="site-actions"><button type="button" disabled={locked} onClick={() => void test(connection)}>{i18n.t("options.connections.test")}</button><button type="button" disabled={locked} onClick={() => edit(connection)}>{i18n.t("common.edit")}</button><button type="button" disabled={locked} onClick={() => void remove(connection)}>{i18n.t("common.delete")}</button></div></div>)}</div>
    <form className="connection-editor" onSubmit={event => void save(event)}><h3>{i18n.t(editing ? "options.connections.edit" : "options.connections.add")}</h3>
      <div className="profile-grid"><div><label htmlFor="connectionPlatform">{i18n.t("options.connections.platform")}</label><select id="connectionPlatform" disabled={locked} value={draft.platform} onChange={event => choosePlatform(event.target.value)}>{platformOptions.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select></div><div><label htmlFor="connectionProtocol">{i18n.t("options.connections.protocol")}</label><select id="connectionProtocol" disabled={locked} value={draft.protocol} onChange={event => update({ protocol: event.target.value })}>{Object.values(PROVIDER_PROTOCOLS).map(value => <option key={value} value={value}>{value}</option>)}</select></div></div>
      <div className="profile-grid"><div><label htmlFor="connectionName">{i18n.t("options.connections.name")}</label><input id="connectionName" disabled={locked} value={draft.name} onChange={event => update({ name: event.target.value })} /></div><div><label htmlFor="connectionId">ID</label><input id="connectionId" disabled={locked || Boolean(editing)} value={draft.id} onChange={event => { const id = event.target.value.toLowerCase().replace(/[^a-z0-9._-]/gu, "-"); update({ id, credentialId: id }); }} /></div></div>
      <label htmlFor="connectionBaseUrl">Base URL</label><input id="connectionBaseUrl" type="url" disabled={locked} value={draft.baseUrl} onChange={event => update({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
      <p id="connectionHelp" className="hint">{i18n.t(connectionHelp)}</p>
      <label htmlFor="connectionModel">{i18n.t("options.provider.model")}</label><input id="connectionModel" aria-describedby="connectionHelp" disabled={locked} value={draft.defaultModel} onChange={event => update({ defaultModel: event.target.value })} />
      <label htmlFor="connectionApiKey">API Key</label><input id="connectionApiKey" type="password" autoComplete="off" disabled={locked || clearApiKey} value={apiKey} onChange={event => { setApiKey(event.target.value); setClearApiKey(false); }} placeholder={editing?.hasApiKey ? i18n.t("options.connections.keyKeep") : ""} />
      {editing?.hasApiKey ? <label className="checkbox-label"><input type="checkbox" disabled={locked} checked={clearApiKey} onChange={event => { setClearApiKey(event.target.checked); if (event.target.checked) setApiKey(""); }} />{i18n.t("options.connections.keyClear")}</label> : null}
      <div className="profile-grid"><div><label htmlFor="connectionOutputTokens">{i18n.t("options.connections.outputTokens")}</label><input id="connectionOutputTokens" type="number" min="128" max="32768" disabled={locked} value={draft.settings.outputTokens} onChange={event => settings({ outputTokens: Number(event.target.value) })} /></div><div><label htmlFor="connectionTemperature">Temperature</label><input id="connectionTemperature" type="number" min="0" max="2" step="0.1" disabled={locked} value={draft.settings.temperature ?? ""} onChange={event => settings({ temperature: event.target.value === "" ? null : Number(event.target.value) })} /></div></div>
      <div className="inline-checks"><label className="checkbox-label"><input type="checkbox" disabled={locked || draft.protocol !== "openai-chat"} checked={draft.settings.streaming && draft.protocol === "openai-chat"} onChange={event => settings({ streaming: event.target.checked })} />{i18n.t("options.provider.streaming")}</label><label className="checkbox-label"><input type="checkbox" disabled={locked} checked={draft.settings.allowEmptyApiKey} onChange={event => settings({ allowEmptyApiKey: event.target.checked })} />{i18n.t("options.connections.allowEmptyKey")}</label><label className="checkbox-label"><input type="checkbox" disabled={locked} checked={draft.settings.allowInsecureHttp} onChange={event => settings({ allowInsecureHttp: event.target.checked })} />{i18n.t("options.connections.allowHttp")}</label></div>
      <p className="hint">{i18n.t("options.connections.permissionHelp")}</p><div className="actions"><button className="primary" type="submit" disabled={locked}>{i18n.t("options.connections.save")}</button><button type="button" disabled={locked} onClick={reset}>{i18n.t("options.sites.clearEditor")}</button></div>
    </form>
  </section>;
}

function emptyDraft(): Draft { const preset = providerPlatformPreset("openai")!; return { id: "openai", revision: 1, name: preset.label, platform: preset.id, protocol: preset.protocol, baseUrl: preset.baseUrl, credentialId: "openai", defaultModel: "", settings: { streaming: true, outputTokens: 4096, temperature: null, reasoning: "", allowEmptyApiKey: false, allowInsecureHttp: false } }; }
function stripPublic(value: ProviderConnection): Draft { const { hasApiKey: _ignored, ...connection } = value; return connection; }
function uniqueId(base: string, values: ProviderConnection[]) { const ids = new Set(values.map(value => value.id)); if (!ids.has(base)) return base; let index = 2; while (ids.has(`${base}-${index}`)) index += 1; return `${base}-${index}`; }
function serviceValue(service: ServiceRef | null) { return service?.kind === "chatgpt-plan" ? "chatgpt-plan" : service?.kind === "api-key" ? `api-key:${service.connectionId}` : ""; }
function parseService(value: string): ServiceRef { return value === "chatgpt-plan" ? { kind: "chatgpt-plan" } : { kind: "api-key", connectionId: value.replace(/^api-key:/u, "") }; }
function errorText(value: unknown) { return value instanceof Error ? value.message : String(value || "Operation failed"); }
