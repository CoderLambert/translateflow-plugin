# 主 Agent 自查：ChatGPT Plan Native Host 收口

**candidateHead:** `c1213d85203873ff0ab37bf92bfd5babd2fcf996`

**检查主体:** 主 Agent（自查，不是独立审核）

## 实现范围

- 从 PR #314 的准确候选中选择性整合 Go Native Messaging Host、Responses SSE
  修复和扩展接线，没有搬入旧 Selection / Reading 混合分支。
- `chatgpt-plan` 复用现有 Provider dispatcher、effective config、缓存身份、Selection
  和 Learning Center 提交点；只在 `response.completed` 后返回完整结果。
- Host 按账号保存独立的 issued client ID、subject、token 和 session，并保留一个稳定
  host ID。Settings 显示当前账号，支持添加或选择已保存账号；切换账号会清除 ChatGPT
  模型选择，不修改其他 Provider 凭据。
- v1 单账号凭据在读取时迁移到 v2 多账号记录；不通过清空用户数据完成迁移。退出登录
  只失效当前账号 token，保留其注册映射和其他账号 session。

## 安全与兼容自查

- token 只经过 Go 进程与系统安全存储；扩展 storage、日志、测试证据和 Native Messaging
  响应都不包含 token。官方授权 URL 只在系统浏览器打开且不记录。
- 网络目标固定为 OpenAI 官方 OIDC、models 和 Responses HTTPS 端点。推理请求固定
  `store:false`、`stream:true`；SSE 有帧、行、响应和输出上限。
- Native Messaging 请求严格校验字段、requestId、序列、并发和取消；安装 manifest 仅允许
  调用者给出的准确 Chrome extension ID。生产 manifest 新增 required `nativeMessaging`，
  未增加固定 key、CSP 或新的 host permission。
- 自查曾发现默认生产控制器未转发 `addAccount` 且缺少 `selectAccount`；已在本候选修复并
  添加直接回归测试。早期集成测试还因旧 Host capability fixture 挂起；已补 `auth.select`
  并在本候选全套重验。
- 对照当前 OpenAI 官方 Accounts and sessions / Models and inference 文档，账号注册隔离、
  reauthorization、模型刷新和完成事件语义一致。

## 精确候选验收

- `npm run validate`：PASS；Node 1214/1214、Vitest 37/37、严格类型检查和开发安装包构建通过。
- `npm run build:extension:wxt`：PASS；119 files、2,356,864 bytes。
- `npm run test:wxt:smoke`：PASS；Chrome for Testing 153.0.8010.12。
- `npm run test:e2e -- e2e/chatgpt-plan-nativehost.spec.mjs --workers=1`：PASS；真实 WXT
  Settings 在 Host 缺失时显示明确错误，保留连接/添加账号入口，390px 无横向溢出。
- `go -C native-host test -race ./...`：PASS；清除 test cache 后的最新记录未使用缓存。
- WXT 产物 fingerprint：`980bd526188fea77d36c150514d3f8e031d5c4957e76c1c808d26e2934eed7c1`。

逐项耗时、退出码与本地日志 hash 记录在 `acceptance.json`。

## 未完成门槛

- 用户本人真实登录、多账号切换、账号级模型列表、真实 Responses 推理、登出撤销、浏览器
  与 Host 重启恢复：`NOT_RUN`。
- Windows 实机安装与凭据管理器：`NOT_RUN`。
- 固定发布扩展 ID：缺失；当前安装器只能显式接收准确 ID。
- 独立代码/安全审查：`NOT_RUN`。因此当前状态为 `reviewing`，不满足合并条件。
