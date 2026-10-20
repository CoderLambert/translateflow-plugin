import { machineError, machineProvider, machineSupports } from "../../../shared/machine-translation.js";
import { legacyRequest, legacyResponse } from "./legacy.js";

import { bilibiliAdapter } from "./bilibili.js";
import { googleAdapter } from "./google-web.js";
import { volcengineAdapter } from "./volcengine-web.js";
import { youdaoAdapter } from "./youdao-web.js";

const protocols = {
  "mt-microsoft-web": { build: legacyRequest, parse: legacyResponse },
  "mt-tencent-transmart": { build: legacyRequest, parse: legacyResponse },
  "mt-bilibili": bilibiliAdapter,
  "mt-google-web": googleAdapter,
  "mt-volcengine-web": volcengineAdapter,
  "mt-youdao-web": youdaoAdapter
};
export function machineAdapter(id) {
  const p = machineProvider(id), protocol = protocols[id];
  if (!protocol) throw machineError("MT_CONFIG");
  return Object.freeze({ id, adapterVersion: p.adapterVersion, model: p.model || "not-disclosed", limits: { maxCodePoints: p.maxCodePoints, batchSize: p.batchSize },
    supports: (from, to) => machineSupports(id, from, to), buildRequest: input => buildMachineRequest(id, input.texts, input.from, input.to),
    parseResponse: (body, input) => parseMachineResponse(id, body, input.texts, input) });
}
export function buildMachineRequest(id, texts, from, to) {
  const p = machineProvider(id), protocol = protocols[id];
  if (!protocol) throw machineError("MT_CONFIG");
  if (!Array.isArray(texts) || !texts.length || texts.length > p.batchSize || texts.some(t => typeof t !== "string" || !t.trim() || [...t].length > p.maxCodePoints)) throw machineError("MT_INPUT");
  return { method: "POST", contentType: "application/json", ...protocol.build(id, texts, from, to) };
}
export function parseMachineResponse(id, body, sources, input = {}) {
  machineProvider(id);
  if (!protocols[id]) throw machineError("MT_CONFIG");
  const values = protocols[id].parse(id, body, sources, input);
  if (!Array.isArray(values) || values.length !== sources.length || values.some(t => typeof t !== "string" || !t.trim() || /⟦TF:|[\u0000\u0008\u000b\u000c]/u.test(t))) throw machineError("MT_RESPONSE");
  return values.map(t => t.trim());
}
