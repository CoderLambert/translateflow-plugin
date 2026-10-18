# 主 Agent 自查与删除理由

当前为集成自查，准确最终候选将在 acceptance.json 绑定；此记录不称为独立模型审核。

## 删除边界

- 后台只注册既有 active OPFS Reader 与 Glossary，不再有安装包资源探测、固定Reader、健康状态消息或fetch安全例外。
- 设置页移除内置分组与修复提示；保留下载、安装、导入、回滚、启停、排序、首选、删除和资源恢复。删除旧无消费者UI初始化闭包和遗留渲染函数，保留真实使用的权限与显示helper。
- Core编译器共享部分解耦为通用 `scripts/tflex-writer.mjs`；Reader、通用哈希/路径/目录/数据校验及全部导入工具保留。磁盘profile不变。
- 旧专属认证聚合脚本/体积预算/CI/来源不再有当前产品消费者。其通用数据安全、导入、取消、零Provider与包边界断言分别由保留的Node/E2E/vNext/ecosystem审计承接；不以删测试掩盖生产故障。
- fixture默认无词典；需要命中的用例显式在隔离profile中准备用户OPFS包。故障注入针对真实Reader读取范围。

## 历史残留分类

当前生产路径及CI不允许内置符号或资源路径；`tests/release-lexicon-contract.test.mjs` 的旧命令字符串仅用于断言退役命令不存在。

`docs/PLATFORM_UPGRADE_V1.md`、`docs/SELECTION_V2_DESIGN_FREEZE.md`、日期标注的来源审计及 `docs/{platform-upgrade-v1,wxt-compat-v1,types-tests-v1}/` JSON 为原候选不可变测量，已在所属说明标明退役；不改写SHA/结果。`docs/tasks/` 旧合同/acceptance保留原绑定。`lexicon/quality-decisions/dictionary-ecosystem-v2-source-qualification-2026-10-01.json` 的Core旧基线是来源决策历史，不是运行时注册或分发声明。

`bundled-sharded-v1` 仍是已存在的通用TFLex文件profile标识，为导入兼容保留；不代表任何构建打包能力。Technical翻译Preset、语义kind `technical-concept/technical-entity` 与Chromium bundled浏览器术语不属于废弃系统。

## 整文件删除清单

- `.github/workflows/lexicon-release.yml`
- `lexicon/quality-baselines/selection-lexical-v1.json`
- `lexicon/source-locks/core-semantic-pwn3-cow.json`
- `lexicon/source-locks/technical-reviewed-terms.json`
- `lexicon/source-locks/technical-wikidata.json`
- `lexicon/sources/reviewed-tech-terms.json`
- `lexicon/sources/wikidata-tech-entities.json`
- `scripts/audit-lexicon-sources.mjs`
- `scripts/benchmark-lexical-quality.mjs`
- `scripts/build-release-lexicon.mjs`
- `scripts/build-tflex-core.mjs`
- `scripts/build-tflex-technical.mjs`
- `scripts/certify-integrated-lexical-quality.mjs`
- `scripts/certify-lexical-release.mjs`
- `scripts/certify-offline-dictionary-beta.mjs`
- `scripts/evaluate-core-bootstrap.mjs`
- `scripts/reviewed-tech-terms.mjs`
- `scripts/setup-lexicon.mjs`
- `src/background/lexical/package-assets.js`
- `tests/core-bootstrap-evaluation.test.mjs`
- `tests/fixtures/lexical-quality-v1.json`
- `tests/fixtures/tflex-core/index.sense`
- `tests/fixtures/tflex-core/source-lock.json`
- `tests/fixtures/tflex-core/wn-data-cmn.tab`
- `tests/fixtures/tflex-core/wn-data-eng.tab`
- `tests/integrated-lexical-certification.test.mjs`
- `tests/lexical-quality-benchmark.test.mjs`
- `tests/lexicon-source-audit.test.mjs`
- `tests/offline-dictionary-beta-certification.test.mjs`
- `tests/reviewed-tech-terms.test.mjs`
- `tests/selection-release-certification.test.mjs`
- `tests/setup-lexicon.test.mjs`
- `tests/tflex-technical-builder.test.mjs`

- `scripts/audit-wikidata-tech-lock.mjs`、`tests/wikidata-tech-lock.test.mjs`、`tests/fixtures/wikidata-tech-lock.json`：只验证退役Technical来源锁，无通用导入消费者，随专属来源删除。

## 保留与未验证

保留所有用户词典/MDX/MDD/StarDict/TFLex通道、OPFS事务、用户偏好、Reading/Vocabulary、Glossary、Provider与缓存；无manifest权限或数据库schema更改。真实私有大型词典及生产网络下载若未实际执行，不视为PASS。完整验证、量化文件/行/包数据与限制写入 validation-report.md。
