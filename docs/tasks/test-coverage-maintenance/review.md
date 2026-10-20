# 新功能测试维护程度与本地修正记录

本文件保留修复前的审核与失败证据。用户追加授权后的运行时修复、当前包指纹及复验结果见[后续修复验收](validation-report.md)。

日期：2026-10-20；主 Agent 代码核对与定向 Chromium 验证，不是独立审核。基线 HEAD / 新刷新 origin/main 均为 `8c2b8ec0f65b7afc30be5065c49619b16b2872ea`。沿用 `translateflow-translation-method` 工作区与分支 `fix/product-completeness-20261020`，保留上一轮全部未提交修改。本轮只改测试、fixture 和测试文档，不提交、不推送，不改产品代码或安装目录。

## 判断

**新增功能的专项用例跟进较及时，旧回归消费者和测试的完成性断言没有完全同步。不能据此说整个产品已全量验收。**

仓库有 202 个 Node 测试入口、14 个 Vitest 文件、84 个 Playwright spec 入口。当前实际 Playwright discovery 为 284 场景／85 个注册来源文件（包含从 helper 注册的测试），不代表全部已执行。本轮没有统计或承诺代码覆盖百分比。

上一轮 `validate` 的 1,968 Node / 80 Vitest 与构建 PASS 有真实日志，但 `validate` 不包含 E2E；其浏览器验收针对新变化选测了 20 个成功场景与 1 个模型 SKIP。全局路由变更还影响旧 native、Selection/Reading 和 cache 消费者；那些路径不能由新专项的 PASS 替代。本轮扩展到这些消费者后复现了旧用例和运行时的不同问题。

## 已确认并修正的测试问题

| 位置 | 原问题 | 本轮修改与实际结果 |
| --- | --- | --- |
| [native-model-preparation](../../../e2e/native-model-preparation.spec.mjs) | 只设置旧 browserTranslationEnabled 就期待单词走本地；仍查找已移除的关闭开关；注释还误称跨用例共用 profile | 显式选择 browser-local；验证资源准备／翻译偏好独立，切换方式保留已准备资源，改变校验语言对清除旧验证。6 场景 PASS，保留真实 native Window 计时、激活与共享端口断言 |
| [selection-reading-record](../../../e2e/selection-reading-record.spec.mjs) | 自建 fixture 只开 dictionaryEnabled，没有指定新版单词方式，不能继续证明本地查询→Reading | 显式 dictionary / ai；真实记录、同词位置、缓存、AI、取消、存储失败与 Rich 追加 7 场景 PASS |
| [translateflow](../../../e2e/translateflow.spec.mjs) | 短语仍被假定先查词典；无命中后仍查找旧“普通翻译”按钮；来源标签仍用旧文案 | 短语按 textMethod；通过可见类型纠正和临时方式切换查词；来源标签准确且保留 pack ID。17 场景经原运行与定向修复后通过；保留词典／AI 结果、零请求／准确调用次数、缓存隔离、键盘和窄屏断言 |
| 同上自动缓存恢复 | 4 处 100–800 ms 固定等待，负向零请求断言可能早于真正处理 | 改为只读 ISOLATED runtime 空闲／observer 状态；miss 先观察到真实 CACHE_LOOKUP，再等处理完成。两个缓存恢复场景 PASS，未改 Provider 次数断言 |
| [product-completeness](../../../e2e/product-completeness.spec.mjs) | 冷却测试标题说“到期”，实际上只检查重载；本站撤回只检查保存字段，没有真正尝试执行 | 使用浏览器本地时钟推进 125 秒验证冷却消失且零定时联网；撤回后真实 TRANSLATE_BATCH 返回 MT_CONSENT、零上传，单词仍按全局已授权方式成功。2 场景 PASS |
| [reading-import](../../../tests/reading-import.test.mjs) | v1 正例只经过纯 validator；缺来源负例意外夹带 v2 siteKey，可能因多余字段报错而“通过” | 补真实 registry v1 恢复正例；缺来源数据保持合法 v1 结构，明确断言 UNSUPPORTED_VERSION 和零写入。4 Node 场景 PASS |
| optional-dictionary-runtime / auto-context-invalidated / quick-control-position / selection-rich-ai | `test.use({lexiconPacks:"missing"})` 已无对应 fixture 参数，容易误以为主动改变了词典状态 | 移除无作用选项，沿用真实空 profile 或显式合成用户词典，四个消费者共 7 场景 PASS |
| [cache-system-mv3](../../../e2e/cache-system-mv3.spec.mjs) | 错误断言只显示 true/false，不利于区分迁移、权限、存储或快照问题 | 保留首次成功断言，附最小错误码／第二次诊断，不替换首次结果。3 个原失败仍 FAIL，详见下一节；其余 3 场景 PASS |

没有删除安全断言、放宽超时、开启重试或把失败标成跳过。没有把全部单元测试换成 E2E，也没有为获取“更好看的数量”增加镜像实现的用例。

## 真实保留的失败：缓存首次读取与初始化迁移竞争

三个现有生产包测试失败：当前 entry 格式／ID 重映射、失效写入隔离、结构化坏结果拒绝。它们都在第一条 CACHE_LOOKUP 就得到 `CONFIG_SNAPSHOT_EXPIRED`，尚未进入各自核心断言，不能算已验证缓存格式或结构保护，也不能直接说这些核心机制坏了。

最小复现是共享 fixture reset 写入尚待迁移的 legacy Provider 设置后立即调用 CACHE_LOOKUP；不打开网页或预热配置。诊断实测：

```json
{"initial":{"ok":false,"errorCode":"CONFIG_SNAPSHOT_EXPIRED"},"second":{"ok":true,"errorCode":""},"providerCalls":0}
```

调用链证据：[createEffectiveConfigSnapshot](../../../src/background/effective-config-snapshots.js:10) 在 await translationConfig 前捕获 revision；[getConfig](../../../src/background/config.js:43) 在期间执行 Provider 初始化；[storage.onChanged](../../../src/background/index.js:44) 对 providerConnections / credentials / defaultService 写入使快照失效。现象已证实；“初始化迁移与真实用户配置更改共用失效机制”是与代码一致的根因分析。并非所有正常网页操作都复现：部分正常入口先初始化配置，因此本报告限定为接口冷启动路径。

应单独修正初始化与快照的顺序，并保留并发偏好改变仍必须失效的保护。**不能简单移走 revision 检查、预热 fixture 或给 read() 加重试来宣称测试通过。** 本轮用户要求为测试审核与维护，生产代码未改；该回归仍是后续修复项。

## 功能→现有证据与缺口

| 功能 | 已有对应测试 | 本轮结论／剩余缺口 |
| --- | --- | --- |
| 两类唯一选择、网站覆盖、默认迁移 | translation-preferences Node / E2E、translation-method、Options Vitest | 路由矩阵、资源变化、临时切换已有专项；旧消费者本轮补同步。跨模块改动需按消费者选测，不能只跑新 spec |
| 联网同意、权限、冷却 | machine-translation、product-completeness、Options / Popup Vitest | 本轮把本站真实执行保护和冷却到期补上；公网、双网络与真实限流仍需独立实测 |
| 页面、缓存、增量恢复 | cache-system 系列、translateflow、auto-context-invalidated | 核心页面与自动恢复有实际 MV3 证据；冷启动 3 个失败保留，不能宣称全套浏览器缓存通过 |
| 划词、富文本、AI、上下文、取消 | selection-release-gate、selection-rich-ai、selection-reading-record、rich-mdict 系列 | 本地／AI 显式调用、旧结果取消和 Reading 链有生产包路径；静态 DOM／CSS regex 只是结构保护，不能代替这些行为测试 |
| 收藏来源与语种 | selection-result-model、product-completeness、vocabulary-book | 新卡片纯模型矩阵已有 AI/在线/本地 × 两个目标语种；实际浏览器收藏／缓存主要覆盖在线日语，AI 和本地多语种端到端收藏仍值得补齐，不把纯 DTO 矩阵说成端到端矩阵 |
| Reading／生词本备份 | reading-import、vocabulary-book、learning-center import/export Vitest、product-completeness、reading-storage | 版本、损坏、冲突、取消、导航、重启和容量回滚已有覆盖；补齐了 v1 真正经过恢复 registry 的路径。整份接近 64 MiB 的 UI 导入仍不在现有证据内 |
| Chrome 本地模型 | browser-basic-translation、native-model-preparation、真实 capability 专项 | 本轮合成 API 用例 6 PASS；真实模型上一轮 detector unavailable / translator downloadable，推理 SKIP，不算真实模型通过 |
| Provider 与 YouTube | provider-connections、provider adapter Node、youtube-main/subtitles 系列 | 具备 mock／合成运行测试；本轮未重跑这些未改的完整模块，也未做真实付费服务／YouTube 现场验收 |
| 安装升级、真实词典、大 MDD | wxt-upgrade / user-dictionary-upgrade、rich-mdict-real-corpus、large-mdd 等 | 依赖明确旧包或语料；环境不足的 SKIP 有理由。未准备这些输入，本轮 NOT RUN，不能把 discovery 或普通构建当升级／格式认证 |

## 实际执行与证据复用

以当前场景去重并用定向重验替换已修复失败：**52 个 Chromium 场景中 49 PASS、3 FAIL**。这是下列局部运行的合并结果，不是一条完整套件命令的结果；未执行全部 284 场景。

| 运行 | 原始结果 | 处理 |
| --- | --- | --- |
| baseline：cache-system-mv3、native-model-preparation、optional-dictionary-runtime、selection-release-gate | 15 PASS / 5 FAIL | 两个 native 旧假设随后修复；三个 cache 初次读取失败保留 |
| updated-legacy：native-model-preparation、selection-reading-record、translateflow | 27 PASS / 3 FAIL | native / Reading 完整通过；三个核心 Selection 的旧断言随后定向修复 |
| targeted-strengthening：核心 5 场景＋冷却与本站撤回 | 6 PASS / 1 FAIL | 核心修复和冷却通过；首次加强的撤回测试误把允许的 local CACHE_LOOKUP 当作联网动作，改为断言实际 TRANSLATE_BATCH，未改产品保护 |
| withdrawal | 1 PASS | 真正执行拒绝、零上传、全局单词仍可用 |
| fixture-options：四个消费者 | 7 PASS | 无作用旧选项移除后实际运行，未通过改 fixture 放宽权限 |
| cold-cache-diagnostic-final | 1 FAIL | 首次断言保持失败，第二次诊断成功，零 Provider；不合并成 PASS |
| npm test -- tests/reading-import.test.mjs | 4 PASS | 包含新增 v1 registry 路径与严格负例 |
| npm run test:e2e -- --list | PASS | 当前发现 284 场景／85 注册来源文件；只证明可以发现用例 |
| 最终变更 JS node --check / git diff --check | PASS | 未重建生产包；499 个已验收生产／构建输入文件 hash 均未变化 |

命令、原始失败、trace 与日志位于 Git 忽略的 `docs/task-execution/local/test-coverage-maintenance/` 与对应 test-results/run 目录。生产包继续复用 inventory `875833ed714745505a49c3b548b59d78ad86aa86c147812b95ccd28f4d469eec`；规范 fingerprint `e963461d025c8c985b7e3d38df94c3150f6eb8b032558f323ae6ad8da4b3d7a1`，本轮没有重新构建。上一轮 validate 日志及输入清单保留，当前改动仅重验其测试消费者；**不改写旧证据为当前全量 PASS**。

## 下一步维护顺序

1. 先修缓存冷启动顺序，回归首次 lookup 与真实并发配置改变，不能降低快照保护。
2. 增补 AI / Chrome 本地多语种真实消息链收藏、缓存与重启矩阵；现有在线场景和模型纯测试分别保留。
3. 在具备真实模型、目标词典及旧安装包的环境执行对应验收，并把 SKIP / NOT RUN 逐项补齐；不为测试自行下载模型或调用付费服务。
4. 日常按 [TEST_SELECTION](../../TEST_SELECTION.md) 选择真实消费者；全局路由／协议变化覆盖旧场景。仅源码字符串、手工截图或通过数量不能替代可观察流程。
