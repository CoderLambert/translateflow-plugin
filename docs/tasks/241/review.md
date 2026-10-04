# 241 主 Agent 自查

候选 `303b4d9e2e61509d5e005b1caa6aa2bc867b3f94`，基线 `origin/main=03d8126877ebf7640b188495961c73b8762281da`。PASS。

窄 `selection.assistant-stream` Port 绑定真实 top-frame sender、documentId 或 32-hex fallback、pageUrl 与单一 requestId；重复 start/cross sender fail-closed。OpenAI-compatible streaming 转发实际 SSE text delta；DeepSeek/关闭或不支持 streaming 明确 unary。stop、disconnect、导航、tab remove、权限撤销都 abort 原 fetch；late complete 被丢弃，partial 只在内存，不写 cache/Reading。它不复用 `reading.invalidate`，不扩权限或通用 bus。

正式证据：`npm run validate` PASS（1059 Node、15 Vitest、strict typecheck、默认 WXT）；显式 WXT 158 files / 1,814,366 bytes，platform 1,566,977 ≤ 1,576,595，fingerprint `e1a48ac84ae085d7e94977d7e44ae3857d133e1fe2701ead588dfeaef3ffaabd`；聚焦 Chromium E2E 1/1 PASS，真实 SSE delta、Stop partial、无 late complete。242–244/其它浏览器/发布未验证。
