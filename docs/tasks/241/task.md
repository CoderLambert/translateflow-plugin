# 241 — Selection 助手真实文本流、Port 身份与中断

Parent：任务 229；硬依赖 236。任务 241 只交付 D 链的运行时基础，不实现 242 的 grounded 动作/追问领域规则或 243 UI。

## 结果

- 新建窄 `selection.assistant-stream` Port：一个受控 Content document、一个 start、一个 requestId；后台验证 extension id、top frame、http(s) sender、documentId 或现有 ownerToken fallback，并把 pageUrl 绑定真实 sender。
- 使用现有 Provider/权限/timeout/AbortController。OpenAI-compatible streaming 开启时转发实际文本 delta；不支持/关闭 streaming 或 DeepSeek 时明确 `mode:unary`，完成后一次发送完整文本，不伪装流。
- 消息只有 started/delta/complete/interrupted；delta 顺序、字符/事件/总字节有界。Port disconnect、显式 stop、导航/worker loss 中断底层 fetch；partial 仅为内存 UI 数据，不写缓存/Reading artifact，不自动重试或续接收费请求。
- 不复用 `reading.invalidate`，不造通用 bus，不新增权限/Provider/DB。

## 验收

- Node 覆盖 sender/owner、重复 start、cross-owner cancel、delta 顺序/上限、unary fallback、Stop/disconnect/late delta、malformed/truncated SSE。
- WXT Chromium 使用 mock SSE 验证真实 Port delta、stop partial、断开后无 late complete；无私密内容进入日志。
- 完整门槛：`npm run validate`、`npm run build:extension:wxt`、`npm run test:e2e -- e2e/selection-assistant-stream.spec.mjs`。
