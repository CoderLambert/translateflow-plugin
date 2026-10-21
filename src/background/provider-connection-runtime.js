import { DEFAULT_CONFIG } from "../shared/constants.js";
import { resolveTranslationConfig } from "../shared/provider-config.js";
import { getProviderConnectionState } from "./provider-connections.js";
import { testProvider } from "./providers/index.js";

export async function testSavedProviderConnection(connectionId) {
  const state = await getProviderConnectionState();
  const id = String(connectionId || "");
  const connection = state.connections[id];
  if (!connection) throw Object.assign(new Error("所选连接不存在。"), { code: "CONNECTION_MISSING" });
  const config = resolveTranslationConfig({ ...DEFAULT_CONFIG, providerConnectionsVersion: state.version,
    providerConnections: state.connections, providerCredentials: state.credentials,
    defaultService: { kind: "api-key", connectionId: connection.id } });
  try {
    return { result: await testProvider(config) };
  } catch (error) {
    if (connection.platform === "ollama" && error.status === 403) {
      const origin = chrome.runtime.getURL("").replace(/\/$/u, "");
      error.message = `Ollama 拒绝了扩展请求（HTTP 403）。请检查服务的访问限制；若未允许浏览器扩展，请将 ${origin} 加入 Ollama 的 OLLAMA_ORIGINS，重启服务后重试。`;
    }
    throw error;
  }
}
