# ChatGPT Native Host 开发注册说明

## 目标

在 Options 的 ChatGPT 订阅设置中，当 Native Host 未安装、未连接或版本过旧时，明确说明当前没有公开安装包；为正在使用的 unpacked 扩展展示绑定当前扩展 ID 与版本的本地开发构建/安装命令，并给出重载扩展、重开设置和重新检测步骤。

## 范围

- 移除对尚未发布下载页的误导链接，保留现有权限请求、连接检测和恢复逻辑。
- 仅对有效 Chrome extension ID 与 `x.y.z` 版本显示命令；按 Windows x64/PowerShell 与 Linux x64/bash 显示正确的构建和安装命令，Windows 只提供 Chrome，Linux 提供 Chrome/Chromium；其它平台明确说明当前不支持。
- 提供复制成功/失败反馈；复制失败时命令仍可见，供手动复制。
- 不自动运行 shell 命令，不安装 Host，不增加权限、Provider 请求或下载行为。
- 同步已合入 PR #342 的本地 `mergeHead` 完成记录，按本地流程随本次代码同步归档。

## 验收

- Host 缺失/过旧状态不再链接到未发布的 installer；公开发布未就绪提示准确。
- 命令使用当前扩展 ID、Manifest 版本和仓库已存在的 `build:native-host:candidate` 脚本；无效输入不显示命令。
- 复制成功与失败都有可访问的用户反馈；窄屏无横向溢出。
- 本地任务合同中的 `npm run validate`、WXT build/smoke、`chatgpt-plan-nativehost` Chromium E2E、`git diff --check` 均通过，并通过 `scripts/local-task.mjs gate`。
- 浏览器测试使用隔离扩展副本和缺失 Host mock；不调用真实账号或安装系统级 Host。
