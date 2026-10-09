# ChatGPT Plan Native Host 收口

## 目标

在最新 `origin/main` 上选择性整合已有 ChatGPT Plan Native Messaging
实现和 PR #314 的 Responses SSE 修复，使扩展、Native Host 和设置页遵循当前
Sign in with ChatGPT 契约。保留已经合入的词典、Selection、Reading 与生词本
实现，不整体搬入任何 NativeHost/Plan/Selection 混合分支。

## 范围

- 引入现有 Go Native Host、用户级安装器和受限 Native Messaging 协议。
- 通过 Background Provider 与 Options 接入 ChatGPT Plan；Provider 与缓存使用
  同一份 effective config。
- 保留 PR #314 的受限 SSE 解析：`store:false`、`stream:true`，只有
  `response.completed` 成功。
- 将单注册存储升级为多个独立账号注册，保留各自 client ID、host ID、身份和
  token；设置页显示当前账号并允许选择已保存账号或添加账号。
- 保持 token 仅在系统安全存储中；不得写入扩展存储、日志、测试 fixture 或任务证据。
- 安装器继续要求调用者提供准确扩展 ID。仓库没有发布固定 ID 时，不宣称一键安装
  或发布就绪。

## 不在范围

- 不引入 Codex app-server、工具调用、后台执行、云同步或新的 Provider。
- 不合入旧 Selection、Reading、NativeHost 混合分支的无关提交。
- 不新增固定 manifest key，不扩大 CSP 或 host permissions，不发布扩展或 Host。
- 不自动登录，不复用他人订阅、token 或 OAuth grant。

## 验收

- `npm run validate`。
- `npm run build:extension:wxt` 与 `npm run test:wxt:smoke`。
- Native Host 目录执行 `go test ./...`。
- ChatGPT Plan Provider、Native Messaging、effective config、Options 多账号交互和
  缓存身份回归通过。
- 实际 WXT 扩展验证安装缺失、权限不足、未登录、账号切换、取消/并发和错误恢复，
  不产生意外 Provider 请求。
- 用户本人完成真实登录后，再验证模型列表、真实推理、登出、浏览器/Host 重启与
  再次选择账号。未完成前记录为 `NOT_RUN`，不得用 mock 或历史会话代替。
- 独立代码/安全审查通过后才可同步或合并。

## 兼容与风险

- `nativeMessaging` 是新的 required permission，属于产品和安全契约变化。
- 凭据格式升级必须保留旧单账号记录的可迁移路径；不得通过清空安全存储解决迁移。
- 当前仓库没有稳定发布扩展 ID；本机安装只能显式传入当前扩展 ID，不能据此宣称
  其他安装或商店版本可用。
