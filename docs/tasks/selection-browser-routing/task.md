# 划选翻译浏览器资格路由修复

修复当前 selection 请求 false/缺失允许标记仍映射 selection-word，以及 no-hit-local 按钮无条件放行的问题。仅 lexical 且 tokenCount === 1 的入口授予允许标记；保持普通 selection 的显式 MT、AI、page/subtitle、单词显式 fallback、取消与旧结果围栏。

不改 DB4、schema、缓存键、引擎指纹、缓存计划刷新、权限、词典或 Provider 系统。不调用真实服务，不发布。

验收：先复现 Node 与真实 MV3 UI 失败，再运行相关 Node 测试、受影响浏览器/MT/划词取消 E2E、完整 validate 和两目录 WXT smoke；独立审查最终候选。使用 mock、合成 fixture、临时 profile，不下载真实模型。准确远端 head 与最新 main 满足保护和本地 gate 后 squash 合并；保留其它工作区。

本次用户明确要求每次 commit 升版本并编译；虽然 main 的 hook 仅检查 diff，使用既有 commit:prepare 显式满足用户约定，不修改 hook。
