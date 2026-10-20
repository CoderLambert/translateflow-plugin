import { machineError, machineProvider } from "../../../shared/machine-translation.js";

export const volcengineAdapter = {
    build(id, texts, from, to) { const p = machineProvider(id); return { url: p.origin + p.path, body: { source_language: from, target_language: to, text: texts[0] } }; },
    parse(_id, body) { if (typeof body?.translation !== "string") throw machineError("MT_RESPONSE"); return [body.translation]; }
  };
