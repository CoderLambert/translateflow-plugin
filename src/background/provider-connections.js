import {
  PROVIDER_CONNECTIONS_VERSION,
  migrateLegacyProviderState,
  normalizeProviderConnection,
  normalizeProviderConnectionState,
  normalizeServiceRef,
  publicProviderConnection
} from "../shared/provider-connections.js";

const STORAGE_KEYS = ["providerConnectionsVersion", "providerConnections", "providerCredentials", "defaultService", "provider", "apiKey", "model", "openAICompatible"];

export async function ensureProviderConnections() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  const state = migrateLegacyProviderState(stored);
  if (state.migrated || stored.providerConnectionsVersion !== PROVIDER_CONNECTIONS_VERSION || !normalizeServiceRef(stored.defaultService)) {
    if (typeof chrome.storage.local.set === "function") await chrome.storage.local.set({ providerConnectionsVersion: PROVIDER_CONNECTIONS_VERSION, providerConnections: state.connections,
      providerCredentials: state.credentials, defaultService: state.defaultService });
  }
  return state;
}

export async function getProviderConnectionState() {
  await ensureProviderConnections();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.slice(0, 4));
  return normalizeProviderConnectionState(stored);
}

export async function listProviderConnections() {
  const state = await getProviderConnectionState();
  return {
    version: state.version,
    defaultService: state.defaultService,
    connections: Object.values(state.connections).map(connection => publicProviderConnection(connection, state.credentials[connection.credentialId]))
  };
}

export async function upsertProviderConnection(input = {}) {
  const state = await getProviderConnectionState();
  const draft = normalizeProviderConnection(input.connection, input.connection?.id);
  const existing = state.connections[draft.id];
  const expectedRevision = Number(input.expectedRevision || 0);
  if ((existing?.revision || 0) !== expectedRevision) throw connectionError("连接已在其它设置页更新，请刷新后重试。", "CONNECTION_CONFLICT");
  const connection = normalizeProviderConnection({ ...draft, revision: (existing?.revision || 0) + 1 }, draft.id);
  const connections = { ...state.connections, [connection.id]: connection };
  const credentials = { ...state.credentials };
  if (input.updateCredential === true) credentials[connection.credentialId] = validateCredential(input.apiKey);
  else if (!Object.hasOwn(credentials, connection.credentialId)) credentials[connection.credentialId] = "";
  const defaultService = state.defaultService || { kind: "api-key", connectionId: connection.id };
  await chrome.storage.local.set({ providerConnectionsVersion: PROVIDER_CONNECTIONS_VERSION, providerConnections: connections, providerCredentials: credentials, defaultService });
  return { connection: publicProviderConnection(connection, credentials[connection.credentialId]), defaultService };
}

export async function deleteProviderConnection(connectionId, expectedRevision) {
  const state = await getProviderConnectionState();
  const id = String(connectionId || "").trim().toLowerCase();
  const existing = state.connections[id];
  if (!existing) return { deleted: false };
  if (existing.revision !== Number(expectedRevision || 0)) throw connectionError("连接已在其它设置页更新，请刷新后重试。", "CONNECTION_CONFLICT");
  if (state.defaultService?.kind === "api-key" && state.defaultService.connectionId === id) throw connectionError("默认连接不能删除，请先选择其它默认服务。", "CONNECTION_IN_USE");
  const storedProfiles = await chrome.storage.local.get(["siteProfiles"]);
  const inUse = Object.values(storedProfiles.siteProfiles || {}).some(profile => profile?.serviceRef?.kind === "api-key" && profile.serviceRef.connectionId === id);
  if (inUse) throw connectionError("该连接仍被站点配置使用，请先移除站点覆盖。", "CONNECTION_IN_USE");
  const connections = { ...state.connections }; delete connections[id];
  const credentials = { ...state.credentials }; delete credentials[existing.credentialId];
  await chrome.storage.local.set({ providerConnections: connections, providerCredentials: credentials });
  return { deleted: true };
}

export async function setDefaultService(rawService) {
  const state = await getProviderConnectionState();
  const service = normalizeServiceRef(rawService);
  if (!service) throw connectionError("默认服务无效。", "CONFIG");
  if (service.kind === "api-key" && !state.connections[service.connectionId]) throw connectionError("所选连接不存在。", "CONNECTION_MISSING");
  await chrome.storage.local.set({ defaultService: service });
  return { defaultService: service };
}

export function resolveConnectionService(state, rawService) {
  const service = normalizeServiceRef(rawService || state.defaultService);
  if (!service) throw connectionError("尚未选择默认翻译服务。", "CONFIG");
  if (service.kind === "chatgpt-plan") return { service, connection: null, apiKey: "" };
  const connection = state.connections[service.connectionId];
  if (!connection) throw connectionError(`连接不存在或已删除：${service.connectionId}`, "CONNECTION_MISSING");
  const apiKey = String(state.credentials[connection.credentialId] || "").trim();
  if (!apiKey && !connection.settings.allowEmptyApiKey) throw connectionError(`请先为 ${connection.name} 配置 API Key。`, "CONFIG");
  return { service, connection, apiKey };
}

function connectionError(message, code) { const error = new Error(message); error.code = code; return error; }
function validateCredential(value) {
  const credential = String(value || "").trim();
  if (credential.length > 16384 || /[\r\n]/u.test(credential)) throw connectionError("API Key 格式无效或过长。", "CONFIG");
  return credential;
}
