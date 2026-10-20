import { machineError } from "../../shared/machine-translation.js";

const RULE_ID = 12001;
let ready;
export function ensureBilibiliRule() {
  if (!ready) ready = install().catch(error => { ready = null; throw error; });
  return ready;
}
async function install() {
  const api = globalThis.chrome?.declarativeNetRequest, id = globalThis.chrome?.runtime?.id;
  if (!api || !/^[a-p]{32}$/u.test(id || "")) throw machineError("MT_PERMISSION");
  try {
    await api.updateSessionRules({ removeRuleIds: [RULE_ID], addRules: [{ id: RULE_ID, priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
      condition: { regexFilter: "^https://index-translate\\.bilibili\\.com/v1/chat/completions$", isUrlFilterCaseSensitive: true,
        initiatorDomains: [id], requestMethods: ["post"], resourceTypes: ["xmlhttprequest"] }
    }] });
  } catch { throw machineError("MT_PERMISSION"); }
}
