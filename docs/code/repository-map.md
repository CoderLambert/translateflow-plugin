# 仓库逐文件地图

[首页](README.md) · [总架构](architecture.md) · [启动功能链](features/extension-startup.md) · [划词查询链](features/selection-and-dictionary.md) · [机器可读覆盖清单](coverage.json)

## 范围与计算

固定 main `d5e308a709c008acf6b277d466d020f13025bdca` 的完整递归 Git tree，truncated=false。仅计 type=blob，共 **636 个受版本管理文件**；无排除、无漏掉的二进制fixture。树节点/目录不计文件。新写的导读在独立分支，不混进该 main 分母。

已解释 **29**，待解释 **607**；其中 **41** 个有局部功能边界说明，仍计待解释。逐文件源码 blob/大小/日期见 coverage.json。以下功能归类是定位提示，未读正文的项不声称已验证职责。测试/规范/数据也逐项保留，后续按其性质说明用途与边界，不将它们冒充运行时业务。

已解释文件的正文包含实现、状态、错误、安全与修改影响。未解释项提供固定源码链接作为定位入口；链接本身不算解释。

## (root)

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [.editorconfig](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.editorconfig) | 启动与共享基础 | 待解释 |
| [.gitattributes](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.gitattributes) | 启动与共享基础 | 待解释 |
| [.gitignore](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.gitignore) | 启动与共享基础 | 待解释 |
| [AGENTS.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/AGENTS.md) | 现有规范与证据 | 待解释 |
| [CONTRIBUTING.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/CONTRIBUTING.md) | 现有规范与证据 | 待解释 |
| [README.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/README.md) | 现有规范与证据 | 待解释 |
| [background.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/background.js) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-background-entry) |
| [content.css](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/content.css) | 界面基础 | 待解释 |
| [content.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/content.js) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-content-entry) |
| [manifest.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/manifest.json) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-manifest) |
| [options.css](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/options.css) | Provider与设置 | 待解释 |
| [options.html](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/options.html) | Provider与设置 | 待解释 |
| [options.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/options.js) | Provider与设置 | 待解释 |
| [package-lock.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/package-lock.json) | 构建与开发流程 | 待解释 |
| [package.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/package.json) | 构建与开发流程 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [playwright.config.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/playwright.config.mjs) | 构建与开发流程 | 待解释 |
| [popup-appearance.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup-appearance.js) | 启动与共享基础 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [popup.css](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.css) | 界面基础 | 待解释 |
| [popup.html](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.html) | 启动与共享基础 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [popup.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/popup.js) | 启动与共享基础 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [tsconfig.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tsconfig.json) | 构建与开发流程 | 待解释 |
| [vitest.config.ts](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/vitest.config.ts) | 构建与开发流程 | 待解释 |
| [wxt.config.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/wxt.config.mjs) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-wxt-config) |

## .github

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [.github/ISSUE_TEMPLATE/agent-task.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/ISSUE_TEMPLATE/agent-task.md) | 构建与开发流程 | 待解释 |
| [.github/pull_request_template.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/pull_request_template.md) | 构建与开发流程 | 待解释 |
| [.github/workflows/dictionary-library-vnext-certification.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/dictionary-library-vnext-certification.yml) | 构建与开发流程 | 待解释 |
| [.github/workflows/e2e.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/e2e.yml) | 构建与开发流程 | 待解释 |
| [.github/workflows/freedict-source-audit.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/freedict-source-audit.yml) | 构建与开发流程 | 待解释 |
| [.github/workflows/lexicon-release.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/lexicon-release.yml) | 构建与开发流程 | 待解释 |
| [.github/workflows/mdd-resources.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/mdd-resources.yml) | 构建与开发流程 | 待解释 |
| [.github/workflows/quality.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/quality.yml) | 构建与开发流程 | 待解释 |
| [.github/workflows/rich-lookup-cancellation.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/rich-lookup-cancellation.yml) | 构建与开发流程 | 待解释 |
| [.github/workflows/rich-mdict-compatibility.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/rich-mdict-compatibility.yml) | 构建与开发流程 | 待解释 |
| [.github/workflows/wikimedia-wiktionary-source-lock.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/wikimedia-wiktionary-source-lock.yml) | 构建与开发流程 | 待解释 |
| [.github/workflows/wiktextract-ingest.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/wiktextract-ingest.yml) | 构建与开发流程 | 待解释 |
| [.github/workflows/wiktextract-rich-poc.yml](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/.github/workflows/wiktextract-rich-poc.yml) | 构建与开发流程 | 待解释 |

## _locales

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [_locales/en/messages.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/_locales/en/messages.json) | 界面本地化 | 待解释 |
| [_locales/zh_CN/messages.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/_locales/zh_CN/messages.json) | 界面本地化 | 待解释 |

## docs

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [docs/ARCHITECTURE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/ARCHITECTURE.md) | 现有规范与证据 | 待解释 |
| [docs/BUNDLED_LEXICON_POLICY.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/BUNDLED_LEXICON_POLICY.md) | 现有规范与证据 | 待解释 |
| [docs/CHROME_COMMANDS.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/CHROME_COMMANDS.md) | 现有规范与证据 | 待解释 |
| [docs/DICTIONARY_ECOSYSTEM_V2_ACCEPTANCE_EVIDENCE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/DICTIONARY_ECOSYSTEM_V2_ACCEPTANCE_EVIDENCE.md) | 现有规范与证据 | 待解释 |
| [docs/DICTIONARY_ECOSYSTEM_V2_PREFERRED_BASELINE.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/DICTIONARY_ECOSYSTEM_V2_PREFERRED_BASELINE.json) | 现有规范与证据 | 待解释 |
| [docs/DICTIONARY_ECOSYSTEM_V2_RELEASE_SCOPE.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/DICTIONARY_ECOSYSTEM_V2_RELEASE_SCOPE.json) | 现有规范与证据 | 待解释 |
| [docs/DICTIONARY_LIBRARY_VNEXT_CERTIFICATION.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/DICTIONARY_LIBRARY_VNEXT_CERTIFICATION.md) | 现有规范与证据 | 待解释 |
| [docs/DICTIONARY_SOURCE_FREEZE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/DICTIONARY_SOURCE_FREEZE.md) | 现有规范与证据 | 待解释 |
| [docs/DICTIONARY_SOURCE_QUALIFICATION_2026-10-01.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/DICTIONARY_SOURCE_QUALIFICATION_2026-10-01.md) | 现有规范与证据 | 待解释 |
| [docs/E2E.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/E2E.md) | 现有规范与证据 | 待解释 |
| [docs/LEXICAL_DATA_BOUNDARIES.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/LEXICAL_DATA_BOUNDARIES.md) | 现有规范与证据 | 待解释 |
| [docs/LEXICAL_GATEWAY.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/LEXICAL_GATEWAY.md) | 现有规范与证据 | 待解释 |
| [docs/LEXICAL_RANKING.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/LEXICAL_RANKING.md) | 现有规范与证据 | 待解释 |
| [docs/LOCAL_DICTIONARY_IMPORT_V2.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/LOCAL_DICTIONARY_IMPORT_V2.md) | 现有规范与证据 | 待解释 |
| [docs/LOCAL_DICTIONARY_PREFLIGHT.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/LOCAL_DICTIONARY_PREFLIGHT.md) | 现有规范与证据 | 待解释 |
| [docs/MDICT_IMPORT_POC.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/MDICT_IMPORT_POC.md) | 现有规范与证据 | 待解释 |
| [docs/MDICT_REAL_WORLD_COMPATIBILITY.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/MDICT_REAL_WORLD_COMPATIBILITY.md) | 现有规范与证据 | 待解释 |
| [docs/OFFLINE_DICTIONARY_BETA_CERTIFICATION.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/OFFLINE_DICTIONARY_BETA_CERTIFICATION.md) | 现有规范与证据 | 待解释 |
| [docs/PERFORMANCE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/PERFORMANCE.md) | 现有规范与证据 | 待解释 |
| [docs/PLATFORM_UPGRADE_V1.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/PLATFORM_UPGRADE_V1.md) | 现有规范与证据 | 待解释 |
| [docs/PROVIDERS.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/PROVIDERS.md) | 现有规范与证据 | 待解释 |
| [docs/QUICK_CONTROL.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/QUICK_CONTROL.md) | 现有规范与证据 | 待解释 |
| [docs/READING_APPEARANCE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/READING_APPEARANCE.md) | 现有规范与证据 | 待解释 |
| [docs/READING_LOOP_V1.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/READING_LOOP_V1.md) | 现有规范与证据 | 待解释 |
| [docs/READING_STORAGE_V1.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/READING_STORAGE_V1.md) | 现有规范与证据 | 待解释 |
| [docs/RELEASE_V0.8.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/RELEASE_V0.8.md) | 现有规范与证据 | 待解释 |
| [docs/RICH_MDD_INTEROP_EVIDENCE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/RICH_MDD_INTEROP_EVIDENCE.md) | 现有规范与证据 | 待解释 |
| [docs/RICH_MDICT_EVIDENCE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/RICH_MDICT_EVIDENCE.md) | 现有规范与证据 | 待解释 |
| [docs/SELECTION_V2_DESIGN_FREEZE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/SELECTION_V2_DESIGN_FREEZE.md) | 现有规范与证据 | 待解释 |
| [docs/STARDICT_IMPORT_POC.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/STARDICT_IMPORT_POC.md) | 现有规范与证据 | 待解释 |
| [docs/SUBTITLE_PIPELINE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/SUBTITLE_PIPELINE.md) | 现有规范与证据 | 待解释 |
| [docs/TFLEX_BUILD.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/TFLEX_BUILD.md) | 现有规范与证据 | 待解释 |
| [docs/TFLEX_TECH_BUILD.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/TFLEX_TECH_BUILD.md) | 现有规范与证据 | 待解释 |
| [docs/TFLEX_V1.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/TFLEX_V1.md) | 现有规范与证据 | 待解释 |
| [docs/TYPES_TESTS_V1.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/TYPES_TESTS_V1.md) | 现有规范与证据 | 待解释 |
| [docs/UI_FOUNDATION.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/UI_FOUNDATION.md) | 现有规范与证据 | 待解释 |
| [docs/UI_LOCALE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/UI_LOCALE.md) | 现有规范与证据 | 待解释 |
| [docs/WIKTIONARY_RICH_POC.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/WIKTIONARY_RICH_POC.md) | 现有规范与证据 | 待解释 |
| [docs/WXT_COMPAT_V1.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/WXT_COMPAT_V1.md) | 现有规范与证据 | 待解释 |
| [docs/YOUTUBE_SUBTITLES.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/YOUTUBE_SUBTITLES.md) | 现有规范与证据 | 待解释 |
| [docs/platform-upgrade-v1/RESULTS.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/platform-upgrade-v1/RESULTS.md) | 现有规范与证据 | 待解释 |
| [docs/platform-upgrade-v1/baseline-inventory.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/platform-upgrade-v1/baseline-inventory.json) | 现有规范与证据 | 待解释 |
| [docs/platform-upgrade-v1/browser-report.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/platform-upgrade-v1/browser-report.json) | 现有规范与证据 | 待解释 |
| [docs/platform-upgrade-v1/browser-smoke.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/platform-upgrade-v1/browser-smoke.mjs) | 现有规范与证据 | 待解释 |
| [docs/platform-upgrade-v1/experiment-lock.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/platform-upgrade-v1/experiment-lock.json) | 现有规范与证据 | 待解释 |
| [docs/platform-upgrade-v1/experiment-report.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/platform-upgrade-v1/experiment-report.json) | 现有规范与证据 | 待解释 |
| [docs/platform-upgrade-v1/final-validation.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/platform-upgrade-v1/final-validation.json) | 现有规范与证据 | 待解释 |
| [docs/platform-upgrade-v1/prepare-experiment.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/platform-upgrade-v1/prepare-experiment.mjs) | 现有规范与证据 | 待解释 |
| [docs/platform-upgrade-v1/toolchain.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/platform-upgrade-v1/toolchain.json) | 现有规范与证据 | 待解释 |
| [docs/reading-access-v1/README.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/reading-access-v1/README.md) | 现有规范与证据 | 待解释 |
| [docs/reading-source-position-v1/inline-review-repair.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/reading-source-position-v1/inline-review-repair.json) | 现有规范与证据 | 待解释 |
| [docs/reading-source-position-v1/shared-slice-repair.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/reading-source-position-v1/shared-slice-repair.json) | 现有规范与证据 | 待解释 |
| [docs/types-tests-v1/artifact-fingerprint.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/types-tests-v1/artifact-fingerprint.json) | 现有规范与证据 | 待解释 |
| [docs/types-tests-v1/asset-map.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/types-tests-v1/asset-map.json) | 现有规范与证据 | 待解释 |
| [docs/types-tests-v1/browser-smoke.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/types-tests-v1/browser-smoke.json) | 现有规范与证据 | 待解释 |
| [docs/types-tests-v1/compiled-closures.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/types-tests-v1/compiled-closures.json) | 现有规范与证据 | 待解释 |
| [docs/types-tests-v1/computed-api-repair.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/types-tests-v1/computed-api-repair.json) | 现有规范与证据 | 待解释 |
| [docs/types-tests-v1/full-environment-failure.txt](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/types-tests-v1/full-environment-failure.txt) | 现有规范与证据 | 待解释 |
| [docs/types-tests-v1/full-environment.tsconfig.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/types-tests-v1/full-environment.tsconfig.json) | 现有规范与证据 | 待解释 |
| [docs/types-tests-v1/production-audit.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/types-tests-v1/production-audit.json) | 现有规范与证据 | 待解释 |
| [docs/types-tests-v1/runner-discovery.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/types-tests-v1/runner-discovery.json) | 现有规范与证据 | 待解释 |
| [docs/types-tests-v1/verification.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/types-tests-v1/verification.json) | 现有规范与证据 | 待解释 |
| [docs/wiktextract-ingest.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/wiktextract-ingest.md) | 现有规范与证据 | 待解释 |
| [docs/wxt-compat-v1/artifact-fingerprint.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/wxt-compat-v1/artifact-fingerprint.json) | 现有规范与证据 | 待解释 |
| [docs/wxt-compat-v1/asset-map.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/wxt-compat-v1/asset-map.json) | 现有规范与证据 | 待解释 |
| [docs/wxt-compat-v1/browser-smoke.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/wxt-compat-v1/browser-smoke.json) | 现有规范与证据 | 待解释 |
| [docs/wxt-compat-v1/compiled-closures.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/wxt-compat-v1/compiled-closures.json) | 现有规范与证据 | 待解释 |
| [docs/wxt-compat-v1/production-audit.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/wxt-compat-v1/production-audit.json) | 现有规范与证据 | 待解释 |
| [docs/wxt-compat-v1/verification.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/wxt-compat-v1/verification.json) | 现有规范与证据 | 待解释 |

## e2e

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [e2e/commands.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/commands.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/curated-ecdict-mdx-product.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/curated-ecdict-mdx-product.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/curated-ecdict-product.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/curated-ecdict-product.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/dark-mode.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/dark-mode.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/design-freeze-poc.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/design-freeze-poc.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/design-freeze-selection-slice.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/design-freeze-selection-slice.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/dictionary-ecosystem-v2-release.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/dictionary-ecosystem-v2-release.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/dictionary-library-v2-product.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/dictionary-library-v2-product.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/dictionary-library-vnext-product.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/dictionary-library-vnext-product.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/local-dictionary-import-v2-product.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/local-dictionary-import-v2-product.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/local-dictionary-preflight-real-ecdict.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/local-dictionary-preflight-real-ecdict.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/local-import-cancellation-regression.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/local-import-cancellation-regression.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/mdd-resources.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/mdd-resources.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/mdict-import-product.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/mdict-import-product.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/multi-dictionary-viewer.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/multi-dictionary-viewer.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/reading-access.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/reading-access.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/reading-source-position.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/reading-source-position.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/reading-storage-regressions.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/reading-storage-regressions.mjs) | 测试与验证 | 待解释 |
| [e2e/reading-storage.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/reading-storage.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/release-gate.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/release-gate.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/release-lexicon.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/release-lexicon.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/rich-mdict-product.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/rich-mdict-product.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/rich-mdict-real-corpus.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/rich-mdict-real-corpus.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/rich-viewer-security.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/rich-viewer-security.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/selection-lexicon-corrupt.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/selection-lexicon-corrupt.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/selection-lexicon-error.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/selection-lexicon-error.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/selection-lexicon-incompatible.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/selection-lexicon-incompatible.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/selection-release-gate.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/selection-release-gate.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/selection-rich-lookup-cancel.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/selection-rich-lookup-cancel.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/settings-ia.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/settings-ia.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/stardict-import-product.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/stardict-import-product.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/stardict-import-worker.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/stardict-import-worker.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/subtitle-pipeline.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/subtitle-pipeline.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/subtitles.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/subtitles.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/support/extension-fixture.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/support/extension-fixture.mjs) | 测试与验证 | 待解释 |
| [e2e/support/mock-server.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/support/mock-server.mjs) | 测试与验证 | 待解释 |
| [e2e/translateflow.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/translateflow.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/ui-locale.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/ui-locale.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/ui-redesign.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/ui-redesign.spec.mjs) | 测试与验证 | 待解释 |
| [e2e/youtube-subtitles.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/youtube-subtitles.spec.mjs) | 字幕 | 待解释 |

## entrypoints

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [entrypoints/background.ts](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/entrypoints/background.ts) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-wxt-background-entry) |

## lexicon

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [lexicon/README.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/README.md) | 词典导入与资源 | 待解释 |
| [lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json) | 词典导入与资源 | 待解释 |
| [lexicon/build-evidence/mdict-compatibility/ecdict-1.0.28.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/build-evidence/mdict-compatibility/ecdict-1.0.28.json) | 词典导入与资源 | 待解释 |
| [lexicon/build-evidence/mdict-compatibility/writemdict-synthetic-interop.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/build-evidence/mdict-compatibility/writemdict-synthetic-interop.json) | 词典导入与资源 | 待解释 |
| [lexicon/build-evidence/wikimedia-enwiktionary-20260901-rich-partial-compatibility.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/build-evidence/wikimedia-enwiktionary-20260901-rich-partial-compatibility.json) | 词典导入与资源 | 待解释 |
| [lexicon/build-evidence/wikimedia-enwiktionary-20260901-rich-partial-stop.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/build-evidence/wikimedia-enwiktionary-20260901-rich-partial-stop.json) | 词典导入与资源 | 待解释 |
| [lexicon/quality-baselines/selection-lexical-v1.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/quality-baselines/selection-lexical-v1.json) | 词典导入与资源 | 待解释 |
| [lexicon/quality-decisions/dictionary-ecosystem-v2-source-qualification-2026-10-01.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/quality-decisions/dictionary-ecosystem-v2-source-qualification-2026-10-01.json) | 词典导入与资源 | 待解释 |
| [lexicon/quality-decisions/freedict-eng-zho-2025.11.23.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/quality-decisions/freedict-eng-zho-2025.11.23.json) | 词典导入与资源 | 待解释 |
| [lexicon/quality-decisions/wikimedia-enwiktionary-20260901-rich.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/quality-decisions/wikimedia-enwiktionary-20260901-rich.json) | 词典导入与资源 | 待解释 |
| [lexicon/source-candidates/kaikki-enwiktionary-2026-09-25.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/source-candidates/kaikki-enwiktionary-2026-09-25.json) | 词典导入与资源 | 待解释 |
| [lexicon/source-candidates/wikimedia-enwiktionary-2026-09-01.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/source-candidates/wikimedia-enwiktionary-2026-09-01.json) | 词典导入与资源 | 待解释 |
| [lexicon/source-locks/cc-cedict-current-2026-10-01.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/source-locks/cc-cedict-current-2026-10-01.json) | 词典导入与资源 | 待解释 |
| [lexicon/source-locks/core-semantic-pwn3-cow.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/source-locks/core-semantic-pwn3-cow.json) | 词典导入与资源 | 待解释 |
| [lexicon/source-locks/freedict-eng-zho.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/source-locks/freedict-eng-zho.json) | 词典导入与资源 | 待解释 |
| [lexicon/source-locks/open-english-wordnet-2025-json.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/source-locks/open-english-wordnet-2025-json.json) | 词典导入与资源 | 待解释 |
| [lexicon/source-locks/technical-reviewed-terms.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/source-locks/technical-reviewed-terms.json) | 词典导入与资源 | 待解释 |
| [lexicon/source-locks/technical-wikidata.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/source-locks/technical-wikidata.json) | 词典导入与资源 | 待解释 |
| [lexicon/source-locks/wikimedia-enwiktionary-2026-09-01.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/source-locks/wikimedia-enwiktionary-2026-09-01.json) | 词典导入与资源 | 待解释 |
| [lexicon/sources/reviewed-tech-terms.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/sources/reviewed-tech-terms.json) | 词典导入与资源 | 待解释 |
| [lexicon/sources/wikidata-tech-entities.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/lexicon/sources/wikidata-tech-entities.json) | 词典导入与资源 | 待解释 |

## scripts

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [scripts/audit-freedict-source.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/audit-freedict-source.mjs) | 构建与开发流程 | 待解释 |
| [scripts/audit-lexicon-sources.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/audit-lexicon-sources.mjs) | 构建与开发流程 | 待解释 |
| [scripts/audit-wikidata-tech-lock.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/audit-wikidata-tech-lock.mjs) | 构建与开发流程 | 待解释 |
| [scripts/audit-wikimedia-enwiktionary-source.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/audit-wikimedia-enwiktionary-source.mjs) | 构建与开发流程 | 待解释 |
| [scripts/audit-wiktextract-projection-compatibility.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/audit-wiktextract-projection-compatibility.mjs) | 构建与开发流程 | 待解释 |
| [scripts/audit-wxt-extension.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/audit-wxt-extension.mjs) | 构建与开发流程 | 待解释 |
| [scripts/benchmark-lexical-quality.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/benchmark-lexical-quality.mjs) | 构建与开发流程 | 待解释 |
| [scripts/benchmark-translation.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/benchmark-translation.mjs) | 构建与开发流程 | 待解释 |
| [scripts/build-extension.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/build-extension.mjs) | 构建与开发流程 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [scripts/build-release-lexicon.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/build-release-lexicon.mjs) | 构建与开发流程 | 待解释 |
| [scripts/build-tflex-core.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/build-tflex-core.mjs) | 构建与开发流程 | 待解释 |
| [scripts/build-tflex-freedict.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/build-tflex-freedict.mjs) | 构建与开发流程 | 待解释 |
| [scripts/build-tflex-mdict-import.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/build-tflex-mdict-import.mjs) | 构建与开发流程 | 待解释 |
| [scripts/build-tflex-stardict-import.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/build-tflex-stardict-import.mjs) | 构建与开发流程 | 待解释 |
| [scripts/build-tflex-technical.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/build-tflex-technical.mjs) | 构建与开发流程 | 待解释 |
| [scripts/certify-dictionary-ecosystem-v2.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/certify-dictionary-ecosystem-v2.mjs) | 构建与开发流程 | 待解释 |
| [scripts/certify-freedict-pack.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/certify-freedict-pack.mjs) | 构建与开发流程 | 待解释 |
| [scripts/certify-integrated-lexical-quality.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/certify-integrated-lexical-quality.mjs) | 构建与开发流程 | 待解释 |
| [scripts/certify-lexical-release.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/certify-lexical-release.mjs) | 构建与开发流程 | 待解释 |
| [scripts/certify-mdd-interop.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/certify-mdd-interop.mjs) | 构建与开发流程 | 待解释 |
| [scripts/certify-offline-dictionary-beta.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/certify-offline-dictionary-beta.mjs) | 构建与开发流程 | 待解释 |
| [scripts/certify-rich-mdict-corpus.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/certify-rich-mdict-corpus.mjs) | 构建与开发流程 | 待解释 |
| [scripts/certify-vnext-dictionary-library.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/certify-vnext-dictionary-library.mjs) | 构建与开发流程 | 待解释 |
| [scripts/check.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/check.mjs) | 构建与开发流程 | 待解释 |
| [scripts/evaluate-core-bootstrap.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/evaluate-core-bootstrap.mjs) | 构建与开发流程 | 待解释 |
| [scripts/evaluate-freedict-quality.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/evaluate-freedict-quality.mjs) | 构建与开发流程 | 待解释 |
| [scripts/evaluate-lexical-ranking.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/evaluate-lexical-ranking.mjs) | 构建与开发流程 | 待解释 |
| [scripts/generate-mdd-interop-fixture.py](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/generate-mdd-interop-fixture.py) | 构建与开发流程 | 待解释 |
| [scripts/i18n-locales.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/i18n-locales.mjs) | 构建与开发流程 | 待解释 |
| [scripts/inspect-mdict-compatibility.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/inspect-mdict-compatibility.mjs) | 构建与开发流程 | 待解释 |
| [scripts/lock-kaikki-source.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/lock-kaikki-source.mjs) | 构建与开发流程 | 待解释 |
| [scripts/mdict-compatibility-capabilities.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/mdict-compatibility-capabilities.mjs) | 构建与开发流程 | 待解释 |
| [scripts/measure-extension-footprint.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/measure-extension-footprint.mjs) | 构建与开发流程 | 待解释 |
| [scripts/measure-reading-contract.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/measure-reading-contract.mjs) | 构建与开发流程 | 待解释 |
| [scripts/measure-rich-lookup-cancellation-baseline.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/measure-rich-lookup-cancellation-baseline.mjs) | 构建与开发流程 | 待解释 |
| [scripts/measure-stardict-import-cost.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/measure-stardict-import-cost.mjs) | 构建与开发流程 | 待解释 |
| [scripts/project-kaikki-rich.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/project-kaikki-rich.mjs) | 构建与开发流程 | 待解释 |
| [scripts/project-mdict-import.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/project-mdict-import.mjs) | 构建与开发流程 | 待解释 |
| [scripts/project-stardict-import.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/project-stardict-import.mjs) | 构建与开发流程 | 待解释 |
| [scripts/resolve-ecosystem-certification-base.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/resolve-ecosystem-certification-base.mjs) | 构建与开发流程 | 待解释 |
| [scripts/reviewed-tech-terms.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/reviewed-tech-terms.mjs) | 构建与开发流程 | 待解释 |
| [scripts/run-pinned-wiktextract-ingest.py](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/run-pinned-wiktextract-ingest.py) | 构建与开发流程 | 待解释 |
| [scripts/setup-lexicon.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/setup-lexicon.mjs) | 构建与开发流程 | 待解释 |
| [scripts/smoke-wxt-extension.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/smoke-wxt-extension.mjs) | 构建与开发流程 | 待解释 |
| [scripts/source-api-boundaries.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/source-api-boundaries.mjs) | 构建与开发流程 | 待解释 |
| [scripts/source-boundaries.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/source-boundaries.mjs) | 构建与开发流程 | 待解释 |
| [scripts/wikimedia-enwiktionary-contract.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/wikimedia-enwiktionary-contract.mjs) | 构建与开发流程 | 待解释 |
| [scripts/wikimedia-enwiktionary-lock.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/wikimedia-enwiktionary-lock.mjs) | 构建与开发流程 | 待解释 |
| [scripts/wiktextract-nltk-data-lock.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/wiktextract-nltk-data-lock.json) | 构建与开发流程 | 待解释 |
| [scripts/wiktextract-python-requirements.lock](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/wiktextract-python-requirements.lock) | 构建与开发流程 | 待解释 |
| [scripts/wiktextract_extraction_evidence.py](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/wiktextract_extraction_evidence.py) | 构建与开发流程 | 待解释 |
| [scripts/wiktextract_ingest_evidence.py](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/wiktextract_ingest_evidence.py) | 构建与开发流程 | 待解释 |
| [scripts/wxt-assets.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/scripts/wxt-assets.mjs) | 构建与开发流程 | 待解释 |

## src

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [src/background/auto-sites.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/auto-sites.js) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-auto-sites) |
| [src/background/cache-db.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/cache-db.js) | 网页翻译与缓存 | 待解释 · [局部边界](modules/selection.md#partial-provider-cache) |
| [src/background/commands.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/commands.js) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-commands) |
| [src/background/config.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/config.js) | 启动与共享基础 | 待解释 · [局部边界](modules/selection.md#partial-provider-cache) · [关联说明](modules/startup.md#partial-files) |
| [src/background/index.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/index.js) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-background-index) |
| [src/background/lexical/active-opfs-reader.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/active-opfs-reader.js) | 划词与词典查询 | 待解释 |
| [src/background/lexical/context-phrase.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/context-phrase.js) | 划词与词典查询 | 待解释 · [局部边界](modules/selection.md#partial-lexical) |
| [src/background/lexical/gateway.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/gateway.js) | 划词与词典查询 | 待解释 · [局部边界](modules/selection.md#partial-lexical) |
| [src/background/lexical/index.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/index.js) | 划词与词典查询 | 待解释 · [局部边界](modules/selection.md#partial-lexical) |
| [src/background/lexical/lru.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/lru.js) | 划词与词典查询 | 待解释 |
| [src/background/lexical/opfs-indexed-reader.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/opfs-indexed-reader.js) | 划词与词典查询 | 待解释 |
| [src/background/lexical/package-assets.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/package-assets.js) | 划词与词典查询 | 待解释 |
| [src/background/lexical/ranking.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/ranking.js) | 划词与词典查询 | 待解释 · [局部边界](modules/selection.md#partial-lexical) |
| [src/background/lexical/tflex-integrity.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/tflex-integrity.js) | 划词与词典查询 | 待解释 |
| [src/background/lexical/tflex-reader.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/lexical/tflex-reader.js) | 划词与词典查询 | 待解释 |
| [src/background/packs/api.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/api.js) | 词典导入与资源 | 待解释 · [局部边界](modules/selection.md#partial-router) |
| [src/background/packs/catalog.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/catalog.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/health.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/health.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/curated-local-adapter.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/curated-local-adapter.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/ecdict-csv-stream.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/ecdict-csv-stream.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/ecdict-csv.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/ecdict-csv.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/ecdict-local-adapter.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/ecdict-local-adapter.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/ecdict-mdx-zip-layout.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/ecdict-mdx-zip-layout.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/ecdict-mdx-zip.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/ecdict-mdx-zip.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdd-index.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-index.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdd-key-codec.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-key-codec.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdd-lookup.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-lookup.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdd-metadata.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-metadata.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdd-query-budget.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-query-budget.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdd-resource-path.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-resource-path.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdd-resource-policy.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-resource-policy.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdd-validation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-validation.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdd.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-block-codec.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-block-codec.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-contract.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-contract.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-core.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-core.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-key-section.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-key-section.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-local-adapter.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-local-adapter.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-metadata.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-metadata.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-record-section.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-record-section.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-rich-index.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-index.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-rich-key-codec.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-key-codec.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-rich-lookup.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-lookup.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-rich-metadata.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-metadata.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-rich-query-budget.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-query-budget.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-rich-record-text.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-record-text.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-rich-source.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-source.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-rich-validation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-validation.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-rich.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-ripemd128.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-ripemd128.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/mdict-semantic.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-semantic.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/stardict-binary.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/stardict-binary.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/stardict-browser-dictzip.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/stardict-browser-dictzip.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/stardict-contract.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/stardict-contract.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/stardict-core.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/stardict-core.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/stardict-dictzip.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/stardict-dictzip.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/stardict-import-action.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/stardict-import-action.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/stardict-local-adapter.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/stardict-local-adapter.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/stardict-semantic.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/stardict-semantic.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/importers/tflex-local-builder.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/tflex-local-builder.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/local-dictionary-preflight-contract.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight-contract.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/local-dictionary-preflight-identity.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight-identity.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/local-dictionary-preflight-mdx.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight-mdx.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/local-dictionary-preflight-stardict.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight-stardict.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/local-dictionary-preflight-tflex.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight-tflex.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/local-dictionary-preflight.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/local-import-display.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-import-display.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/local-import-integrity.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-import-integrity.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/local-import-transaction.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-import-transaction.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/local-import.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-import.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/manager.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/manager.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/operation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/operation.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/opfs-store.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/opfs-store.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/quarantine-import-loader.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/quarantine-import-loader.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/rich-mdd-contract.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdd-contract.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/rich-mdd-lookup-cancellation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdd-lookup-cancellation.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/rich-mdd-resources.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdd-resources.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/rich-mdict-catalog-replacement.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-catalog-replacement.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/rich-mdict-contract.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-contract.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/rich-mdict-install-preflight.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-install-preflight.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/rich-mdict-lookup-controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-lookup-controller.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-rich-lookup-controller) |
| [src/background/packs/rich-mdict-preferences.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-preferences.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/rich-mdict.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict.js) | 词典导入与资源 | 待解释 · [局部边界](modules/selection.md#partial-router) |
| [src/background/packs/snapshot.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/snapshot.js) | 词典导入与资源 | 待解释 |
| [src/background/packs/state.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/state.js) | 词典导入与资源 | 待解释 |
| [src/background/preset-session.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/preset-session.js) | 启动与共享基础 | 待解释 |
| [src/background/providers/curated-dictionary-network.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/curated-dictionary-network.js) | Provider与设置 | 待解释 |
| [src/background/providers/deepseek.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/deepseek.js) | Provider与设置 | 待解释 |
| [src/background/providers/index.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/index.js) | Provider与设置 | 待解释 · [局部边界](modules/selection.md#partial-provider-cache) |
| [src/background/providers/local-translation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/local-translation.js) | Provider与设置 | 待解释 |
| [src/background/providers/openai-compatible.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/openai-compatible.js) | Provider与设置 | 待解释 |
| [src/background/providers/openai-sse.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/openai-sse.js) | Provider与设置 | 待解释 |
| [src/background/providers/pack-network.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/pack-network.js) | Provider与设置 | 待解释 |
| [src/background/providers/shared.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/providers/shared.js) | Provider与设置 | 待解释 |
| [src/background/reading-record/access.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/access.js) | Reading记录 | 待解释 |
| [src/background/reading-record/export-reader.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/export-reader.js) | Reading记录 | 待解释 |
| [src/background/reading-record/exports.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/exports.js) | Reading记录 | 待解释 |
| [src/background/reading-record/idb.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/idb.js) | Reading记录 | 待解释 |
| [src/background/reading-record/management.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/management.js) | Reading记录 | 待解释 |
| [src/background/reading-record/operations.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/operations.js) | Reading记录 | 待解释 |
| [src/background/reading-record/policy.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/policy.js) | Reading记录 | 待解释 |
| [src/background/reading-record/query.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/query.js) | Reading记录 | 待解释 |
| [src/background/reading-record/repository.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/repository.js) | Reading记录 | 待解释 |
| [src/background/reading-record/runtime.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/runtime.js) | Reading记录 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [src/background/reading-record/service.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/service.js) | Reading记录 | 待解释 |
| [src/background/reading-record/storage-state.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/storage-state.js) | Reading记录 | 待解释 |
| [src/background/reading-record/subscriptions.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/subscriptions.js) | Reading记录 | 待解释 |
| [src/background/reading-record/write.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/reading-record/write.js) | Reading记录 | 待解释 |
| [src/background/router.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js) | 启动与共享基础 | 待解释 · [局部边界](modules/selection.md#partial-router) · [关联说明](modules/startup.md#partial-files) |
| [src/background/selection/explain-prompt.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/selection/explain-prompt.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-explain-prompt) |
| [src/background/selection/explain.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/selection/explain.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-explain) |
| [src/background/selection/resolve.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/selection/resolve.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-resolve) |
| [src/background/subtitle-requests.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/subtitle-requests.js) | 启动与共享基础 | 待解释 |
| [src/background/translation-gateway.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/translation-gateway.js) | 网页翻译与缓存 | 待解释 |
| [src/background/translation-requests.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/translation-requests.js) | 网页翻译与缓存 | 待解释 |
| [src/background/youtube-bridge.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/youtube-bridge.js) | 字幕 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [src/content/appearance.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/appearance.js) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-content-appearance) |
| [src/content/auto.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/auto.js) | 网页翻译与缓存 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [src/content/batch.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/batch.js) | 网页翻译与缓存 | 待解释 |
| [src/content/dom.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/dom.js) | 网页翻译与缓存 | 待解释 |
| [src/content/processor.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/processor.js) | 网页翻译与缓存 | 待解释 |
| [src/content/quick-control-view.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/quick-control-view.js) | 网页翻译与缓存 | 待解释 |
| [src/content/quick-control.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/quick-control.js) | 网页翻译与缓存 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [src/content/runtime.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/runtime.js) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-content-runtime) |
| [src/content/selection/ai-detail.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/ai-detail.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-ai-detail) |
| [src/content/selection/clipboard.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/clipboard.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-clipboard) |
| [src/content/selection/context.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/context.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-context) |
| [src/content/selection/controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/controller.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-controller) · [关联说明](modules/startup.md#partial-files) |
| [src/content/selection/empty-state.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/empty-state.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-empty-state) |
| [src/content/selection/messages.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/messages.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-messages) |
| [src/content/selection/popover.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/popover.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-popover) |
| [src/content/selection/result-model.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/result-model.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-result-model) |
| [src/content/selection/result-renderer.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/result-renderer.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-result-renderer) |
| [src/content/selection/rich-details.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-details.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-rich-details) |
| [src/content/selection/rich-resource-path.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-resource-path.js) | 划词与词典查询 | 待解释 |
| [src/content/selection/rich-resource-resolver.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-resource-resolver.js) | 划词与词典查询 | 待解释 · [局部边界](modules/selection.md#partial-rich-rendering) |
| [src/content/selection/rich-sanitizer-style.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-sanitizer-style.js) | 划词与词典查询 | 待解释 |
| [src/content/selection/rich-sanitizer-tokenizer.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-sanitizer-tokenizer.js) | 划词与词典查询 | 待解释 |
| [src/content/selection/rich-sanitizer.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-sanitizer.js) | 划词与词典查询 | 待解释 · [局部边界](modules/selection.md#partial-rich-rendering) |
| [src/content/selection/rich-viewer.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-viewer.js) | 划词与词典查询 | 待解释 · [局部边界](modules/selection.md#partial-rich-rendering) |
| [src/content/selection/selection.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/selection.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-selection) |
| [src/content/selection/source-snapshot.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/source-snapshot.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-source-snapshot) |
| [src/content/structured.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/structured.js) | 网页翻译与缓存 | 待解释 |
| [src/content/subtitles/controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/controller.js) | 字幕 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [src/content/subtitles/pipeline.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/pipeline.js) | 字幕 | 待解释 |
| [src/content/subtitles/renderer.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/renderer.js) | 字幕 | 待解释 |
| [src/content/subtitles/source.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/source.js) | 字幕 | 待解释 |
| [src/content/subtitles/sources/text-track.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/sources/text-track.js) | 字幕 | 待解释 |
| [src/content/subtitles/sources/youtube.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/sources/youtube.js) | 字幕 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [src/content/subtitles/youtube-bridge-protocol.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/youtube-bridge-protocol.js) | 字幕 | 待解释 |
| [src/content/subtitles/youtube-main-bridge.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/youtube-main-bridge.js) | 字幕 | 待解释 |
| [src/content/subtitles/youtube-timedtext.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/subtitles/youtube-timedtext.js) | 字幕 | 待解释 |
| [src/content/tasks.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/tasks.js) | 网页翻译与缓存 | 待解释 · [局部边界](modules/selection.md#partial-source-and-tasks) |
| [src/content/text-projection-builder.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/text-projection-builder.js) | 网页翻译与缓存 | 待解释 · [局部边界](modules/selection.md#partial-source-and-tasks) |
| [src/content/text-projection-policy.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/text-projection-policy.js) | 网页翻译与缓存 | 待解释 · [局部边界](modules/selection.md#partial-source-and-tasks) |
| [src/content/text-projection.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/text-projection.js) | 网页翻译与缓存 | 待解释 · [局部边界](modules/selection.md#partial-source-and-tasks) |
| [src/content/ui/host.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/ui/host.js) | 扩展启动 | 已解释 · [逐文件说明](modules/startup.md#file-ui-host) |
| [src/content/ui/primitives.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/ui/primitives.js) | 界面基础 | 待解释 |
| [src/content/ui/quick-control-styles.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/ui/quick-control-styles.js) | 界面基础 | 待解释 |
| [src/content/ui/selection-ai-detail-styles.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/ui/selection-ai-detail-styles.js) | 界面基础 | 待解释 |
| [src/content/ui/selection-empty-state-styles.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/ui/selection-empty-state-styles.js) | 界面基础 | 待解释 |
| [src/content/ui/selection-lexical-styles.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/ui/selection-lexical-styles.js) | 界面基础 | 待解释 |
| [src/content/ui/toast.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/ui/toast.js) | 界面基础 | 待解释 |
| [src/content/ui/tokens.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/ui/tokens.js) | 界面基础 | 待解释 |
| [src/i18n/catalog.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/i18n/catalog.js) | 界面本地化 | 待解释 |
| [src/i18n/index.d.ts](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/i18n/index.d.ts) | 界面本地化 | 待解释 |
| [src/i18n/index.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/i18n/index.js) | 界面本地化 | 待解释 |
| [src/i18n/locale.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/i18n/locale.js) | 界面本地化 | 待解释 |
| [src/options/curated-dictionary-presentation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/curated-dictionary-presentation.js) | Provider与设置 | 待解释 |
| [src/options/curated-dictionary-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/curated-dictionary-ui.js) | Provider与设置 | 待解释 |
| [src/options/curated-ecdict-mdx-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/curated-ecdict-mdx-ui.js) | Provider与设置 | 待解释 |
| [src/options/dictionary-library-v2-presentation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/dictionary-library-v2-presentation.js) | Provider与设置 | 待解释 |
| [src/options/glossary-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/glossary-ui.js) | Provider与设置 | 待解释 |
| [src/options/installed-pack-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/installed-pack-ui.js) | Provider与设置 | 待解释 |
| [src/options/local-dictionary-import-presentation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/local-dictionary-import-presentation.js) | Provider与设置 | 待解释 |
| [src/options/local-dictionary-import-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/local-dictionary-import-ui.js) | Provider与设置 | 待解释 |
| [src/options/local-dictionary-installed-state.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/local-dictionary-installed-state.js) | Provider与设置 | 待解释 |
| [src/options/mdd-resource-import-controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/mdd-resource-import-controller.js) | Provider与设置 | 待解释 |
| [src/options/mdict-import-controller-io.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/mdict-import-controller-io.js) | Provider与设置 | 待解释 |
| [src/options/mdict-import-controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/mdict-import-controller.js) | Provider与设置 | 待解释 |
| [src/options/mdict-import-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/mdict-import-ui.js) | Provider与设置 | 待解释 |
| [src/options/pack-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/pack-ui.js) | Provider与设置 | 待解释 |
| [src/options/rich-mdict-import-controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/rich-mdict-import-controller.js) | Provider与设置 | 待解释 |
| [src/options/rich-mdict-import-copy.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/rich-mdict-import-copy.js) | Provider与设置 | 待解释 |
| [src/options/rich-mdict-import-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/rich-mdict-import-ui.js) | Provider与设置 | 待解释 |
| [src/options/rich-mdict-preferences-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/rich-mdict-preferences-ui.js) | Provider与设置 | 待解释 |
| [src/options/stardict-import-controller-io.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/stardict-import-controller-io.js) | Provider与设置 | 待解释 |
| [src/options/stardict-import-controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/stardict-import-controller.js) | Provider与设置 | 待解释 |
| [src/options/stardict-import-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/stardict-import-ui.js) | Provider与设置 | 待解释 |
| [src/options/tflex-local-import-controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/tflex-local-import-controller.js) | Provider与设置 | 待解释 |
| [src/options/ui-locale-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/ui-locale-ui.js) | Provider与设置 | 待解释 |
| [src/options/workers/curated-dictionary-worker-core.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/curated-dictionary-worker-core.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/curated-dictionary-worker-protocol.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/curated-dictionary-worker-protocol.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/curated-dictionary-worker.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/curated-dictionary-worker.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/curated-ecdict-mdx-worker-core.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/curated-ecdict-mdx-worker-core.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/curated-ecdict-mdx-worker-protocol.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/curated-ecdict-mdx-worker-protocol.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/curated-ecdict-mdx-worker.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/curated-ecdict-mdx-worker.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/mdd-resource-import-worker-core.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/mdd-resource-import-worker-core.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/mdd-resource-import-worker-protocol.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/mdd-resource-import-worker-protocol.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/mdd-resource-import-worker.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/mdd-resource-import-worker.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/mdict-import-worker-core.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/mdict-import-worker-core.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/mdict-import-worker-protocol.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/mdict-import-worker-protocol.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/mdict-import-worker.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/mdict-import-worker.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/rich-mdict-import-worker-core.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/rich-mdict-import-worker-core.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/rich-mdict-import-worker-protocol.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/rich-mdict-import-worker-protocol.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/rich-mdict-import-worker.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/rich-mdict-import-worker.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/stardict-import-worker-core.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/stardict-import-worker-core.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/stardict-import-worker-protocol.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/stardict-import-worker-protocol.js) | 词典导入与资源 | 待解释 |
| [src/options/workers/stardict-import-worker.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/stardict-import-worker.js) | 词典导入与资源 | 待解释 |
| [src/popup/preset-ui.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/popup/preset-ui.js) | 启动与共享基础 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [src/shared/appearance.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/appearance.js) | 启动与共享基础 | 待解释 |
| [src/shared/constants.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/constants.js) | 启动与共享基础 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [src/shared/curated-dictionaries.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/curated-dictionaries.js) | 启动与共享基础 | 待解释 |
| [src/shared/curated-ecdict-mdx-recipe.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/curated-ecdict-mdx-recipe.js) | 启动与共享基础 | 待解释 |
| [src/shared/dictionary-catalog-v2-artifacts.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/dictionary-catalog-v2-artifacts.js) | 启动与共享基础 | 待解释 |
| [src/shared/dictionary-catalog-v2-entries.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/dictionary-catalog-v2-entries.js) | 启动与共享基础 | 待解释 |
| [src/shared/dictionary-catalog-v2-schema.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/dictionary-catalog-v2-schema.js) | 启动与共享基础 | 待解释 |
| [src/shared/dictionary-catalog-v2-utils.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/dictionary-catalog-v2-utils.js) | 启动与共享基础 | 待解释 |
| [src/shared/dictionary-catalog-v2.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/dictionary-catalog-v2.js) | 启动与共享基础 | 待解释 |
| [src/shared/glossary.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/glossary.js) | 启动与共享基础 | 待解释 |
| [src/shared/hash.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/hash.js) | 启动与共享基础 | 待解释 |
| [src/shared/import-quarantine-contract.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/import-quarantine-contract.js) | 启动与共享基础 | 待解释 |
| [src/shared/lexical.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/lexical.js) | 启动与共享基础 | 待解释 |
| [src/shared/opfs-import-quarantine.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/opfs-import-quarantine.js) | 启动与共享基础 | 待解释 |
| [src/shared/pack-manager.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/pack-manager.js) | 启动与共享基础 | 待解释 |
| [src/shared/pack-sources.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/pack-sources.js) | 启动与共享基础 | 待解释 |
| [src/shared/presets.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/presets.js) | 启动与共享基础 | 待解释 |
| [src/shared/provider-config.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/provider-config.js) | 启动与共享基础 | 待解释 |
| [src/shared/reading/artifact.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/artifact.js) | Reading记录 | 待解释 |
| [src/shared/reading/constants.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/constants.js) | Reading记录 | 待解释 |
| [src/shared/reading/dto.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/dto.js) | Reading记录 | 待解释 |
| [src/shared/reading/export.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/export.js) | Reading记录 | 待解释 |
| [src/shared/reading/identity.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/identity.js) | Reading记录 | 待解释 |
| [src/shared/reading/invalidations.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/invalidations.js) | Reading记录 | 待解释 |
| [src/shared/reading/lifecycle.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/lifecycle.js) | Reading记录 | 待解释 |
| [src/shared/reading/list.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/list.js) | Reading记录 | 待解释 |
| [src/shared/reading/previews.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/previews.js) | Reading记录 | 待解释 |
| [src/shared/reading/record.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/record.js) | Reading记录 | 待解释 |
| [src/shared/reading/response.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/response.js) | Reading记录 | 待解释 |
| [src/shared/reading/source.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/source.js) | Reading记录 | 待解释 |
| [src/shared/reading/validation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/reading/validation.js) | Reading记录 | 待解释 |
| [src/shared/retry-policy.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/retry-policy.js) | 启动与共享基础 | 待解释 |
| [src/shared/runtime-assets.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/runtime-assets.js) | 启动与共享基础 | 待解释 |
| [src/shared/selection-explanation.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/selection-explanation.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-explanation-contract) |
| [src/shared/selection.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/selection.js) | 划词与词典查询 | 已解释 · [逐文件说明](modules/selection.md#file-selection-contract) |
| [src/shared/text.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/text.js) | 启动与共享基础 | 待解释 |
| [src/shared/url.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/url.js) | 启动与共享基础 | 待解释 · [局部边界](modules/startup.md#partial-files) |
| [src/ui/styles/components.css](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/ui/styles/components.css) | 界面基础 | 待解释 |
| [src/ui/styles/tokens.css](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/ui/styles/tokens.css) | 界面基础 | 待解释 |

## tests

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [tests/active-opfs-reader.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/active-opfs-reader.test.mjs) | 测试与验证 | 待解释 |
| [tests/appearance.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/appearance.test.mjs) | 测试与验证 | 待解释 |
| [tests/benchmark-translation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/benchmark-translation.test.mjs) | 测试与验证 | 待解释 |
| [tests/cache-context.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/cache-context.test.mjs) | 测试与验证 | 待解释 |
| [tests/cache-restore-mode.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/cache-restore-mode.test.mjs) | 测试与验证 | 待解释 |
| [tests/certify-vnext-dictionary-library.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/certify-vnext-dictionary-library.test.mjs) | 测试与验证 | 待解释 |
| [tests/commands.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/commands.test.mjs) | 测试与验证 | 待解释 |
| [tests/constants.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/constants.test.mjs) | 测试与验证 | 待解释 |
| [tests/core-bootstrap-evaluation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/core-bootstrap-evaluation.test.mjs) | 测试与验证 | 待解释 |
| [tests/curated-dictionary-recipes.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/curated-dictionary-recipes.test.mjs) | 测试与验证 | 待解释 |
| [tests/curated-ecdict-mdx-worker.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/curated-ecdict-mdx-worker.test.mjs) | 测试与验证 | 待解释 |
| [tests/dark-mode.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/dark-mode.test.mjs) | 测试与验证 | 待解释 |
| [tests/dictionary-catalog-v2.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/dictionary-catalog-v2.test.mjs) | 测试与验证 | 待解释 |
| [tests/dictionary-ecosystem-v2-certification.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/dictionary-ecosystem-v2-certification.test.mjs) | 测试与验证 | 待解释 |
| [tests/dictionary-library-v2-presentation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/dictionary-library-v2-presentation.test.mjs) | 测试与验证 | 待解释 |
| [tests/dictionary-pack-manager.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/dictionary-pack-manager.test.mjs) | 测试与验证 | 待解释 |
| [tests/dictionary-pack-ui.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/dictionary-pack-ui.test.mjs) | 测试与验证 | 待解释 |
| [tests/ecdict-curated.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/ecdict-curated.test.mjs) | 测试与验证 | 待解释 |
| [tests/ecdict-mdx-package-boundary.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/ecdict-mdx-package-boundary.test.mjs) | 测试与验证 | 待解释 |
| [tests/ecdict-mdx-recipe-lock.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/ecdict-mdx-recipe-lock.test.mjs) | 测试与验证 | 待解释 |
| [tests/ecdict-mdx-zip.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/ecdict-mdx-zip.test.mjs) | 测试与验证 | 待解释 |
| [tests/extension-footprint-cost.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/extension-footprint-cost.test.mjs) | 测试与验证 | 待解释 |
| [tests/fixtures/lexical-quality-v1.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/lexical-quality-v1.json) | 测试与验证 | 待解释 |
| [tests/fixtures/lexical-ranking-v1.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/lexical-ranking-v1.json) | 测试与验证 | 待解释 |
| [tests/fixtures/mdd-interop/corpus-lock.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/mdd-interop/corpus-lock.json) | 测试与验证 | 待解释 |
| [tests/fixtures/mdd-interop/interop.mdd](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/mdd-interop/interop.mdd) | 测试与验证 | 待解释 |
| [tests/fixtures/mdd-interop/interop.mdx](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/mdd-interop/interop.mdx) | 测试与验证 | 待解释 |
| [tests/fixtures/ordinary-browsing-v1.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/ordinary-browsing-v1.json) | 测试与验证 | 待解释 |
| [tests/fixtures/reading/access.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/reading/access.mjs) | 测试与验证 | 待解释 |
| [tests/fixtures/reading/contract.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/reading/contract.mjs) | 测试与验证 | 待解释 |
| [tests/fixtures/reading/marker-measurement.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/reading/marker-measurement.json) | 测试与验证 | 待解释 |
| [tests/fixtures/reading/measurement.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/reading/measurement.json) | 测试与验证 | 待解释 |
| [tests/fixtures/reading/storage.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/reading/storage.mjs) | 测试与验证 | 待解释 |
| [tests/fixtures/rich-lookup-cancellation-baseline.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/rich-lookup-cancellation-baseline.json) | 测试与验证 | 待解释 |
| [tests/fixtures/selection-v2-quality.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/selection-v2-quality.json) | 测试与验证 | 待解释 |
| [tests/fixtures/tflex-core/index.sense](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/tflex-core/index.sense) | 测试与验证 | 待解释 |
| [tests/fixtures/tflex-core/source-lock.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/tflex-core/source-lock.json) | 测试与验证 | 待解释 |
| [tests/fixtures/tflex-core/wn-data-cmn.tab](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/tflex-core/wn-data-cmn.tab) | 测试与验证 | 待解释 |
| [tests/fixtures/tflex-core/wn-data-eng.tab](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/tflex-core/wn-data-eng.tab) | 测试与验证 | 待解释 |
| [tests/fixtures/tflex-runtime-pack/THIRD_PARTY_NOTICES.txt](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/tflex-runtime-pack/THIRD_PARTY_NOTICES.txt) | 测试与验证 | 待解释 |
| [tests/fixtures/tflex-runtime-pack/directory.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/tflex-runtime-pack/directory.json) | 测试与验证 | 待解释 |
| [tests/fixtures/tflex-runtime-pack/manifest.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/tflex-runtime-pack/manifest.json) | 测试与验证 | 待解释 |
| [tests/fixtures/tflex-runtime-pack/shards/0000.jsonl](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/tflex-runtime-pack/shards/0000.jsonl) | 测试与验证 | 待解释 |
| [tests/fixtures/wikidata-tech-lock.json](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/fixtures/wikidata-tech-lock.json) | 测试与验证 | 待解释 |
| [tests/freedict-product-gate.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/freedict-product-gate.test.mjs) | 测试与验证 | 待解释 |
| [tests/freedict-source-audit.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/freedict-source-audit.test.mjs) | 测试与验证 | 待解释 |
| [tests/freedict-source-lock.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/freedict-source-lock.test.mjs) | 测试与验证 | 待解释 |
| [tests/glossary.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/glossary.test.mjs) | 测试与验证 | 待解释 |
| [tests/helpers/mdd-fixture.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/helpers/mdd-fixture.mjs) | 测试与验证 | 待解释 |
| [tests/helpers/mdict-fixture.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/helpers/mdict-fixture.mjs) | 测试与验证 | 待解释 |
| [tests/helpers/rich-mdict-fixture.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/helpers/rich-mdict-fixture.mjs) | 测试与验证 | 待解释 |
| [tests/helpers/rich-viewer-security-fixture.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/helpers/rich-viewer-security-fixture.mjs) | 测试与验证 | 待解释 |
| [tests/i18n-boundaries.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/i18n-boundaries.test.mjs) | 测试与验证 | 待解释 |
| [tests/i18n-locales.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/i18n-locales.test.mjs) | 测试与验证 | 待解释 |
| [tests/i18n.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/i18n.test.mjs) | 测试与验证 | 待解释 |
| [tests/integrated-lexical-certification.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/integrated-lexical-certification.test.mjs) | 测试与验证 | 待解释 |
| [tests/kaikki-rich-projection.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/kaikki-rich-projection.test.mjs) | 测试与验证 | 待解释 |
| [tests/kaikki-source-lock.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/kaikki-source-lock.test.mjs) | 测试与验证 | 待解释 |
| [tests/lexical-context-phrase.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/lexical-context-phrase.test.mjs) | 测试与验证 | 待解释 |
| [tests/lexical-gateway.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/lexical-gateway.test.mjs) | 测试与验证 | 待解释 · [局部边界](modules/selection.md#test-boundaries) |
| [tests/lexical-quality-benchmark.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/lexical-quality-benchmark.test.mjs) | 测试与验证 | 待解释 |
| [tests/lexical-ranking.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/lexical-ranking.test.mjs) | 测试与验证 | 待解释 |
| [tests/lexicon-source-audit.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/lexicon-source-audit.test.mjs) | 测试与验证 | 待解释 |
| [tests/local-dictionary-import-presentation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/local-dictionary-import-presentation.test.mjs) | 测试与验证 | 待解释 |
| [tests/local-dictionary-preflight.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/local-dictionary-preflight.test.mjs) | 测试与验证 | 待解释 |
| [tests/local-import-display.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/local-import-display.test.mjs) | 测试与验证 | 待解释 |
| [tests/local-tflex-import.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/local-tflex-import.test.mjs) | 测试与验证 | 待解释 |
| [tests/local-translation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/local-translation.test.mjs) | 测试与验证 | 待解释 |
| [tests/mdd-format.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/mdd-format.test.mjs) | 测试与验证 | 待解释 |
| [tests/mdd-security.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/mdd-security.test.mjs) | 测试与验证 | 待解释 |
| [tests/mdict-browser-import.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/mdict-browser-import.test.mjs) | 测试与验证 | 待解释 |
| [tests/mdict-compatibility-inspector.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/mdict-compatibility-inspector.test.mjs) | 测试与验证 | 待解释 |
| [tests/mdict-import-controller.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/mdict-import-controller.test.mjs) | 测试与验证 | 待解释 |
| [tests/mdict-import-poc.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/mdict-import-poc.test.mjs) | 测试与验证 | 待解释 |
| [tests/multi-dictionary-viewer.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/multi-dictionary-viewer.test.mjs) | 测试与验证 | 待解释 |
| [tests/offline-dictionary-beta-certification.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/offline-dictionary-beta-certification.test.mjs) | 测试与验证 | 待解释 |
| [tests/openai-sse.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/openai-sse.test.mjs) | 测试与验证 | 待解释 |
| [tests/opfs-import-quarantine.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/opfs-import-quarantine.test.mjs) | 测试与验证 | 待解释 |
| [tests/opfs-indexed-reader.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/opfs-indexed-reader.test.mjs) | 测试与验证 | 待解释 |
| [tests/opfs-pack-store.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/opfs-pack-store.test.mjs) | 测试与验证 | 待解释 |
| [tests/pack-network.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/pack-network.test.mjs) | 测试与验证 | 待解释 |
| [tests/popup-ux.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/popup-ux.test.mjs) | 测试与验证 | 待解释 |
| [tests/presets.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/presets.test.mjs) | 测试与验证 | 待解释 |
| [tests/provider-config.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/provider-config.test.mjs) | 测试与验证 | 待解释 |
| [tests/provider-retry.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/provider-retry.test.mjs) | 测试与验证 | 待解释 |
| [tests/provider-structured-json.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/provider-structured-json.test.mjs) | 测试与验证 | 待解释 |
| [tests/providers.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/providers.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-access-concurrency.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-access-concurrency.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-access-inline.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-access-inline.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-access-postmerge.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-access-postmerge.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-access.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-access.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-contract-dto.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-contract-dto.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-contract-lifecycle.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-contract-lifecycle.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-contract-response.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-contract-response.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-contract-v2.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-contract-v2.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-operations.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-operations.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-runtime-storage.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-runtime-storage.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-source-position.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-source-position.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-storage-helpers.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-storage-helpers.test.mjs) | 测试与验证 | 待解释 |
| [tests/reading-text-projection.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-text-projection.test.mjs) | 测试与验证 | 待解释 · [局部边界](modules/selection.md#test-boundaries) |
| [tests/reading-ui.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reading-ui.test.mjs) | 测试与验证 | 待解释 |
| [tests/release-gate.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/release-gate.test.mjs) | 测试与验证 | 待解释 |
| [tests/release-lexicon-contract.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/release-lexicon-contract.test.mjs) | 测试与验证 | 待解释 |
| [tests/resolve-ecosystem-certification-base.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/resolve-ecosystem-certification-base.test.mjs) | 测试与验证 | 待解释 |
| [tests/retry-policy.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/retry-policy.test.mjs) | 测试与验证 | 待解释 |
| [tests/reviewed-tech-terms.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/reviewed-tech-terms.test.mjs) | 测试与验证 | 待解释 |
| [tests/rich-dictionary-sanitizer.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-dictionary-sanitizer.test.mjs) | 测试与验证 | 待解释 |
| [tests/rich-mdd-lookup-cancellation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdd-lookup-cancellation.test.mjs) | 测试与验证 | 待解释 |
| [tests/rich-mdict-format.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdict-format.test.mjs) | 测试与验证 | 待解释 |
| [tests/rich-mdict-lookup-cancellation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdict-lookup-cancellation.test.mjs) | 测试与验证 | 待解释 · [局部边界](modules/selection.md#test-boundaries) |
| [tests/rich-mdict-preferences.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdict-preferences.test.mjs) | 测试与验证 | 待解释 |
| [tests/rich-mdict-product.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdict-product.test.mjs) | 测试与验证 | 待解释 |
| [tests/rich-mdict-security.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdict-security.test.mjs) | 测试与验证 | 待解释 |
| [tests/rich-mdict-storage.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdict-storage.test.mjs) | 测试与验证 | 待解释 |
| [tests/rich-resource-resolver.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-resource-resolver.test.mjs) | 测试与验证 | 待解释 |
| [tests/rich-viewer-contract.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-viewer-contract.test.mjs) | 测试与验证 | 待解释 |
| [tests/selection-content-owner.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-content-owner.test.mjs) | 测试与验证 | 待解释 · [局部边界](modules/selection.md#test-boundaries) |
| [tests/selection-explain-runtime.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-explain-runtime.test.mjs) | 测试与验证 | 待解释 · [局部边界](modules/selection.md#test-boundaries) |
| [tests/selection-explanation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-explanation.test.mjs) | 测试与验证 | 待解释 · [局部边界](modules/selection.md#test-boundaries) |
| [tests/selection-multi-dictionary.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-multi-dictionary.test.mjs) | 测试与验证 | 待解释 · [局部边界](modules/selection.md#test-boundaries) |
| [tests/selection-release-certification.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-release-certification.test.mjs) | 测试与验证 | 待解释 |
| [tests/selection-result-model.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-result-model.test.mjs) | 测试与验证 | 待解释 · [局部边界](modules/selection.md#test-boundaries) |
| [tests/selection-ui-contract.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-ui-contract.test.mjs) | 测试与验证 | 待解释 · [局部边界](modules/selection.md#test-boundaries) |
| [tests/selection-v2.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/selection-v2.test.mjs) | 测试与验证 | 待解释 · [局部边界](modules/selection.md#test-boundaries) |
| [tests/settings-ia.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/settings-ia.test.mjs) | 测试与验证 | 待解释 |
| [tests/setup-lexicon.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/setup-lexicon.test.mjs) | 测试与验证 | 待解释 |
| [tests/site-registration.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/site-registration.test.mjs) | 测试与验证 | 待解释 |
| [tests/source-boundaries.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/source-boundaries.test.mjs) | 测试与验证 | 待解释 |
| [tests/stardict-browser-dictzip.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/stardict-browser-dictzip.test.mjs) | 测试与验证 | 待解释 |
| [tests/stardict-import-controller.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/stardict-import-controller.test.mjs) | 测试与验证 | 待解释 |
| [tests/stardict-import-cost.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/stardict-import-cost.test.mjs) | 测试与验证 | 待解释 |
| [tests/stardict-import-poc.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/stardict-import-poc.test.mjs) | 测试与验证 | 待解释 |
| [tests/stardict-import-ui.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/stardict-import-ui.test.mjs) | 测试与验证 | 待解释 |
| [tests/stardict-import-worker.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/stardict-import-worker.test.mjs) | 测试与验证 | 待解释 |
| [tests/structured.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/structured.test.mjs) | 测试与验证 | 待解释 |
| [tests/subtitle-cache-identity.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/subtitle-cache-identity.test.mjs) | 测试与验证 | 待解释 |
| [tests/subtitle-pipeline.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/subtitle-pipeline.test.mjs) | 测试与验证 | 待解释 |
| [tests/subtitles.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/subtitles.test.mjs) | 测试与验证 | 待解释 |
| [tests/tasks.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/tasks.test.mjs) | 测试与验证 | 待解释 |
| [tests/text.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/text.test.mjs) | 测试与验证 | 待解释 |
| [tests/tflex-builder.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/tflex-builder.test.mjs) | 测试与验证 | 待解释 |
| [tests/tflex-freedict-builder.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/tflex-freedict-builder.test.mjs) | 测试与验证 | 待解释 |
| [tests/tflex-local-import-controller.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/tflex-local-import-controller.test.mjs) | 测试与验证 | 待解释 |
| [tests/tflex-mdict-import.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/tflex-mdict-import.test.mjs) | 测试与验证 | 待解释 |
| [tests/tflex-reader.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/tflex-reader.test.mjs) | 测试与验证 | 待解释 |
| [tests/tflex-stardict-import.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/tflex-stardict-import.test.mjs) | 测试与验证 | 待解释 |
| [tests/tflex-technical-builder.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/tflex-technical-builder.test.mjs) | 测试与验证 | 待解释 |
| [tests/translation-gateway.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/translation-gateway.test.mjs) | 测试与验证 | 待解释 |
| [tests/translation-requests.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/translation-requests.test.mjs) | 测试与验证 | 待解释 |
| [tests/ui-design-system.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/ui-design-system.test.mjs) | 测试与验证 | 待解释 |
| [tests/ui-foundation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/ui-foundation.test.mjs) | 测试与验证 | 待解释 |
| [tests/ui-release-gate.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/ui-release-gate.test.mjs) | 测试与验证 | 待解释 |
| [tests/unit/consent-control.test.tsx](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/unit/consent-control.test.tsx) | 测试与验证 | 待解释 |
| [tests/unit/fixtures/ConsentControl.tsx](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/unit/fixtures/ConsentControl.tsx) | 测试与验证 | 待解释 |
| [tests/unit/i18n.test.ts](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/unit/i18n.test.ts) | 测试与验证 | 待解释 |
| [tests/unit/text.test.ts](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/unit/text.test.ts) | 测试与验证 | 待解释 |
| [tests/url.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/url.test.mjs) | 测试与验证 | 待解释 |
| [tests/wikidata-tech-lock.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/wikidata-tech-lock.test.mjs) | 测试与验证 | 待解释 |
| [tests/wikimedia-enwiktionary-source-lock.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/wikimedia-enwiktionary-source-lock.test.mjs) | 测试与验证 | 待解释 |
| [tests/wiktextract-extraction-evidence.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/wiktextract-extraction-evidence.test.mjs) | 测试与验证 | 待解释 |
| [tests/wiktextract-ingest.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/wiktextract-ingest.test.mjs) | 测试与验证 | 待解释 |
| [tests/wiktextract-rich-projection.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/wiktextract-rich-projection.test.mjs) | 测试与验证 | 待解释 |
| [tests/wxt-assets.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/wxt-assets.test.mjs) | 测试与验证 | 待解释 |
| [tests/youtube-bridge.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/youtube-bridge.test.mjs) | 字幕 | 待解释 |

## types

| 文件（固定源码） | 功能分组 | 状态 / 正文 |
| --- | --- | --- |
| [types/wxt-compat.d.ts](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/types/wxt-compat.d.ts) | 启动与共享基础 | 待解释 |
