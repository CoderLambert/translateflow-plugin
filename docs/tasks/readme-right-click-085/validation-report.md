# README 右键入口与 0.8.65 版本同步验收

候选 `c0265c65bf5147c12eae5f06fbeeaec29b95e877`，基线 `ffe32c13569ced81fda355441da4beca6bfec481`，PR #377。主 Agent 自查，无独立审核。

README 顶部由 0.8.64 候选改为 0.8.65 候选；版本表候选行加入右键翻译入口，main 源码 0.8.50 行保持不变；开始使用第 2 步说明可在网页任意位置右键「翻译或更新当前页面」，沿用已保存方式，首次访问新站点仍请求站点权限；隐私段落说明右键只由用户点击触发、不读取选中文字。

初次候选错误地把本地开发分支 README 覆盖到 main 文档上，丢失版本表并不过版本合同；`node --test tests/release-gate.test.mjs tests/versioned-commit.test.mjs` 正确 FAIL。改为从 origin/main 的 README 精确增补后重冻，11/11 PASS，未放宽检查。首次失败 acceptance 未提交。

最终 `git diff --check origin/main` PASS；diff 仅 README 与本任务记录，不改变应用源码、Manifest、package、权限或安装包。按纯文档流程未构建、未启动浏览器；右键功能与真实包验证在本地 `context-menu-translate-page` 任务，不能由本 PR 声称为已发布。

合入使用准确远端 head 保护 squash；之后核对 main tree 与同步 tree、公开 README 首行/全文。未操作商店。本报告为主 Agent 自查。
