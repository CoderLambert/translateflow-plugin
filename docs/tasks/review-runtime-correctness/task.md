# 修复审核发现的服务路由、取消和词汇本同步问题

基线：用户选定的当前 checkout `5f8bac7453f475c551a9cb4b9f07ef03d59a436c`。
发布集成基线：`origin/main@6e3e994d1fdf79780c7954b90118255febbde913`；工作分支 `fix/review-runtime-main`。用户追加授权提交推送、合入 main 并发版，发布候选以此主线上的最小修复为准。

## 范围与验收

- 已完成迁移的空连接列表不恢复旧连接/凭据、不改变默认服务；首次安装和旧配置升级仍正确迁移。
- 删除保护覆盖旧站点 provider 引用；缺失引用明确报错，不切换到另一服务。
- 连接迁移、并发编辑、删除和默认选择串行执行；竞争 revision 只能成功一个，独立连接的修改均保留。
- 主线既有字幕 request coordinator 已覆盖配置、缓存和 Provider 阶段取消，保留并验证；不移植旧分支的第二套协调器。
- Reading 迟到回执只更新匹配词条/回答的引用，不能恢复已删除词条或覆盖新笔记。

不清理用户数据库、缓存、词典或旧版回滚配置；不扩大权限或增加 Provider。`siteProfiles` 广播收窄建议不在本次范围。

## 验证

审核阶段先将复现写成失败回归，开发阶段执行受影响 Node 测试、源码检查、WXT 默认包构建及临时 Chromium/MV3 场景。按追加的发布授权，PR 后对冻结候选执行一次 `npm run validate` 和连接配置、字幕、生词本持久化的定向 E2E；后续只重验失败项和变化依赖。
主 Agent 自查真实 diff，归档 validation-report.md 与 acceptance.json，通过本地 gate 后按准确远端 head squash 合入 main。发布 0.8.70，校验本地 zip、GitHub Release 与国内镜像的 SHA-256；不包含商店发布或真实付费 Provider 验收。

完整验收在 `d1d6a73` 执行后，Node 2182 项中仅 Reading classic 投影过期一项失败。使用唯一生成脚本更新 `src/content/reading-record.js`；该投影不进入 WXT 生产模块图。按证据复用规则，后续 validationCommands 拆分为源码检查、失败投影测试、未执行的类型/Vitest/构建，以及原定 E2E。原 2181 项 PASS 仍绑定 d1d6a73，原完整命令保持 FAIL，记录在 validation-report.md；不把分段补验冒称重新执行完整命令。
