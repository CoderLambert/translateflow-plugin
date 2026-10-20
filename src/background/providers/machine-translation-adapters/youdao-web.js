import { machineError, machineProvider } from "../../../shared/machine-translation.js";

export const youdaoAdapter = {
    build(id, texts, from, to) { const p = machineProvider(id); return { url: p.origin + p.path, contentType: "application/x-www-form-urlencoded", body: new URLSearchParams({ q: texts[0], from: from === "auto" ? "auto" : from === "zh" ? "zh-CHS" : from, to: to === "zh" ? "zh-CHS" : to }).toString() }; },
    parse(_id, body, _sources, input = {}) {
      if (String(body?.errorCode) !== "0" || !Array.isArray(body?.translation) || body.translation.some(text => typeof text !== "string" || !text.trim())) throw machineError("MT_RESPONSE");
      if (input.targetLanguage && (typeof body.l !== "string" || !/^(?:en|zh-CHS)2(?:en|zh-CHS)$/u.test(body.l) || !body.l.endsWith(input.targetLanguage === "zh" ? "2zh-CHS" : "2en"))) throw machineError("MT_RESPONSE");
      return [body.translation.join("\n")];
    }
  };
