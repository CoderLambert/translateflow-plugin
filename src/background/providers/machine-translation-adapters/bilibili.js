import { machineError, machineProvider } from "../../../shared/machine-translation.js";
const languageNames = { zh: "中文", en: "英语", ja: "日语", ko: "韩语", fr: "法语", de: "德语", es: "西班牙语", ru: "俄语", pt: "葡萄牙语", it: "意大利语", ar: "阿拉伯语", vi: "越南语", th: "泰语", id: "印尼语" };

export const bilibiliAdapter = {
    build(id, texts, from, to) {
      const provider = machineProvider(id);
      if (!languageNames[to]) throw machineError("MT_LANGUAGE");
      return { url: provider.origin + provider.path, body: { model: provider.model, stream: false, temperature: 0, max_tokens: 2048,
        chat_template_kwargs: { enable_thinking: false }, messages: [{ role: "user", content: `请将以下文本翻译为${languageNames[to]}，直接输出翻译结果，不要进行任何解释。\n\n${texts[0]}` }] } };
    },
    parse(_id, body) {
      if (!Array.isArray(body?.choices) || body.choices.length !== 1 || body.choices[0]?.finish_reason !== "stop" || body.choices[0]?.message?.role !== "assistant") throw machineError("MT_RESPONSE");
      const text = body.choices[0].message.content;
      if (typeof text !== "string" || /<\/?think>/iu.test(text)) throw machineError("MT_RESPONSE");
      return [text];
    }
  };
