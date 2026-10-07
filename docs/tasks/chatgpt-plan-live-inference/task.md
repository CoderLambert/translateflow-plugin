# ChatGPT 订阅真实推理修复

## 目标与范围

修复候选提交 `56df667bd3a35933ea33259f2723437def18fd6c` 在 Google Chrome、Linux Native Messaging 与真实 Sign in with ChatGPT 会话下能够连接并列出模型、但 Responses 推理被 Host 误判为无效流的问题。

范围仅包括 Native Host 的 Responses 请求和流解析、对应离线测试、当前用户级 Host 替换与最小真实验收。不修改用户词典、学习记录、Chrome profile、OAuth grant、Secret Service、PAM、系统包、扩展权限、Host allowlist 或 CSP。

## 实现边界

- 保持固定 `https://api.openai.com/v1/responses`、`store:false`、`stream:true` 与现有请求大小限制。
- 按官方最小示例发送字符串 `content`，不增加工具、后台执行、持久会话或其它 Responses 字段。
- 200 响应以受限 SSE 帧、合法 JSON、`response.completed` 终止事件和输出上限判定成功，不因非标准 `Content-Type` 头拒绝有效事件流。
- 非 200 与流内失败只保留受限机器错误码或 HTTP 状态；不记录或转发令牌、OAuth code、提示词、网页内容或上游诊断正文。

## 验收

- `go test ./...` 通过，覆盖非标准 Content-Type 的有效 SSE、流内失败码、HTTP 结构化错误码与状态回退。
- 构建 Linux AMD64 Host，并用现有安全存储会话仅发送安装文档指定的公开合成句子；收到完整流式结果且终端文本一致。
- 为当前用户保留原扩展 ID `oclenlafljjhdcjmibbbiompifaoobgj` 与 Chrome Native Messaging 注册，仅替换 Host 二进制；扩展包与用户数据不变。

