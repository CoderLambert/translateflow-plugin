import { machineError, machineProvider } from "../../../shared/machine-translation.js";

export const googleAdapter = {
    build(id, texts, from, to) {
      const provider = machineProvider(id), url = new URL(provider.origin + provider.path);
      url.search = new URLSearchParams({ client: "gtx", sl: from || "auto", tl: to === "zh" ? "zh-CN" : to, dt: "t", q: texts[0] }).toString();
      return { url: url.href, method: "GET" };
    },
    parse(_id, body) {
      if (!Array.isArray(body?.[0]) || !body[0].length || body[0].some(item => typeof item?.[0] !== "string")) throw machineError("MT_RESPONSE");
      return [body[0].map(item => item[0]).join("")];
    }
  };
