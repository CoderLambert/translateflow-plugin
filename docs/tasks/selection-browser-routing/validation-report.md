# 划选翻译路由修复：合入与验收证据核对

核对日期：2026-10-20（UTC）。本记录仅补正已合入修复的远端元数据，不修改功能、验收合同或原测试结果。

## 已直接核实

- PR：https://github.com/CoderLambert/translateflow-plugin/pull/362 ，2026-10-20 05:39:40 UTC 已合并。
- 最终实现候选：`907bf53e21107101107316f4df3aaa4b918471e2`。
- 实现合入提交：`bc7f467aa3059d43d72289de23f1b692b84d3c46`，版本 `0.8.37`。
- 候选与合入提交的 Git tree 相同：`0d21748d9e60ed814c945adfe3524ce214936854`。
- 两个入口已修复：禁止或缺失浏览器资格的 selection 保留普通 selection；no-hit-local 按钮仅对 lexical 且 tokenCount 为 1 的选区授权。
- 2026-10-20 05:43 UTC 独立只读静态复核未发现新增阻断；真实 MT 路由、page/subtitle、cacheOnly、旧 forceBrowser、取消及缓存拒写路径均纳入静态检查。此结论不是 GitHub APPROVED，也不是重新执行测试。
- Reading classic 投影仅对应同一按钮资格条件变更；DB4、缓存身份、计划刷新与写入围栏未修改。

## 作者报告，未在本次重新执行

PR #362 正文将以下本地结果绑定到最终候选 907bf53：完整 validate（Node 1910/1910、Vitest 65/65、静态检查、类型检查和默认构建）、WXT 构建、两目录 Chromium smoke、定向 E2E 19/19（Chromium 153.0.8010.12）、独立审查及 local-task gate 通过。先前候选的 Reading 投影失败据作者报告已补交并完成最终重验；旧失败不能继续作为当前代码失败结论。

这些是作者报告的历史结果。本次没有取得原始本地日志、日志 hash、包 fingerprint 或完整 acceptance 文件，不伪造耗时、日志路径或机器验收 PASS。最终候选的远端 acceptance.json 尚未归档。

## 验证边界与剩余归档

本次实际执行的是 GitHub 源码、PR、提交及证据边界的只读核对和元数据结构检查；程序测试、构建、浏览器及 local-task gate 均 NOT_RUN。05:43 UTC 对候选的远端 Actions、check-runs 和 statuses 查询均无记录，不代表 CI 通过；GitHub reviews 也无提交记录。

真实 Chrome 模型、离线及语义质量、完整仓库 E2E、旧包同 ID 升级和其它浏览器仍为原 PR 列明的 NOT_RUN，不扩大本次验收声明。未发布或部署。

state.status 的 blocked 仅表示原始验收证据归档尚未核实，不表示功能未修复、PR 未合并或存在新增代码阻断。按 LOCAL_WORKFLOW 规则，缺少原始证据时不能从 PR PASS 文本补造 acceptance，也不降低 validationCommands、artifactRequired 或依赖要求。

下一步由持有原始证据的执行者同步并核对最终候选的 acceptance、日志 hash、包 fingerprint 和审核记录，再将归档状态置为 completed 并重新生成 index。无需重复实现或仅为文档重跑全部测试。
