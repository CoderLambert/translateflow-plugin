# 配置驱动自动验收与 HTML 报告交付记录

2026-10-20，主 Agent 实现和自查，无独立模型审核。基线 HEAD / 已刷新 origin/main 为 `8c2b8ec0f65b7afc30be5065c49619b16b2872ea`，分支 `fix/product-completeness-20261020`，工作区 `translateflow-translation-method`。保留原有修改，全部未提交，candidateHead / mergeHead 为 null，未推送、合并或主动替换用户安装目录。

## 用户现在可以做什么

在本工作区运行 `node scripts/run-configured-automation.mjs docs/task-execution/local/automation-config.json`。配置、凭据和实际测试 profile 均保存在 Git 忽略的本地目录，密钥不进入本文、报告或普通回归进程。该命令自动核对/构建当前安装包、执行真实资源验收、运行 validate 与完整 Chromium 回归、补跑因依赖失败未执行的串行专项、生成 HTML/JSON/逐步截图与脱敏日志。不需要重复手动点设置、导入或翻译。

本轮真实服务限定为用户授权的 DeepSeek / deepseek-flash，最多 20 次物理请求；持久账本在转发前同步落盘，内核锁保护同一 campaign，重复执行不清零。实际使用 **12/20 次**，含失败自检；可能的自动重试也受同一上限约束。真实输出经 loopback 限额转发，上游为官方地址；不把该证据说成浏览器直连官方 TLS 验收。实际请求未使用 mock 响应，没有上传词典。

## 真实资源结果

- PASS：真实 Next.js Learn 页面导航、标题/单词 AI 翻译、重复查词缓存零新增请求、明确点击 AI 理解、收藏及学习中心来源核对、Popup 唯一按钮触发及等待 **44/44 完成**、重启后的连接持久化。
- PASS：用户指定 Oxford MDX 与两个实际 MDD 附件经原产品流程导入/恢复；后台资源计数为 2，重载后保留，在真实正文查询 building 且零新增 AI 请求。复用已导入的 MDX，避免第二次运行卡在重复导入确认；私有词典文件、正文及 JS 不进入仓库/报告。此结果不代表全部词条、声音、图片已穷尽验收。
- BLOCKED：真实 Chromium 152 的 Translator 为 downloadable，LanguageDetector 为 unavailable；曾点击准备但未完成自检。后续允许组件更新并使用有窗口隔离浏览器再次探测，仍不可用。没有注入合成 API 冒充真实模型成功。
- 历史失败保留：一次真实连接请求 HTTP 200，但模型未严格返回 OK，产品自检失败；前后其它连接/翻译成功。执行器初版还曾从无权读取生词本的 Options 调用列表、重复导入已存在的 MDX，以及用过窄的完成文案断言；均保留原失败并由正确学习中心、附件恢复、44/44 完成态定向复验修正，没有放宽产品权限。

## 实际命令与结果

| 检查 | 结果 |
| --- | --- |
| 统一入口首轮真实验收及 `npm run validate` | 完整 validate PASS：1,976 Node、14 文件/80 Vitest、严格 TypeScript、静态/i18n 与标准包构建；后续自动化工具修改由下列定向检查补验，不改写为另一条全量命令 |
| `npm run test:e2e -- --retries=0 --trace=on`，workers=2 | 原始 241 PASS / 16 FAIL / 7 SKIP / 24 DID NOT RUN，保留全部失败与 trace |
| 15 个受影响 spec 定向复验 | 首轮 37 PASS / 2 FAIL / 6 DID NOT RUN；修正剩余 fixture/短语文案后，12 PASS / 1 FAIL；最终 Reading 单例 1 PASS |
| `npm run test:e2e -- --special --retries=0 --trace=on`，worker=1 | 补跑 9 PASS / 4 FAIL / 5 SKIP；显式偏好和旧入口文案修正后，受影响的 7 个专项全部 PASS |
| 最终 `npm test -- tests/configured-automation.test.mjs` | 5 PASS：持久 20 次上限、显式布尔授权与目标限制、生产输入新鲜度、HTML/凭据安全、超限前拒绝上游 |
| 最终静态检查与脚本语法、`git diff --check` | PASS；没有修改生产功能输入，不为测试维护重复构建未变化的包 |
| 零费用入口 smoke（`--regression-only --live-only`） | PASS：实际加载配置、内核锁、输入/包指纹复用及退出；未用真实密钥、未调用 Provider，不能当功能回归 PASS |
| HTML 浏览器验收 | PASS：1440×1000、390×844 暗色、无横向溢出、键盘结果筛选、截图轨迹加载、无 pageerror；另有当前报告预览图 |

**综合后续定向复验，288 个浏览器场景为 275 PASS、12 SKIP、1 FAIL。** 这是基线加复验的去重结果，不是一条零失败全量运行。唯一仍失败的是公开 ECDICT 固定上游下载网络错误；独立获取同一锁定源也超时，没有用 Oxford 文件、手写词条或放宽 source lock 伪造通过。SKIP 涉及缺少旧升级包、专用真实语料和模型等条件，不等于验收成功。

## 本轮修正的旧回归假设

来源标题增加“词典释义”；保存方式与同意上传分离；缺失/损坏/不兼容词典及无命中的恢复改用显式临时方式选择；Popup 按真实活动阅读页重新打开；MDX/MDD 等待最终完成而非中间“正在完成”；StarDict 包含 refresh 阶段；Reading 自建 fixture 显式选择 dictionary / ai；Reading 临时打包解析 p-limit/p-retry，并核对当前已有 DNR 权限；语言切换按短语显示“翻译选段”。修改均在测试/fixture，保留真实本地查询、零 Provider、取消、持久化、资源、安全及请求次数断言。

## 绑定与交付位置

标准包与 WXT 包规范 fingerprint 均为 `6b2f814bb74a97870f6753d50f008657799ea7f79b58c810243f05f3c0567b2e`；E2E inventory treeSha256 为 `408eb67cb8caf516d4b501d808f975cb9dbbcfb1f420e764465ac8c4c8dab093`，131 文件/3,062,299 bytes。当前生产/构建输入 stamp 为 `1c47a2df6844cb7cfd3b9b5de3e552cf05f69dd30fe7b7d235631b2398cb3fe6`。本轮只新增工具、测试维护和文档；上述生产输入及包未变。

HTML 总览与 25 个当前验收步骤、6 条历史记录、328 次用例执行的 17,584 帧实际截图、原始日志 hash、证据 JSON 和桌面/窄屏预览，位于 Git 忽略的 `docs/task-execution/local/automation-report-1792500850/`。精确密钥扫描确认 tracked/unignored 文件和交付文本不含真实密钥。报告目录不包含私密配置、词典文件或浏览器 profile；这些资源仍在独立私密 campaign 目录，供后续配置驱动测试复用。

使用和边界见 [AUTOMATED_ACCEPTANCE](../../AUTOMATED_ACCEPTANCE.md)。仅本地交付，不宣称真实模型推理、全部词典媒体、所有站点、完整升级认证或商店发布通过。
