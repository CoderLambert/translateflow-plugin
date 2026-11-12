# 主 Agent 自查

对象：本任务 worktree 的实际 diff；基线 6a7e796adee07639b673d78907c3342ec946644b。未提交，不是独立审核或冻结候选。

- 19 平台配置沿既有 dispatcher → adapter → SDK transport，按保存协议显式选模型 API。检查 Azure v1、xAI Chat、完整自定义 endpoint 与本地免 Key 的真实请求。
- 发现并修复完整 Gemini URL 的模型路径被 SDK model 参数覆盖：保留完整 endpoint，失败测试转绿。
- 发现并修复 Anthropic 文字与 tool_use 混合且 end_turn 时被当作完成：检查 SDK toolCalls，失败测试转绿。截断、拒答、未知结束态、空结果和工具调用不返回完整业务结果。
- SDK maxRetries 为 0，沿用原重试策略；部分流输出不重放。取消/超时含响应体；流使用字节活动刷新空闲时限。onError 显式接管，避免 SDK 默认日志输出原始请求。
- 生成功能只在后台闭包，新增依赖只允许 transport 引入；Manifest 与基线完全相同。无权限/CSP 扩大、无默认服务替换、无数据库升级或清库。
- 默认 reasoning 不发参数；未知模型显式高级确认。未知旧 effort 保留连接并报错。API Key 缓存通过 adapterVersion 隔离；机器翻译与订阅路径不变。
- 已检查窄屏截图、设置保存/重载、MV3 重启与流式停止。真实厂商与人工实际模型质量尚未验收。

未解决实现缺陷：本次自查未发现。限制：SDK 上游声明不兼容 exactOptionalPropertyTypes，使用 JS adapter 的明确公开声明隔离；不宣称 SDK 自身类型声明已严格通过。
