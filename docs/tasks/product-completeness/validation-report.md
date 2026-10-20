# 授权、收藏与学习备份的本地修复验收

日期：2026-10-20。主 Agent 串行实现与自查；本报告不称为独立审核。
基线 `8c2b8ec0f65b7afc30be5065c49619b16b2872ea`，分支 `fix/product-completeness-20261020`，工作区 `translateflow-translation-method`。源码未提交，candidateHead / syncHead / mergeHead 均未冻结；不以基线 SHA 冒充修改后候选。不提交、推送、合并或发布，原 Chrome 登记安装目录未替换。保留上一任务的本地文档与完成记录。

## 已实现

| 原审核项 | 用户现在可完成的操作 | 关键实现 |
| --- | --- | --- |
| 3.1 联网同意撤回 | 全局取消勾选并保存；Popup 单独撤回本站同意，保存不翻译。重开保留未同意状态，方法不改变 | preferences DTO／保存、Options client、Popup。本站显式 null 表示拒绝，不回退全局同意。撤回保留未改变且尚未配置好的 AI 选择，不依赖其连接或权限 |
| 3.2 收藏数据正确性 | 在线、AI、本地结果传递执行语种和实际引擎／服务；查询与缓存结果一致，重启仍保留 | result-model → translation-actions；实时结果合并同一 lookup 快照元数据。词典保留原来源链。生词本改为可读的结果来源；旧 translation-v1 不猜测恢复，显示历史来源未记录 |
| 3.3 首次使用恢复 | 授权、权限或准备错误旁直接进入设置；按可见步骤确认后重试成功 | selection empty-state／popover，README 重写为两类单选、保存偏好、明确联网同意与可选资源 |
| 3.4 冷却详情 | 设置显示所选线路的剩余冷却时间；刷新仍可见，倒计时只读本地状态 | readTranslationPreferences 返回有限 health DTO；Options 本地计时清理，不定时调用 Provider |
| 3.5 AI 标识 | 点击前直接看到 AI · 理解／分析／用法 | 复用已有 i18n label 和键盘／ARIA 合同，不新增自动 AI 请求 |
| 3.6 本地备份恢复 | Reading 导出／恢复；生词本导出／恢复含 AI 笔记与复习状态；保留现有条目并报告跳过数 | 复用 Reading idb.js 事务与生词本 serialized storage owner；消息仅原可信学习中心可用，无新权限、凭据导出或云服务 |

Reading 文件 v2 新增 siteKey，因为旧 v1 在 safeReturnUrl=null 时没有足够信息恢复来源。v1 信息完整时仍可导入，缺失来源时整次拒绝并提示保留文件／从原安装重新导出。DB 与行 schema 不变，不清空用户数据。导入读取完整文件并校验 schema、来源 digest 和引用后，单个事务提交；容量或存储错误整次回滚。一次全局有界临时会话，分块、顺序、owner、导航、TTL、取消与 durable ack 均有边界。64 MiB canonical DB 上限与生词本 200 条／4 MiB 上限不变；Reading 文件预算另计有界来源元数据与 framing。

操作与协议分别同步 [README](../../../README.md) 和 [Reading 合同](../../READING_LOOP_V1.md)，不复制一套存储或后台路由。

## 实际验证

| 命令／范围 | 结果 | 证据和边界 |
| --- | --- | --- |
| npm run validate（最终完整执行） | PASS | check／i18n、1,968 Node、严格 TS、80 Vitest（14 文件）、默认 WXT build；fix-validate-final.log |
| npm run build:extension:wxt | PASS | 显式 .output/chrome-mv3；131 文件，3,062,153 bytes；默认 dist 与显式包的规范指纹相同 |
| TF_TEST_WORKERS=1 npm run test:e2e -- e2e/product-completeness.spec.mjs e2e/translation-preferences.spec.mjs e2e/selection-vocabulary-book.spec.mjs --retries=0 | 初次 FAIL，已定向解决 | 14 PASS / 1 FAIL / 1 SKIP。旧词典用例未显式选择新版 dictionary，走了未授权在线。只修 fixture，保留词典命中、零网络、收藏、复习和删除断言 |
| TF_TEST_WORKERS=1 npm run test:e2e -- e2e/selection-vocabulary-book.spec.mjs --retries=0 | PASS | 原失败用例 1 PASS。生产输入未变，不重跑其它有效 PASS |
| TF_TEST_WORKERS=1 npm run test:e2e -- e2e/product-completeness.spec.mjs --grep 'Reading staged imports' --retries=0 | PASS | 新增真实 native sender／跨文档／取消／导航／重新开始流程 1 PASS |
| TF_TEST_WORKERS=1 npm run test:e2e -- e2e/reading-storage.spec.mjs --grep 'Production Reading restore\|Production export\|Native Unicode stream' --retries=0 | PASS | 3 PASS：生产恢复在真实 IDB 9999 条上尝试再加 2 条，第二条超额时第一条也回滚，meta／行计数保持原值；另含 >1 MiB Unicode 分块与导出重试／finish |
| TF_TEST_WORKERS=1 npm run test:e2e -- e2e/reading-storage.spec.mjs --grep 'Native near-64MiB' --retries=0 | PASS | 1 PASS：真实 canonical 数据接近 64 MiB 的导出、超额拒绝与清理。此项为明确标注的直接源码 IDB probe，不冒充 UI 全容量导入 |
| git diff --check；最终三个变更 E2E 文件 node --check | PASS | 纯 fixture 与新增验收变化后仅重验相关路径，不重建未变化的生产包 |

最终覆盖的独立 Chromium 场景合计 **20 PASS / 1 SKIP**，使用真实 Chromium/MV3、临时 profile、合成词典与 mock 响应。新问题的六个用户场景全部通过，新增导入会话隔离另 1 场景通过。拒绝联网和设置编辑零请求、目标日语与服务来源、缓存命中、AI 可见标签、冷却、备份重启、损坏文件、重复导入、容量原子回滚、取消和导航均有对应证据。

开发过程的失败保留：第一次 validate 有一个旧 inherit 断言失败；已修为缺省 consent 不额外写拒绝，定向重验通过，随后最终 validate 全部通过。Reading 首轮二次导入被已完成会话占用的问题已修；单测与浏览器重复导入均通过。不覆盖或改写初次失败日志。

## 包与输入绑定

- 规范包指纹（scripts/local-task.mjs fingerprint）：`e963461d025c8c985b7e3d38df94c3150f6eb8b032558f323ae6ad8da4b3d7a1`；dist/extension 与 .output/chrome-mv3 相同。
- E2E inventory JSON 指纹：`875833ed714745505a49c3b548b59d78ad86aa86c147812b95ccd28f4d469eec`。与上一项算法不同，不混作同一指纹。
- 最终文件清单／输入摘要见本地 `docs/task-execution/local/product-completeness/verified-inputs.json`；原始日志与 hash 见 fix-evidence-logs.json，截图／trace 保留在 test-results 对应 run 目录。最终 validate 之后只增加／修正 E2E fixture 与归档文档，相关用例已独立执行；生产源码与包未再改动。
- 两份生成的 classic Reading 源码均通过既有脚本重建，不手工修改产物。构建仍有既有 platform advisory budget 提示；无新的 required permissions、隐藏页面或生产资源越界。

## 主 Agent 自查与剩余限制

对照 diff 和调用链复核：全局／本站同意独立，拒绝不继承许可；执行保护保留。查询与收藏复用已固定的结果配置，缓存不猜来源；旧数据不擅自纠正。导入只由原存储 owner 写入，不更改 recording consent 或 exclusions，容量和索引与记录同事务；完成提交不伪称取消。失效会话和一次性暂存有界，关闭／导航取消，上传或 AI 调用不在恢复链内。React effect／计时器清理、状态更新、键盘和窄屏暗色沿用现有组件，已查看合成截图。

真实 Chrome 模型探测为 detector=unavailable、translator=downloadable，真实推理场景 SKIP；没有下载模型或用 mock 充当真实模型成功。真实付费 AI、微软／腾讯公网、双网络、私有目标词典完整媒体、真实 YouTube 与原 Chrome 实例重载本轮均 NOT VERIFIED／NOT RUN；这些原审核中的真实环境验收缺口仍保留。原安装没有自动更新，本轮交付为可检查的本地源码与构建包。
