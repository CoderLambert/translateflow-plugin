# ChatGPT 本地组件商店分发

## 目标

让 Chrome Web Store 用户在不安装本地组件时继续使用 TranslateFlow；选择 ChatGPT 订阅连接后，通过明确授权、下载、安装、版本检查和恢复入口完成 Native Messaging 配置。

## 范围

- 将 `nativeMessaging` 改为按需授权，并保持 Background 是唯一连接 owner。
- 在握手中报告和校验 Host 版本，区分未安装、需更新、协议错误和凭据错误。
- Options 提供授权、官方发布页、重新检测和既有重启入口。
- 提供绑定准确商店扩展 ID 与 Host 版本的 Windows/Linux amd64 候选构建，并生成 SHA-256 清单。

## 验收

- 未授权不会打开 Native Messaging port，也不影响其他 Provider。
- 授权拒绝、Host 缺失和 Host 过旧均有独立可恢复状态。
- 安装或升级后可重新检测；推理或登录期间仍禁止重启。
- 候选构建缺少准确扩展 ID或 `x.y.z` Host 版本时失败；产物明确标为未签名、不可发布。
- `npm run validate`、WXT build/smoke、相关 Chromium E2E、`go test -race ./...` 通过。

## 发布边界

- 正式商店 ID、Windows 代码签名证书、Linux 发布签名和真实干净系统验收属于外部发布输入；缺失时不得把候选包标为可发布。
- 不由扩展下载或执行程序，不实现静默更新，不新增任意命令、文件或 URL 协议。
- macOS、ARM64、MSI/deb/rpm 和自动更新器不在本次范围。
