# 修复首次缓存查询竞态并补齐多语种收藏验证

2026-10-20；主 Agent 串行实现及自查。用户在测试审核后追加“继续修复吧”，本轮允许修改已发现的运行时问题。基线 HEAD / 已刷新 origin/main 为 `8c2b8ec0f65b7afc30be5065c49619b16b2872ea`，工作区 `translateflow-translation-method`，分支 `fix/product-completeness-20261020`。实现、测试与文档均未提交；candidateHead / mergeHead 为 null。保留此前全部修改，没有推送、合并或替换 Chrome 登记的安装目录。

## 修复行为

首次直接调用 CACHE_LOOKUP 时，旧连接／偏好迁移不再使该次新查询误报 CONFIG_SNAPSHOT_EXPIRED。`config.js` 的 `ensureConfigInitialized()` 合并并发初始化，等待连接及偏好迁移完成；快照随后固定版本并重新解析有效配置。初始化结果不永久缓存，因此后续恢复存储仍能重新初始化。

`effective-config-snapshots.js` 保留解析前后的版本保护。携带显式 configRevision 的恢复请求在初始化前后都校验版本；解析途中真正修改配置仍拒绝旧结果。后续缓存查询、执行和写入沿用原快照，未改变缓存格式、所有权、取消流程、权限或联网同意边界。迁移不调用翻译服务，不删除缓存。

新增三个 Node 回归，分别验证并发首次读取只写一次连接与一次偏好迁移、显式旧版本不能跨初始化失效、解析途中变更拒绝旧快照且新查询能读取最新语言。原连接版本固定测试保留。

`product-completeness.spec.mjs` 新增 AI／Chrome 本地 × 日语／法语四个 Chromium 场景：真实划词入口首次执行 → 再次选词命中缓存 → 收藏 → 检查实际语言及来源 → 持久 profile 重启 → 收藏保持且查词不重复执行。AI 的来源使用有效配置的规范协议 `openai-chat`；本地为 `browser-translator`，语言对为 en→ja / en→fr。没有直接注入生词本条目替代收藏流程。

## 实际验证

| 检查 | 结果与范围 |
| --- | --- |
| `npm test -- tests/effective-config-snapshots.test.mjs tests/translation-preferences.test.mjs tests/provider-connections.test.mjs` | 31 PASS；含新增初始化与版本保护回归 |
| `npm run build:extension:wxt` | PASS；重新构建生产 WXT 包，未修改生成文件 |
| `TF_TEST_WORKERS=1 npm run test:e2e -- e2e/cache-system-mv3.spec.mjs e2e/product-completeness.spec.mjs --retries=0` | 首轮 15 PASS / 2 FAIL；缓存 6 项全部通过，包括之前失败的 3 项首次查询。两个新增 AI 用例把来源误写为 legacy `openai-compatible`，实际应为有效协议 `openai-chat`，根据配置解析代码修正预期 |
| `TF_TEST_WORKERS=1 npm run test:e2e -- e2e/product-completeness.spec.mjs --grep 'ai (ja\|fr) cached vocabulary' --retries=0` | 两个受影响 AI 用例复验 2 PASS；其余 15 项有效结果复用。最初带标题起始锚点的筛选未发现测试，未计为执行或 PASS |
| `npm run validate` | PASS：静态／架构与 i18n 检查、1,972 Node、严格 TypeScript、14 文件／80 Vitest、默认安装包构建全部通过；不含 E2E |
| `TF_TEST_WORKERS=1 npm run test:e2e -- e2e/translation-preferences.spec.mjs e2e/provider-connections.spec.mjs e2e/translateflow.spec.mjs e2e/native-model-preparation.spec.mjs --retries=0` | 32 PASS / 1 SKIP；旧划词、连接、偏好、迁移、导航取消及资源准备流程回归通过。真实 native 探测 detector=unavailable / translator=downloadable，不下载或 create |
| 输入与包核对、`git diff --check` | PASS；849 个实现／构建／测试输入 hash 在验证后未变；两个包的规范 fingerprint 相同 |

本轮按不同场景去重、以修正后的定向结果替换对应失败，**49 个 Chromium 场景 PASS，1 个真实模型场景 SKIP**。这是六个相关 spec 的多次定向运行结果，不是一条完整 E2E 命令，也不是全部浏览器场景验收。原[审核记录](review.md)的 49 PASS / 3 FAIL 属于修复前证据，保留不覆盖；这三个缓存失败已在当前包复验通过。

## 候选与证据

源码仍未提交，验收绑定本地输入清单 `docs/task-execution/local/test-coverage-maintenance/followup/verified-inputs.json`，inputSha256 为 `de65d5c9e3d3e3f71e67b88f68f22fbc4248032778b48473e18d2a8892ce5d43`。

`dist/extension` 与 `.output/chrome-mv3` 均为 0.8.42，规范 fingerprint 为 `6b2f814bb74a97870f6753d50f008657799ea7f79b58c810243f05f3c0567b2e`；E2E inventory 的另一种 treeSha256 为 `408eb67cb8caf516d4b501d808f975cb9dbbcfb1f420e764465ac8c4c8dab093`，131 文件／3,062,299 bytes。构建输入已变化，不能继续把此前包指纹作为当前验收。

原始构建、validate、首次失败与最终通过日志，以及日志 hash 清单在 Git 忽略的 `docs/task-execution/local/test-coverage-maintenance/followup/`。包只通过临时 profile／测试副本加载；没有替换用户安装目录。自查确认修改集中在初始化顺序、快照版本校验、回归用例和相应文档，没有扩大权限、清空数据或通过重试绕过首次断言。

## 未验证范围

Chrome 本地成功场景使用合成 API，AI 使用本地 mock Provider，证明生产消息／缓存／收藏链路正确，不能当作真实推理或公网 Provider 成功。真实模型、付费／真实在线服务、目标私有词典、真实 YouTube 和完整升级环境验收本轮未执行；没有为测试下载模型或使用真实凭据。整个浏览器套件未全量运行。
