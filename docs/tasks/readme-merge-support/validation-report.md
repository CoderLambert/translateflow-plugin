# README 作者与支持合并验收

候选 `d0e76ac0e8a51c314bd25caf0aba6f9bfb59c0f6`，基线 `b18a4b314a291e0985dd23432b62b42f645b7ba3`，PR #378。主 Agent 自查，无独立审核。

删除顶部重复的「作者与爱发电主页」整节，把作者身份、主页归属、支持用途、链接/二维码和付款提醒合并到底部「作者与支持」。目录中的「支持作者」同步指向新锚点；二维码仍指向已确认的 `https://afdian.com/a/transflow`，保留“在平台确认金额与支持周期后付款”“自愿、不影响功能、不含第三方 AI 额度”。

`node --test tests/release-gate.test.mjs tests/versioned-commit.test.mjs`：11/11 PASS；`git diff --check origin/main` PASS。Python 检查 README 只剩一个支持章节、两个以上主页链接、锚点存在，且所有本地文档/图片路径可解析。

diff 仅 README 与本任务记录；不改应用源码、版本、权限或安装包。按纯文档流程不构建、不启动浏览器。首次排版留下多余空行，已修正后重新冻结，未改变检查要求。

合入使用准确远端 head 保护 squash，随后核对 main tree、公开 README 全文与首行。未操作商店。本报告为主 Agent 自查。
