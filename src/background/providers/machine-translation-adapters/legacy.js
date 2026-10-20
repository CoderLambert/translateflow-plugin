import { machineError, machineProvider } from "../../../shared/machine-translation.js";
function legacyRequest(providerId, texts, from, to) {
  const provider = machineProvider(providerId);
  if (!Array.isArray(texts) || !texts.length || texts.length > provider.batchSize || texts.some(text => typeof text !== "string" || !text.trim())) throw machineError("MT_INPUT");
  const url = new URL(provider.origin + provider.path);
  if (providerId === "mt-microsoft-web") {
    url.search = new URLSearchParams({ from, to, isEnterpriseClient: "false" }).toString();
    return { url: url.href, body: texts.map(escapeHtmlText) };
  }
  if (providerId !== "mt-tencent-transmart") throw machineError("MT_CONFIG");
  return { url: url.href, body: { header: { fn: "auto_translation", client_key: `browser-chrome-110.0.0-Mac OS-${crypto.randomUUID()}-${Date.now()}` },
    type: "plain", model_category: "normal", source: { text_list: texts, lang: from }, target: { lang: to } } };
}

function legacyResponse(providerId, data, sources) {
  machineProvider(providerId);
  let translations;
  if (providerId === "mt-microsoft-web") {
    if (!Array.isArray(data) || data.length !== sources.length) throw machineError("MT_RESPONSE");
    translations = data.map((item, index) => {
      if (!Array.isArray(item?.translations) || item.translations.length !== 1 || typeof item.translations[0]?.text !== "string") throw machineError("MT_RESPONSE");
      const translated = decodeHtmlText(item.translations[0].text);
      for (const [entity, count] of entities(sources[index])) if (entities(translated).get(entity) !== count) throw machineError("MT_RESPONSE");
      return translated;
    });
  } else if (providerId === "mt-tencent-transmart") {
    if (data?.header?.ret_code !== "succ") throw machineError(data?.header?.ret_code === "Auth-Failed" ? "MT_BLOCKED" : "MT_RESPONSE");
    translations = data.auto_translation;
  } else throw machineError("MT_CONFIG");
  if (!Array.isArray(translations) || translations.length !== sources.length || translations.some(text => typeof text !== "string" || !text.trim() || /⟦TF:|[\u0000\u0008\u000b\u000c]/u.test(text))) throw machineError("MT_RESPONSE");
  return translations.map(text => text.trim());
}
function escapeHtmlText(text) {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");
}
function decodeHtmlText(text) {
  const table = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'" };
  return text.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/giu, (_match, key) => table[key.toLowerCase()]);
}
function entities(text) {
  const values = new Map();
  for (const item of String(text).matchAll(/&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/gu)) values.set(item[0], (values.get(item[0]) || 0) + 1);
  return values;
}

export { legacyRequest, legacyResponse };
