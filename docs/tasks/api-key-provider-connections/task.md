# 插件内多平台 API Key 连接

本任务在插件内实现自包含的多 Provider API Key 直连，不依赖 LiteLLM、代理服务或项目后端。实现基于最新 `origin/main`，保留当前 Selection 多标签、Markdown/富词典流程与 ChatGPT subscription Native Host 的独立入口。

## 用户结果

- 用户可以创建、编辑、测试、选择和删除多个 API Key 连接；连接支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 与 Gemini `generateContent`。
- 内置主流平台 Preset 负责填写协议与 Base URL，仍允许自定义 OpenAI-compatible、本地无 Key 服务和 Azure OpenAI v1 endpoint。
- 全局默认连接与站点覆盖使用稳定连接引用；连接被删除或配置失效时明确报错，不静默切换到其它付费服务。
- 旧 DeepSeek / OpenAI-compatible 配置自动迁移且继续可用；ChatGPT subscription 保持独立、可选的 Native Host 登录方式。
- API Key 只由受信任扩展页面写入并由后台读取；网页 Content Script 通过后台消息读取公开行为设置，不能直接访问凭据存储。

## 范围与边界

1. 新增版本化连接、凭据和默认服务合同；迁移保留旧字段以支持升级与回滚，不清空缓存或用户配置。
2. 外部 HTTP 只放在 `src/background/providers/`。四类 adapter 复用统一超时、取消、重试、错误分类和结构化输出校验。
3. OpenAI-compatible 本地 endpoint 可显式允许空 API Key；其它内置云平台要求 API Key。只支持 http/https，不支持旧 Azure deployment URL、Bedrock、Vertex IAM/OAuth 或自动故障转移。
4. Effective Config 在一次任务中冻结；缓存 identity 包含连接 id、revision、协议、endpoint、model、prompt、target language 与 glossary identity，但不包含密钥明文。
5. Options 在现有 React 信息架构中加入连接管理，保留 ChatGPT Native Host 安装、重启、重连、版本校验与账户模型体验。
6. 不扩大 required permissions；API endpoint 继续在用户保存/测试的可信手势中申请 origin 权限。

## 完成标准

- 单元/Node 测试覆盖连接规范化、旧配置迁移、缺失引用、乐观 revision、凭据不回传、四协议请求/响应、空 Key 本地服务、真实失败的连接测试、权限、缓存 identity 与任务配置冻结。
- Options 覆盖连接增删改测、默认服务、站点连接覆盖、窄屏/暗色与 ChatGPT subscription 回归。
- 页面翻译、Selection AI tabs/Markdown/富词典、字幕和学习中心继续使用同一有效连接；缓存读、Provider 请求与缓存写使用相同配置快照。
- `npm run validate`、`npm run build:extension:wxt`、`npm run test:wxt:smoke` 通过；运行受影响的 Chromium E2E。真实 Provider、商店发布和旧 Azure/云 IAM 不在本任务验收范围。
