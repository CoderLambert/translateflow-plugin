# 概率性翻译中断：原因、修复与验收

实现候选：`febcc1782dc9dd4d5828bee26fdda5a54c83984c`；基线：0.8.49 / `94a437e84e87a173122bee42f774f0c351135d12`；交付版本：0.8.50。PR：[373](https://github.com/CoderLambert/translateflow-plugin/pull/373)。准确命令、耗时、日志 hash、包指纹见 [acceptance.json](acceptance.json)。

## 已确认的两个触发条件

1. **AI 助手等待模型首响应时，MV3 Worker 空闲回收。** 保持一个 Port 或等待 fetch 并不足以维持 Worker 存活。旧包在不附加 Worker 调试器的 Chromium 中，于 30,065 ms 断开端口，只有 `started`，尚无结果；相同的 35 秒慢响应在常规调试测试中可以通过，因此常规测试不足以验证这条生命周期边界。修复后最终候选在无 Worker 调试器时于 36,087 ms 正常完成，只发出一次请求。
2. **同文档、同 URL 的 History 更新被误判为离开页面。** 缓存译文已显示、另一段等待 Provider 时，调用 `history.replaceState` 更新状态即触发 Content 的无条件 `navigate` 清理。旧包重复 3 次全部返回 cancelled；开发修复包重复 3 次全部完成；最终候选浏览器回归也完成并保留缓存命中。

这两个场景是独立的确认缺陷。没有用户原始浏览器当次请求的完整时序，不能把所有概率性失败都归为同一个原因，也不把外部服务超时宣称已经消除。

## 修复边界

- [provider-lifetime.js](../../../src/background/provider-lifetime.js) 在 Provider 操作运行期间共享一个存活租约，调用现有 runtime API 保持 Worker 活跃。最后一个操作成功、失败或取消后清理计时器；不保存平台信息，不在空闲时常驻。接入统一 Provider 分发入口，覆盖文本、结构化请求和翻译，保持既有超时、重试与信号所有权。
- [translation-client.js](../../../src/content/translation-client.js) 仅跳过同文档且 URL 完全相同的 `navigate` 清理。新文档、刷新和真实路由切换继续取消旧请求结果。
- 未修改权限、消息协议、缓存身份或数据库 schema；不清空数据、不自动改 Provider、不重放已有输出。单测覆盖并发租约、取消/异常释放、无 Chrome 环境及真实导航的取消边界。

## 实际验收

| 检查 | 结果 |
| --- | --- |
| `npm run validate` | PASS：静态/i18n、2101 Node、严格 TypeScript、82 Vitest、公开安装包构建 |
| 开发包与显式 WXT 构建 | PASS |
| 实际安装包 smoke | 首次 FAIL：新工作区缺少 `.wxt/reports/asset-map.json`；显式 WXT 构建准备报告后单独重验 PASS。未重复完整 validate，原失败记录保留 |
| 四个相关 E2E 文件 | PASS：10 个用例，包含无 Worker 调试器的慢响应、同 URL 更新、Selection 停止/隔离/保存回归、翻译结构和缓存 |
| 真实 Next.js 页面 + 授权本地模型 | PASS：整页完成 17 段；并发的理解、分析、用法各两次，共 6 次完成；观测到 11 次本地端点 HTTP 200；脚本 exit 0，30,580.89 ms |
| 截图自查 | 已检查三种 AI 结果与整页译文，结果可读、未见协议残片。模型回复偏简短，不以流完成替代回答质量认证 |

真实页面验证使用临时 profile、实际 0.8.50 包和用户授权的本地模型。仅测试副本增加公开页面及本地服务访问权限。模拟慢响应与真实模型证据分开，未读取用户私人浏览内容。真实页面 AI 保存未验收，截图提示当前结果可使用但不支持保存；不将它报告为保存成功。

正式 E2E 是 `interruption-lifecycle`、`selection-assistant-stream`、`selection-assistant-ui`、`translation-reliability`。未运行完整仓库 E2E、真实 Native Host 账户或穷举长时间负载矩阵。保留原有模型超时限制。

## 证据与包

本地原始证据保存在 `docs/task-execution/local/intermittent-translation-interruption/`，不提交：`page-repeat-before.log` / `page-repeat-after.log`、`unattached-before.log`、`unattached-after-clean.log`、`real-final.log` / `real-final-binding.json`、`final-assistant-1-*.png`、`final-concurrent-page.png`。正式命令日志由 acceptance 指向。

早期诊断工具曾遇到组件 Worker 选择错误、UI 多面板 selector 不唯一，以及首次成功慢响应后的临时目录清理失败；对应日志保留，均不计为产品验收 PASS。正式用例锁定实际扩展身份，并使用可结束的 CDP 调用和浏览器清理。

公开安装包：`dist/extension/`，0.8.50；开发包：`dist/extension-dev/`，0.8.50-dev。公开包与 `.output/chrome-mv3/` 的 inventory 内容指纹一致。完整指纹见 acceptance；原有 0.8.48、0.8.49 包和上一任务未提交文档保留。
