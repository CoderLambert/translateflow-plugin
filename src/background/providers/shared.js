export function buildTranslationPrompt(config, fallbackPrompt = "") {
  const prompt = String(config?.prompt || fallbackPrompt || "").trim();
  const targetLanguage = String(config?.targetLanguage || "").trim();
  if (!targetLanguage) return prompt;
  if (!prompt) return `Translate to ${targetLanguage}.`;

  const defaultLanguageInstruction =
    "Translate the provided English web-page segments into natural Simplified Chinese.";
  if (prompt.includes(defaultLanguageInstruction)) {
    return prompt.replaceAll(
      defaultLanguageInstruction,
      `Translate the provided English web-page segments into natural ${targetLanguage}.`
    );
  }

  const promptText = prompt.toLocaleLowerCase();
  if (promptText.includes(targetLanguage.toLocaleLowerCase())) return prompt;
  return `${prompt}\nTarget language: ${targetLanguage}.`;
}

export async function requestChatCompletions({
  url,
  apiKey,
  body,
  providerLabel,
  requireApiKey = true
}) {
  const token = String(apiKey || "").trim();
  if (requireApiKey && !token) throw new Error(`请先配置 ${providerLabel} API Key。`);

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${providerLabel} 返回了非 JSON 响应（HTTP ${response.status}）。`);
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
    throw new Error(`${providerLabel} API 请求失败：${detail}`);
  }
  return data;
}

export function parseTranslationResult(data, segments, providerLabel) {
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${providerLabel} 没有返回翻译内容。`);

  const parsed = parseJsonObject(content, providerLabel);
  if (!Array.isArray(parsed.translations)) {
    throw new Error(`${providerLabel} 返回格式不正确：缺少 translations 数组。`);
  }

  const validIds = new Set(segments.map((item) => String(item.id)));
  return parsed.translations
    .filter((item) => validIds.has(String(item.id)) && typeof item.text === "string")
    .map((item) => ({ id: String(item.id), text: item.text.trim() }));
}

function parseJsonObject(content, providerLabel) {
  const trimmed = String(content || "").trim();
  const unfenced = trimmed
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {}

  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(unfenced.slice(first, last + 1));
    } catch {}
  }

  throw new Error(`${providerLabel} 返回内容无法解析为 JSON。请重试或检查 Prompt。`);
}
