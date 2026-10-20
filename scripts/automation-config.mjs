import { readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";

export function validateAutomationConfig(value) {
  const c = structuredClone(value);
  if (c?.schemaVersion !== 1 || !/^[a-zA-Z0-9-]{8,80}$/u.test(c.campaignId || "")) throw new Error("Invalid automation campaign");
  if (typeof c.realAi?.enabled !== "boolean") throw new Error("Explicit boolean real-AI consent is required");
  if (c.chromeLocal?.allowModelDownload !== undefined && typeof c.chromeLocal.allowModelDownload !== "boolean") throw new Error("Explicit boolean model-download consent is required");
  if (c.realAi?.enabled && (c.realAi.baseUrl !== "https://api.deepseek.com" || c.realAi.model !== "deepseek-flash" || c.realAi.protocol !== "openai-chat")) throw new Error("Only the configured official DeepSeek endpoint is supported");
  if (!Number.isSafeInteger(c.realAi?.maxRequests) || c.realAi.maxRequests < 1 || c.realAi.maxRequests > 20) throw new Error("Request budget must be 1..20");
  if (!Number.isSafeInteger(c.realAi.maxOutputTokens) || c.realAi.maxOutputTokens < 128 || c.realAi.maxOutputTokens > 4096) throw new Error("Invalid output token cap");
  if (!c.browser?.useIsolatedTestProfile) throw new Error("An isolated profile is required");
  if (!["dist/extension", ".output/chrome-mv3"].includes(c.artifact) || !c.outputBase) throw new Error("A supported artifact and output path are required");
  for (const url of c.livePages?.urls || []) if (new URL(url).protocol !== "https:") throw new Error("Live pages require HTTPS");
  return c;
}
export function readAutomationConfig(path) { return validateAutomationConfig(JSON.parse(readFileSync(resolve(path), "utf8"))); }
export function readAutomationSecret(config, env = process.env) {
  if (!config.realAi.enabled) return "";
  const name = config.realAi.apiKeyEnv;
  if (env[name]) return env[name];
  const path = config.realAi.secretFile;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error("Secret file must be a private regular file (0600)");
  const key = JSON.parse(readFileSync(path, "utf8"))[name];
  if (typeof key !== "string" || key.length < 10) throw new Error("Missing configured credential");
  return key;
}
