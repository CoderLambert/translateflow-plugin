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
  return { result: await testProvider(config) };
}
