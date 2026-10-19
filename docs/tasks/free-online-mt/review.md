# MT01 / MT02 自查与证据边界

主体：本次实现主 Agent 自查，不是独立模型审核。基线 main@961a375。

已修复：MT 不解析坏的 AI 凭据；快照缺失不进入付费路径；MT 源语言与代码保护身份独立缓存；代码/标记不上传；腾讯检查业务状态；响应正文纳入超时；导航取消按真实 tab 消费者隔离；站点保存和读取沿用现有 normalizeOrigin（包括端口规则）。

新增浏览器测试实际使用生产 WXT 字节，只有两个固定服务的网络传输为合成响应。覆盖网页/划词/Reading 保存、缓存恢复和切换、无 AI 的 Popup 入口、设置确认、取消和坏结果。无真实用户页面、Key、词典或 Cookie。

开发期间全量 Node 1,713 项、定向旧功能 48 项、新增 MT 23 项、修复定向 19 项、严格类型、Vitest 53 项及 MT MV3 6 项已通过。完整 npm run validate 的首次调用因执行环境时限中断，且曾暴露三个已修复的集成断言；不能将该调用标为 PASS。最后的 staged build 和候选级测试另行归档，开发数字不冒充候选 SHA 绑定结果。

未验证：真实供应商在用户网络中的长期可用性、Google、B站、免费字幕、商店发布、全量真实词典兼容。本次不合并，不宣称本地 gate 或发布验收完成。原始日志/合成截图位于被忽略的 docs/task-execution/local/free-online-mt/；PR 仅交付源码和简短事实，不上传完整日志。

本地任务索引生成在既有 `docs/tasks/browser-native-language/` 缺少 `state.json` 处失败（该目录在基线已存在）。本次保留原索引，不补造其它任务状态、不修改工作流脚本；local-task gate 未通过/未完成，不据此自动合并。该问题不阻断代码分支备份或用户试用包。

## 2026-10-19 最新 DB4/main 集成复审（未达到最终候选验收）

- 本任务不是旧 DB3 开发分支：原 #342 已在保留所有原提交历史的前提下，将 main `1ddae0504a7478480253723d9f5fb43d13b77b88` 纳入 PR 分支，并逐项移植免费 MT 的有效功能；GitHub `mergeable=true`、`mergeable_state=clean`（仅说明无文本冲突）。`src/background/cache-db.js` 保持 #345 唯一稳定门面、DB4 `entries/epochs`、record envelope v1、请求隔离/写入 token，无旧 DB3 parser、hash 或迁移；不恢复 #346 移除的内置词典。
- 既有 Selection `snapshot.text` 不含原始 DOM 标签/保护信息。现有免费 MT 路由 fail-closed：code/kbd/pre/samp 或无法验证的选区不再发送外部；新增 `tests/machine-translation-selection-protection.test.mjs` 覆盖代码内起始、跨标签和未知 range；非 MT 仍保持旧行为。
- `src/background/providers/machine-translation.js` 现在只有明确 `format: "tf-markers"` 的输入才解释控制标记；普通选区里的字面 `⟦TF:0:S⟧` 一律拒绝而非误解结构/上传。超长文本按原生 `Intl.Segmenter` 字素分割，保护 ZWJ emoji。
- 连接检查是用户点击固定公开测试短句，`src/options/machine-translation-client.ts` 发送 `consent`；`src/background/machine-translation-settings.js` 再次检查确认和特定 origin permission。添加不经同意/无权限的零外发负例。
- 实际源码在独立 V8 模拟中校验了 Rich marker/code 本地保留、纯文字符号 fail-closed、emoji 分界及后台拒绝无同意/无权限，结果 PASS；该检查**不属于仓库 Node24/npm validate 或编译 MV3 测试**。GitHub 当前 head 可能随用户其他提交变化；候选与测试必须重新绑定最新 SHA。
- 保留原 PR 中历史 0.8.14 构建/Mock E2E/微软单次成功与腾讯网络失败记录，但**这些均不是当前 0.8.29/DB4 候选的实测**。Node24 全仓、真实 WXT 安装包、浏览器同 ID 升级、真实微软/腾讯、本机最终人工验收均为 **NOT RUN 或待验收**。
- 下一步只运行当前模块的 MT Node、选区保护、相关 Popup/Options/MV3 和 DB4 回归；定向通过后在冻结 candidateHead 上集中执行一次 `npm run validate` 和 WXT 双目录构建/Smoke。无需因一处小改动重复完整 CI，也不得用合成响应宣告真实 Tencent 可用。

## 2026-10-19 URL 划词安全补丁（待正式 Node24/Chromium 验证）

- 免费 MT 增加链接 DOM (a[href]/area[href])、跨链接选区、可见 URL/域名/IP、选区文字变化及已断开 Range 的拒绝条件；均在 TRANSLATE_BATCH 前处理，不改变现有 AI/本地路线。
- 新增零外发的负例测试及普通文字成功路径回归；模拟行为验证不等于 Node24 全量测试或真实浏览器验证。
- 已修正 task.md 中遗留的“再次清空旧译文缓存”条件：不得破坏 #345 的 DB4 现有数据。
- 当前准确候选尚无 Node24/npm validate、WXT/Chromium 运行证据，Microsoft/Tencent 真实服务及用户人工验收均未完成。状态继续 working/Draft，不合并。

## 2026-10-19 Node24 真实验证迭代 1

- 工作流：https://github.com/CoderLambert/translateflow-plugin/actions/runs/39200177197 ，HEAD `5eef0c4ab127c89a610d946691738578e10baef3`，GitHub Ubuntu / Node v24.21.0 / npm v11.19.0。
- MT/Selection/DB4 相关 6 个 Node 文件的定向测试 **114 PASS / 0 FAIL**（运行日志有逐项证据）。
- `npm run validate` **FAIL** 于 `npm run check`：`src/content/quick-control-view.js` 因 MT UI 集成增加至门禁 420 行以上；后续 Node 全量/typecheck/Vitest/WXT/Chromium 均未执行，不能标为失败或通过。
- 修复该单一门禁：将 MT preset 状态改为 `machineMode` 分支，固定 machine mode 时选择 `inherit` 并继续禁用 AI preset 选择；代码不改变 Quick Control 位置、拖动或扩展权限。复核脚本行数限制后重试同一候选的连续 gate（第 2 轮）。
