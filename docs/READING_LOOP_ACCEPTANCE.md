# Reading Loop A–D acceptance

任务 [244](tasks/244/task.md) 在当前 main 的同一个真实 WXT production artifact 上验证完整 Reading Loop：

```text
Read → Lookup → Understand (optional) → Remember → Return
```

任务 236、240、243 保留各阶段的准确候选、原始失败与修复证据；本文件只汇总最终产品结论。任务 244 的准确 candidate、命令、耗时、日志 hash 与 package fingerprint 以 [acceptance.json](tasks/244/acceptance.json) 为准。

## Decision

**READING_LOOP_ABCD_PASS（本地候选）**。

同一 `.output/chrome-mv3` 包通过 A–D 组合 Chromium 验收：WXT 155 files / 1,815,834 bytes；组合场景 10/10 PASS。生产包未注入词典 fixture、localhost 权限或测试脚本；E2E 先审计生产包，再复制到临时目录，只为合成站点加入受控 fixture/权限。该结论不等于商店发布，也不扩展到其它浏览器、真实付费模型质量或未授权产品范围。

## Evidence matrix

| 阶段 | 用户可观察结果 | 证据与状态 |
| --- | --- | --- |
| A — Remember | 明确查询后可选择开启本机记录；真实词义、译文和已完成问答在学习中心可搜索、按页查看、导出和删除 | PASS。`reading-loop-release-a.spec.mjs` 覆盖未授权查询→固定学习中心授权→当前卡显式保存、新查询自动保存、完整浏览器/profile 重启后离线回顾、暂停/排除/删除/清空、容量、中断、近 64 MiB 有界导出、extension-origin 物理 quota 与显式恢复重试。Local lookup/history 为零 Provider；明确翻译/AI 才使用 mock Provider。 |
| B — Return | 从历史安全打开原页面；证据唯一时定位，歧义/缺失时不猜测且历史仍可读 | PASS。`reading-handoff.spec.mjs` 与 `reading-return-location.spec.mjs` 覆盖 tab/document/expiry 绑定、唯一 Range、ambiguous/missing、DOM replacement、overlay 清理和准确历史 deep link；回访不增加 Provider 请求或 lookupCount。 |
| C — Recognize | 用户明确授权的站点再访时显示轻 marker 与本页历史；SPA/节点替换后可恢复 | PASS。`reading-page-markers.spec.mjs` 覆盖新 tab 再访、marker/list、DOM replacement、SPA 离开清理与返回恢复；未授权、权限丢失和关闭意图均 fail closed。 |
| D — Understand | Content 显示三个根动作的真实流式 partial；Stop 保留可读 partial 但不保存；重试完整后保存；学习中心可有限追问和根重生成 | PASS。`selection-assistant-ui.spec.mjs` 覆盖真实 SSE partial、Stop/interrupted/no-save、retry/complete/Reading ACK，以及学习中心从已保存 turn 发起 repository-grounded follow-up 并刷新历史。Node/React 覆盖 Understand/Analyze/Usage、最多六条历史、root-only regenerate、新 turn/branch、revision/source/graph 伪造拒绝、迟到 delta、disconnect 与 IME/Escape。 |
| 安全与隐私 | 网页/调用方不能凭 recordId、正文、URL 或图 ID 获得写权限；未完成内容不进入历史 | PASS。后台固定 top-frame/原生学习中心身份，重读真实 record/revision/source/site/turn 后派生 parent/thread/branch；prompt 不含 URL、页面标题或 anchor 前后缀。保存只接受规范化 completed artifact 与实际 IndexedDB commit ACK。无新增权限、Manifest host、DB schema、Provider 或通用消息总线。 |
| 包与升级 | 默认安装目录和显式 WXT 包来自同一构建引擎，旧注册/新字节与当前注册都能恢复 | PASS。`npm run validate` 覆盖 classic projection、旧注册窗口、strict typecheck、Node/Vitest 和默认 WXT；显式 `build:extension:wxt` 固定同一安装包。AI detail、popover、rich details 与 Reading/Quick Control 使用现有确定性 projection，未提高平台代码预算。 |

## Product-state truthfulness

- Loading、empty/no-hit、error、not-saved、paused、excluded、quota、streaming、stopping、interrupted、retry、saved 都由真实后台结果驱动。
- 发出 Stop/Cancel 不被当作撤回成功；到达不可逆事务提交点后以实际 commit 为准。
- partial、取消、Provider 失败、Port disconnect 和过期 selection 不生成 completed assistant artifact；旧 selection 的迟到帧不能覆盖新卡。
- 学习中心失败时保留旧问答；只有 `saved` ACK 才刷新历史。根 regenerate 保留旧分支，不迁移旧追问。
- 历史读取、回访和 marker 不重新请求 Provider、不重新读取词典资产，也不增加 lookupCount。

## Reproduction

从任务 244 准确候选执行 `state.json` 中的三个命令。组合 E2E 使用 Chromium 153.0.8010.12、临时 profile、合成页面、合成词典 fixture 和本地 mock Provider，不需要 API key 或私人数据。

用户路径：在普通网页选择文字并明确查询 → 打开固定学习中心并开启记录 → 返回仍有效的结果卡保存 → 再次查询自动保存 → 明确请求 AI 详解，观察 partial、Stop/no-save 与重试完整保存 → 学习中心搜索并追问 → 重启浏览器后离线查看 → 安全回到原文 → 授权站点再访 marker/本页历史 → 暂停、排除、导出或删除数据。

## Limitations

- PASS：Chrome/Chromium MV3、合成 ordinary-web-page、mock Provider、实际 WXT production artifact、真实 IndexedDB/权限/Port/浏览器重启路径。
- NOT RUN：Firefox/Safari、隐身模式、真实付费模型质量、真实私人词典、桌面原生 IME 候选窗、浏览器 UI 缩放、文件对话框最终落盘结果。
- NOT AUTHORIZED / NOT PERFORMED：Chrome Web Store 发布、版本发布、外部部署、遥测、云同步、SRS/Practice。
- npm 锁文件安装仍报告既有 1 low / 1 high audit 告警；本任务未改依赖或 lockfile。
- 主 Agent 自查不是独立人工审核；远端分支保护或人工验收若实际要求，仍必须满足。

只有任务 244 的准确候选经本地 gate、远端 expected-head 合并及最终 tree 核对后，才能把本地候选结论记录为已合入 main。商店发布保持独立授权边界。
