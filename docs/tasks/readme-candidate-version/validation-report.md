# README 最新候选版本展示验收

候选e0b13de7e07f0cdeac8b2be4433dbc605b9ee766，基线311b783e2916e62e5954651c948b5ad70324652a，PR #376。主Agent自查，未委派模型审核。

用户要求不再让GitHub首页最醒目标题停留在0.8.50。README顶部改为「TranslateFlow v0.8.64（开发候选）」，版本表和说明同步0.8.64，列出本地已构建候选的浮窗升级修复；main源码仍明确记为0.8.50，没有改写Manifest/package或冒充功能合入。

旧版本校验把README第一行等同于源码版本，无法表达用户要求的独立候选标题。现在共享检查允许两种明确合同：普通标题与源码一致；或显式开发候选标题、匹配候选行、准确main源码行同时存在。缺行、未标记错配、错误源码版本均拒绝。版本准备脚本接受候选后缀并改写成实际待构建标题，原patch递增、暂存快照与失败不改写行为不变。

已执行local-task绑定的`node --test tests/versioned-commit.test.mjs tests/release-gate.test.mjs`：11/11 PASS。包含正确候选、错误源码、错误候选行、未标记错配、缺说明、候选标题版本准备，以及全部原快照/并发/版本行为。`git diff --check origin/main` PASS，原始日志/hash和实际耗时由acceptance保存。

自查diff仅README、版本准备/检查和测试、本任务记录；生产源码、应用版本、权限和安装包保持main基线。没有运行旧main构建或全量测试。0.8.64修复包在本地content-ui-reload任务验收，不能以本PR宣称已发布修复代码或商店更新。

按准确远端head保护squash合入，之后核对main tree与同步tree、公开README全文和首行。主Agent自查不标作独立审核。
