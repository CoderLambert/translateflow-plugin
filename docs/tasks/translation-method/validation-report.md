# 单词与句段独立翻译偏好的本地验收

## 合并前候选验收（最新）

用户已于本轮明确授权提交、推送并合并 main；PR [#365](https://github.com/CoderLambert/translateflow-plugin/pull/365)。实现候选为 `e6db041b17e434c46b2fa4b8efdfd2625314ca83`，版本 **0.8.42**，基线 `49fb4ed7dcbdc49684d79803e0640b2b9fa093c0`。此前未提交记录和 0.8.40 指纹均为历史证据。

- `npm run validate`：PASS；1,952 Node、13 files / 77 Vitest、严格 TS、静态/i18n 检查和默认 WXT 构建；55,045.787 ms。
- `npm run build:extension:wxt`：PASS；2,600.837 ms。
- 任务 state 内四份相关 E2E：PASS；真实 Chromium/MV3 37 PASS、1 SKIP、0 FAIL；51,026.258 ms。Chrome for Testing 153.0.8010.12，串行运行、无重试。
- 默认包与显式包 inventory SHA-256 均为 `1bcf7fb654e812ce4a5a3eea67b0a97aec2afac032fd22d6a58b2176e8fe5d9d`；131 文件、3,038,597 bytes。`acceptance.json` 的 artifact 字段使用 local-task 自身路径/内容指纹算法，数值与 inventory 算法不同。

三项检查由既有 local-task wrapper 在准确候选上执行；逐项命令、单调耗时、原始日志路径/hash、环境和实际产物指纹见 `acceptance.json`。原始日志仅保留在忽略的本地执行目录中。

首个候选 `cfd24b1` 的完整检查有 1,951 Node PASS / 1 FAIL，旧 Reading classic 投影遗漏了共享文案更新。通过 `node scripts/reading-content-classic.mjs` 从唯一 owner 重新生成，定向失败项通过后提交为当前候选；没有直接修改生成内容或放宽测试。保留首轮失败记录，在构建输入修正与版本准备后重新绑定当前候选全部要求。

主 Agent 已核对实际 diff 与调用链，复用未改变代码的先前自查；检查当前临时方式隔离、可信点击、来源、字体/焦点、取消与偏好快照、生成投影和安装包边界。没有未解决阻断问题；这不是独立模型审核。用户接受当前 UI，未继续扩展设计。新增的 DNR 权限来自同时交付的免费 MT 路由，仅为本扩展发往 B站固定端点的 POST 设置会话规则；偏好/本地句段本身不增加权限或扩大单词 Port。

限制：外部 Provider 与多数本地模型为合成测试；真实能力探测 Translator=`downloadable`、LanguageDetector=`unavailable`，对应真实模型用例跳过，无下载/付费请求。真实 Chrome 102、国内直连/海外双网络、商店发布和原 Chrome 实例重载均未验证。不得把 mock 成功或安装目录替换当作这些验收成功。

## 先前未提交开发记录（历史）

2026-10-20；主 Agent 串行实施与自查。未启动子 Agent，不是独立模型审核。
工作区 `translateflow-translation-method`，分支 `fix/simplify-translation-method-20261020`，基线 `49fb4ed7dcbdc49684d79803e0640b2b9fa093c0`。
保留既有免费 MT v2 和 UI 的未提交实现；本次前的修改已备份在 Git 忽略的执行目录。原主工作区仍无未提交修改。
未提交、推送、合并或发布；candidateHead/syncHead/mergeHead 为 null。以文件清单及包指纹绑定本地证据，不声称冻结候选或 local gate PASS。

用户截图反馈后的交互调整、当前安装指纹与定向验收见 [划选方式切换优化](selection-ux-validation.md)。下方保留前一轮偏好改造的历史证据，其包指纹不再代表当前安装包。

## 已实现

- `translationPreferences` v1 独立保存全局 wordMethod / textMethod；网站仅覆盖 textMethod。单词默认免费在线；句段仅首次按完整 AI 配置、明确可用模型、免费在线确定。资源变化不重新选择。
- 可信偏好读取／保存消息、旧设置迁移和旧保存入口的 PREFERENCES_REOPEN。保留网站明确选择、词典、凭据、语言、Prompt 和缓存；旧路由开关不再竞争。
- 所选方式唯一执行；词典 miss、缺模型、AI 配置错误、在线错误、缺确认和拒绝权限均不跨方式调用。在线内部自动／固定服务沿用 v2。默认与联网确认独立。
- Options 两个正常尺寸的单选区与一个保存入口，显示保存值、待应用值、资源状态。Popup 仅编辑本站句段，展示只读单词偏好，主按钮先授权、保存再翻译。
- 划选区分词和句段，提供内容类型纠正与临时方式；初版点击「仅本次使用」才执行（最新交互改为展开后直接点击方式按钮），不将控件编辑当成联网操作。新选区恢复保存方式。结果及缓存标注实际来源。
- Chrome 本地短语、句子和段落使用 Content 本地 runtime；共享 Port 继续只接受单词。复用语言检测、结构保护、取消与缓存快照；配置代次阻止旧结果在偏好变化后重新建快照写回。未新增权限或隐藏页面。

主要 owner：`src/shared/translation-preferences.js`、`src/background/translation-preferences.js`、`browser-translation.js`、`effective-config-snapshots.js`、Selection resolver、Content translation client / Selection method controls、Options / Popup。
生产资源仍从 WXT 模块图构建；重新生成旧 Reading classic 投影，没有直接修补安装包。

## 实际验证

原始日志、截图、输入清单与安装记录位于 `docs/task-execution/local/translation-method/`（Git 忽略）。

| 命令／证据 | 结果 |
| --- | --- |
| `npm run validate` | PASS；`preferences-validate-final-current.log`。源码／i18n、1,952 Node、严格 TypeScript、13 files / 77 Vitest、默认 WXT 包与资源审计全部成功。 |
| `npm run build:extension:wxt` | PASS；`preferences-build-delivery.log`。显式包与默认包逐文件指纹相同。 |
| `TF_TEST_WORKERS=1 npm run test:e2e -- e2e/translation-method.spec.mjs e2e/translation-preferences.spec.mjs e2e/browser-basic-translation.spec.mjs e2e/machine-translation.spec.mjs --retries=0` | 首次广回归 35 PASS / 1 FAIL / 1 SKIP；FAIL 是测试错误地期望已缓存的 AI 结果新增请求，日志 `preferences-e2e-complete.log`。其余有效结果保留。 |
| `TF_TEST_WORKERS=1 npm run test:e2e -- e2e/translation-method.spec.mjs e2e/translation-preferences.spec.mjs e2e/browser-basic-translation.spec.mjs --grep 'AI stays preferred\|Options preserves\|Options reads' --retries=0` | PASS，3 / 3；修正失败场景，补验视觉修复涉及的两个设置流程。日志 `preferences-e2e-recovery.log`。合计 36 个不同场景通过、1 个真实模型环境跳过。 |
| 真实模型能力 | Translator=`downloadable`、LanguageDetector=`unavailable`；仅 availability 探测，没有 create、下载或真实推理。因此真实本地模型句段、离线语义质量为 NOT VERIFIED。 |
| `git diff --check` | PASS。 |

MV3 流程使用真实 Chromium、生产扩展、后台消息／权限入口、IndexedDB 和持久 profile；外部响应及大部分本地模型为合成 mock，不代表真实微软／腾讯／其它免费服务、真实 AI 或真实模型成功。浏览器测试覆盖临时切换、词典命中／未命中、未授权零请求、AI／模型失败、缓存来源、取消／导航、网站默认恢复、旧配置迁移、重启与 UI 保存失败。

首轮路由／UI 测试发现并修复来源标签未渲染、MT 提示被当作字面字符串、旧开关残留、配置代次失效及旧测试断言。最终完整 validate 前的失败日志保留；没有删除断言、放宽安全合同或扩大文件行数门槛。视觉检查发现普通 input 样式撑大单选按钮，修正后在 390px 明／暗色截图确认；最终 E2E 同时断言单选控件尺寸、无水平溢出与保存按钮可达。

全量浏览器回归后，生产输入仅 `options.css` 改变；另外变化为两份 E2E fixture 与 README 文案。`preferences-inputs-delivery.json` 保存逐文件对照；未变化的 35 项通过证据复用，失败项与 CSS 影响流程已重验。

## 指纹与安装

最终输入清单 1,013 文件，SHA-256 `6959c985c1cbe94520f9c6fdd1ca37004d017977355ed68787d0ac7744c844c5`。
最终安装包 v0.8.40：131 文件、3,030,498 bytes、词典内容 0 bytes，SHA-256 `e482e168e941f7654bedf3e2b3e2533c4fb2ae375dc46ba1bc0816c414fc37e5`。

已核对 Chrome 登记的扩展 ID `<local-extension-id>`，安装目录：
`<local-install-directory>`。
通过既有 path-boundaries 检查真实路径、所有权、目录关系和符号链接；先复制并验证暂存包，再备份旧目录并替换，之后复核安装包与备份指纹。

备份：`<local-backup-directory>`。
旧包 SHA-256 `6daf3974c287e4133b3f76ddd0fbbd292a1ecb1e76b6d3b7f93bebb191b7bac6`。
安装记录：`preferences-delivery.json`；稳定包、显式包、安装目录三者指纹一致。

原 Chrome profile 的重新加载：BLOCKED。浏览器工具的 URL 策略拒绝 `chrome://extensions`，没有换工具绕过。用户需在 Chrome 扩展管理页为 TranslateFlow 点击一次「重新加载」，再刷新已有网页。本报告不把磁盘替换当成原实例已经加载或商店更新。

公开记录已移除个人 home 路径与本机扩展身份；准确安装路径、扩展 ID 和备份位置仅保存在 Git 忽略的本地安装记录中。
