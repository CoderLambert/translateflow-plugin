const API_URL = "https://api.deepseek.com/chat/completions";

export const deepSeekProvider = Object.freeze({
  id: "deepseek",
  async translateBatch(segments, config) {
    if (!Array.isArray(segments) || segments.length === 0) return [];

    const payload = {
      segments: segments.map((item) => ({ id: String(item.id), text: String(item.text) }))
    };

    const data = await requestDeepSeek({
      model: config.model?.trim() || "deepseek-flash",
      messages: [
        { role: "system", content: config.prompt?.trim() || "Translate to Simplified Chinese." },
        { role: "user", content: JSON.stringify(payload) }
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      stream: false,
      temperature: 0.2
    }, config);

    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek 没有返回翻译内容。");

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("DeepSeek 返回内容无法解析为 JSON。请重试或检查自定义 Prompt。");
    }
    if (!Array.isArray(parsed.translations)) {
      throw new Error("DeepSeek 返回格式不正确：缺少 translations 数组。");
    }

    const validIds = new Set(segments.map((item) => String(item.id)));
    return parsed.translations
      .filter((item) => validIds.has(String(item.id)) && typeof item.text === "string")
      .map((item) => ({ id: String(item.id), text: item.text.trim() }));
  },

  async test(config) {
    const data = await requestDeepSeek({
      model: config.model?.trim() || "deepseek-flash",
      messages: [
        { role: "system", content: "Reply with exactly: OK" },
        { role: "user", content: "Connection test" }
      ],
      thinking: { type: "disabled" },
      stream: false,
      temperature: 0
    }, config);
    return data?.choices?.[0]?.message?.content?.trim() || "OK";
  }
});

async function requestDeepSeek(body, config) {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) throw new Error("请先在设置中填写 DeepSeek API Key。");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`DeepSeek 返回了非 JSON 响应（HTTP ${response.status}）。`);
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
    throw new Error(`DeepSeek API 请求失败：${detail}`);
  }
  return data;
}
