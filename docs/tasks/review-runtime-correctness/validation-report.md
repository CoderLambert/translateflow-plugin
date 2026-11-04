# 审核修复与验收记录

## 基线与发现

最初只读审核：`5f8bac7453f475c551a9cb4b9f07ef03d59a436c`（用户当时选择的 checkout）。发布移植基线：`6e3e994d1fdf79780c7954b90118255febbde913`（0.8.69）。版本 0.8.70。

| 发现 | 触发条件与影响 | 处理 |
| --- | --- | --- |
| 空连接表重新迁移 | 已完成迁移后删除全部连接，旧凭据重新导入并重置服务 | 迁移版本标记区分未迁移与用户已清空；默认值初始化先完成迁移 |
| 旧站点连接引用失效 | 旧 provider 引用未参与删除保护，缺失后可能选择默认服务 | 保留旧引用语义，删除保护和明确 CONNECTION_MISSING |
| 并发整表覆盖 | 两个设置操作同时修改连接/defaultService，后写覆盖先写 | 统一后台队列，在同一事务顺序校验 revision 并写入 |
| 早期字幕取消失效 | 审核旧基线在配置/缓存等待期间取消，仍可能进入 Provider | 最新 main 已有协调器，保留并通过既有 lifecycle 回归 |
| Reading 回执恢复或覆盖笔记 | 用户在其他页面删除词条/更新回答后，旧浮层收到迟到 ACK | 新消息只更新 entryId/action/turnId 对应的现存引用，不新增/覆盖正文 |

## 开发验证

82 项定向 Node PASS；源码检查和 WXT 0.8.70 公共包构建 PASS；新增 Chromium/MV3 2 项 PASS。均为候选提交前工作区证据，不作为新的 SHA 上执行的证明。

## 首次冻结候选

- candidateHead：`d1d6a73dd4cae035c227836f5d34bb717ffa4d2c`。
- `npm run validate`：FAIL，退出码 1，耗时 46053.864103 ms。源码/架构及 1599 个语言键检查 PASS；Node 2182 项中 2181 PASS、1 FAIL；后续类型/Vitest/构建未在该命令中执行。
- 唯一失败：`tests/reading-content-classic.test.mjs` 提示 `src/content/reading-record.js` 过期。修改持久化 owner 后遗漏同步兼容投影；已运行 `node scripts/reading-content-classic.mjs` 重新生成，不手改生成内容。
- 原日志：`docs/task-execution/local/review-runtime-correctness/540aaef6-0201-4b16-ae0f-959951f9df1f.log`；SHA-256 `0bc98a8514ac76cea7fe84c292799144972bf8d0a7d7e571be885596d043de28`。本地保留，不上传原始日志。
- 复用依据：后续源码 diff 仅更新上述派生文件；WXT 不消费该投影，测试消费者仅 `reading-content-classic.test.mjs`。其他 2181 项测试、业务源码与依赖未变。新候选保留原 FAIL，定向重验投影，并完成未运行的验证环节。

## 最终候选

待最终候选冻结后写入真实检查及产物证据。

## 自查与边界

主 Agent 对照实际 diff 和调用链自查，不标为独立审核。连接操作复用单一后台 owner；新消息的常量、Content 客户端、后台分发、sender 校验及严格输入合同一致；参考同步只更新已存在且身份匹配的笔记。未清空用户数据、修改 schema、扩大权限或加入隐式 Provider 调用。

浏览器场景为临时 Chromium profile、合成数据和 mock Provider。真实付费 Provider、私人词典、真实 YouTube 播放、Chrome Web Store 发布均 NOT RUN，不由本次 mock 验收替代。
