# 构建、实际产物与测试到安装升级

> 2026-10-04 返回原文增量：增量到 main `33ab3ea2a38ce591b622ba06739344858d7da403`：新增 reading-content-classic.mjs 从两个owned entry生成 reading-source.js/reading-record.js（minified、自包含IIFE、chrome102编译目标），check按字节防漂移。详见[三个脚本、测试与rich-details前序](../modules/reading-return-to-page.md#classic-order)及[实际用户返回链](reading-return-to-page.md)。raw bridge依然按CONTENT_SCRIPT_FILES装配，不把这些模块误写为运行时ESM；生成输出不能手改，本轮没有运行生成/构建。其余本章保留既有固定版本。

> 已将构建配置/audit/固定路径/相关测试和操作规范全文复核到 b606cfd。下文未变实现保留旧固定来源；大型升级 spec 等尚未全文复核的局部说明继续明确标为历史边界。

[逐文件说明](../modules/build-test-release.md) · [启动链](extension-startup.md) · [首页](../README.md)

本章当前清单固定 main `b606cfd556792d9764d0b15461b7a142fcd99575`，2026-10-03 复核；本轮八份完整复读的文件与正文见[模块章](../modules/build-test-release.md)。其它旧引用仅按相同 blob 连续性沿用，不把未复读文件自动计完整。当前默认构建已切换为 WXT，旧的“默认 legacy / WXT opt-in”与“#278 未合入”不再描述本基线。所有安装、构建、脚本、Node/Vitest、浏览器、CI 和发布验证在本轮均 **NOT_RUN**。下文“断言/报告”指源码定义，非本轮 PASS；也不从历史记录推导 realOxford 通过。

## 1. 用户入口与两个输出目录

开发者修改源码后，产物必须先构建，再交给指定消费者。安装用户加载产物目录，Chrome 依 Manifest 启动后台和扩展页面；Content/MAIN/Worker 仍走[启动链](extension-startup.md)的各自路径。

| 入口 | 实际调用与输出 | 能证明/不能证明 |
| --- | --- | --- |
| `npm run validate` | check → Node `tests/*.test.mjs` → typecheck → Vitest → build:extension | 最后经 WXT 构建并审计到 `dist/extension`；不包含浏览器 E2E 或完整词典发布认证 |
| `npm run build:extension` | `scripts/build-extension.mjs` → 独立 staging WXT → audit → 复制 | 默认 WXT 安装包 `dist/extension`；开发构建可显式报告生成词典缺失 |
| `npm run build:extension:release` | 同脚本 `--require-lexicon` | 同一 WXT 引擎；要求内置包齐备且通过 manifest/descriptor 完整性检查，不等于词典质量或发布认证 |
| `npm run build:extension:wxt` | 同脚本 `--out .output/chrome-mv3` | 同一生产引擎和 audit，另输出该目录及 `.wxt/reports`；不是另一套 legacy/WXT 实现 |
| `npm run test:wxt:smoke` | audit → `.output/chrome-mv3` 临时副本 → 有限 Chromium 流程 | 不自动 build，不自动选 `dist`；不等于完整 E2E/升级/发布 |
| `npm run test:e2e` | run-e2e → Playwright | 默认消费已有 `.output/chrome-mv3`；显式选包，缺包失败不回退 |
| `npm run test:e2e:rich-mdict` | 同 wrapper，限定两个 spec | 同样默认 `.output/chrome-mv3`，不是隐式构建入口 |

需要区分的是**默认构建目录与默认 E2E 消费目录**，不是两个构建引擎。只执行 validate 不会更新 `.output/chrome-mv3`：该目录缺失时 E2E 失败；若残留旧包，E2E 可能仍消费旧字节。要验收刚生成的稳定安装包，明确用 `TF_E2E_ARTIFACT=dist/extension npm run test:e2e`；wrapper 会在未另设时令 `TF_I18N_ARTIFACT` 跟随。要用默认 E2E / standalone smoke，先构建显式 WXT 输出。路径存在或来源标签都不足以证明包为本候选，见[package 路由](../modules/build-test-release.md#package-routing)。

> #287当前安装包经[production-manifest](../modules/real-entry.md#file-projection)在普通HTTP/HTTPS静态document_idle加载Content，required权限已扩大；历史“无静态注入/权限不变”只属原候选。本轮没有构建、运行或认证。

## 2. 源码 → 审计通过的 WXT 产物 → 安装目录

[buildExtension](../modules/build-test-release.md#file-build-extension)先执行[输出安全检查](../modules/build-test-release.md#file-path-boundaries)，再为每次调用分配独立 OS 临时 staging。子进程用当前 Node 调仓库 WXT CLI；`TF_WXT_BUILD_ROOT` 将构建输出和 reports 导向本次 staging，`TRANSLATEFLOW_WXT_REQUIRE_LEXICON` 由 requireLexicon 决定。构建完成后 audit staging 中的真实包；仅通过后再次检查目标，才 rm → mkdir → cp 到最终安装目录。显式 `.output/chrome-mv3` 输出还复制 reports 到 `.wxt/reports`；默认 dist 的 staging reports 随清理删除，不能假设它更新了 standalone smoke 使用的报告。

构建或 audit 失败时尚未删除现有安装目录；但最终复制不是原子 rename/事务，rm 后发生 mkdir/cp/报告复制故障仍可能留下空/不完整目录，finally 清 staging 也不回滚最终输出。独立 staging 避免中间产物冲突，不等于对同一最终目录提供跨进程锁。不能仅凭目录存在宣称构建完成。

WXT 由 [wxt.config.mjs](../modules/build-test-release.md#file-wxt-config)配置：background.ts 复用 initializeBackground，Popup/Options 注册原 HTML 源供 Vite 编译，保留安装路径、options_page 和 Manifest 语义。Content 的有序列表、MAIN 及 Worker roots 经 [raw 资产闭包](../modules/build-test-release.md#file-wxt-assets)逐文件复制；没有把整个 src 当 public。资产集合排序便于打包/比对，运行脚本顺序仍来自 CONTENT_SCRIPT_FILES。

学习中心沿 `entrypoints/learning-center/index.html → main.tsx → App` 编译为第三个固定页面 `learning-center.html`。配置在 **writeBundle** 记录最终输出，并把目录 HTML 名映射为安装名；运行时固定打开路径、current mapping、audit 的页面集合共用 [runtime-assets](../modules/build-test-release.md#file-runtime-assets)。缺页面会在产物 mapping/精确集合层失败，不应通过复制整仓资源修复。

生成词典不是 Git 内已有可安装数据。每个 TFLex 包按 manifest 明确声明、fingerprint、descriptor hash/size、role 和真实路径核验文件；开发缺包列入 missing，release 通过 requireLexicon 强制所有内置包就绪。它证明声明与字节完整性，不替代来源、词汇质量、真实词典兼容性或发行准入。

[audit](../modules/build-test-release.md#file-audit)检查Manifest与production-manifest生成的批准静态投影全部字段deepEqual、精确资产集合、raw/词典/locale 源字节、编译依赖、禁入测试/开发资源并限制React只在学习中心闭包、HTML 本地引用及代码体积预算。React 允许范围由学习页面与 background/Popup/Options 的静态+动态可达闭包相减判定，共享给旧运行时的 React chunk 仍拒绝。平台上限只约束 `codeBytes − 学习中心独占 bytes`，共享 chunk 不扣除；没有新增学习中心专属上限。报告的 background/ui 展示统计另只追静态 imports，不能混作安全闭包或相加当互斥包分区。reports 属构建证据，不进入安装包。build/audit 成功也不证明 Chrome 102 运行或真实网站兼容。

## 3. 输出删除和测试副本的安全边界

#278 对应的 [path-boundaries](../modules/build-test-release.md#file-path-boundaries)已在本 main 实现：先规范化，再区分 same/descendant/ancestor/disjoint；默认只允许 dist 的严格子目录，或 builder 显式许可的精确 `.output/chrome-mv3`。源码根、祖先、磁盘根、dist 自身和其它源码子目录均拒绝。allowExternalOutput 只为源码外且位于 OS 临时目录严格子级的输出开放，不能解释为可删除任意外部目录。

磁盘检查解析已存在祖先的 canonical path，检查受信任 source/temp 根以下的目标路径，拒绝符号链接、非目录、其它 Git 工作区；递归扫目标树时也拒绝任意深度 .git（大小写不敏感）及 symlink。测试副本还必须与源产物在词法和 canonical 两层不相交，且位于临时目录。OS temp 根本身可能是系统别名，只有受信任根允许这种情况。

这些是调用删除/复制前的检查，未提供持锁/基于句柄的全程原子防竞态证明。[路径回归](../modules/build-test-release.md#test-path-boundaries)的危险根路径负例只调用纯判定；真实 builder 写入限定一次性临时目录。本文未执行任何破坏性负例，也不把旧风险记录当成当前实现。

## 4. 选中的实际包 → 可追溯的测试副本

[run-e2e](../modules/build-test-release.md#file-run-e2e)设置 TF_E2E_ARTIFACT，默认 `.output/chrome-mv3`；未设置 TF_I18N_ARTIFACT 时跟随。显式空 artifact 报错；只有 manifest 可访问才启动 Playwright，具体 runtime mapping 留给 adapter。--list/help/version 不执行产物检查。直接 npx playwright 会绕过 wrapper；shared adapter 自身仍默认相同 WXT 路径，专项消费者所需环境须明确设置。

[production-artifact](../modules/build-test-release.md#file-production-artifact)先 inventory 实际文件：每文件 SHA-256、按路径排序的 path+NUL+hash+换行组成 treeSha256、总/词典/代码字节。copyProductionArtifact 执行上述隔离检查，检查 MV3 和 generation 对应 runtime mapping，拒绝非生产顶层、源码 map/TS/归档等；cp 后重新算树 hash 必须一致。缺包、缺映射、已有冲突目标均失败，**不调用 builder、不补源码、不回退旧包**。

current 的 sourceHead 来自 TF_E2E_ARTIFACT_SOURCE_HEAD，未设置是 null；它是调用者来源标签，既不查询 Git 也不证明包字节由该提交构建。treeSha256 证明被读取/复制的字节身份，不是构建可信证明。证据应同时保留 artifact 路径、generation、sourceHead、原树 hash、testCopy hash/changes 及实际构建/检查上下文。旧代 mapping 固定 19e89b6 来源，但仅对两个映射输入文件 SHA 做比较，不是全旧包可复现证明。

prepareExtensionTestCopy 完成精确复制后才作受限测试适配：
- 替换词典为 synthetic fixture、missing、corrupt、incompatible，或从当前 repo 生成目录复制 release packs
- 仅临时 Manifest 加 mock/指定测试 host permissions
- 可选固定 ECDICT recipe 的本地 archive Worker 适配
- 可选 Commands callback、onInstalled、executionProof、native 启动 fetch 探针

最终重算副本 inventory，逐路径约束 changes；Manifest 除 host_permissions 外必须不变。即使 lexiconMode=release，词典也是从 repo 生成目录替换，不应称整份测试副本未经修改。

[shared fixture](../modules/build-test-release.md#file-extension-fixture)创建临时 profile、启动 Chromium，从真实 SW URL 得 extensionId，打开实际 Popup driver，提供 reset/open/tabId/inject/runtime/storage 接口。reset 清翻译缓存和 local settings 后设 mock，不是清全部 IDB/OPFS 的万能隔离。harness 按 worker scope 复用；用例仍负责隔离。finally 按 context→server→临时目录嵌套清理，初始化在 try 前的异常另有边界。

## 5. 测试跑到了哪一层

- Node `tests/*.test.mjs`、Vitest `tests/unit/**/*.test.ts(x)` 和 Playwright `e2e/**/*.spec.mjs` 各自发现；Node 里也有明确调用真实 builder 的包边界/路径测试，不可把“Node”统称为纯静态检查。Vitest 默认 node，DOM fixture 需显式环境。
- strict TS 开启 noUncheckedIndexedAccess/exactOptionalPropertyTypes、skipLibCheck=false；旧 JS checkJs=false，不表示全 JS 已严格类型化。
- 普通 E2E 消费指定产物的 background/页面；专项自加素材或测试模块需单独披露，shared fixture 无 fallback 不等于所有 spec 都无注入。
- Commands 调用实际 bundle 注册的 listener 探针，**不是用户原生快捷键或 activeTab 手势授权验收**。包装保留 native API，但测试主动调用 callback，见[Commands](../modules/build-test-release.md#file-commands)。
- StarDict 在实际 Options 初始化前观察 native Worker/sendMessage，走 UI 合成文件选择、确认、导入、后台复核和查询，断言 transfer 后 buffer=0、token 清理、worker 终止；没有再 import 控制器源码。
- fake permissions/mock runtime/DOM fixture 只证明模拟分支。native permission spec 另用临时 profile 的 Chrome 管理 API 操作 hard-denied/withheld/granted/revoked；withheld/revoked 的一秒观测允许 PENDING 或真实拒绝，但不能有执行、DOM marker 或 receiver。PENDING 不是最终拒绝，权限弹窗和 pending consent completion 仍未验证。

## 6. 同 ID 升级、真正激活、闭包更新、恢复与重启

> 当前c250ce9的auto-sites已改为清理全部本项目动态注册；下述旧helper仍期望保留ID并换资源，存在静态合同冲突，不能将此旧说明作新Manifest升级PASS。旧用户required权限确认/恢复也未由unpacked reload覆盖，见[当前边界](../modules/real-entry.md#limitations)。

> 本节大型升级/平台 spec 的逐项叙述仍绑定 d524 旧固定源码；e2e/wxt-upgrade.spec.mjs 在当前树有变，coverage 保留待复核。本节提及 Reading NOT_READY 只记录旧 probe，不能据此声称 b606 学习中心仍未开启或当前新包用例已通过。当前页面映射的两组 Node 断言已全文复核，但不替代升级 spec。

[升级消费者](../modules/build-test-release.md#upgrade-consumers)仅在 TF_UPGRADE_OLD_ARTIFACT / TF_UPGRADE_NEW_ARTIFACT 同时存在时运行；缺少是 skip，不是通过。旧包固定 `19e89b65fd3600073410407392da82ffa666ffc8`，冻结 48 项 Content 顺序；新包用 current mapping。两者要求相同 Manifest version，复用同 unpacked 路径、profile 和实际 extensionId，不改生产 key。

旧包真实 Options 导入两个合成 MDX/MDD，设启停/个人首选/默认展开，翻译三段留下缓存，注册 auto/restore/quick-control 并集。完整快照涵盖 storage 全键、所有数据库名称/版本/store/rows、OPFS 路径/size/hash 和全部动态注册。同版本替换目录字节后，Chromium 可能仍持有旧 SW；onInstalled 观察器和 Reading v2 NOT_READY 的真实响应区分运行代次，不能仅看新 Options UI 宣称后台已换。

替换阶段要求整个快照不变；UI 显示 auto 不允许偷偷写 uiLocale。随后 Chrome 管理 reload 必须观察新 SW、native onInstalled update 和正确 previousVersion，才容许两类明确变化：
1. 仅原本缺少的 uiLocale 补 auto，已有值保留。
2. 仅动态注册的 js/css 从精确旧闭包替换为新包精确闭包；注册 ID、matches 和权限/执行策略等其余字段保留。新增 reading-contract 等资源不能反向要求旧包具备，也不能把旧注册脚本数组原封保留当正确升级。

旧 content world 通过原 message channel 检查失效，再刷新恢复；缓存恢复不新增 Provider 调用。数据库只允许既有 v2 translations/pages 的 lastAccessedAt 在原值到观测时间内前进，不能只比较“三行还在”。重启同 profile 后与恢复后完整快照继续相等。

闭网 proxy 在浏览器启动前监听，只允许精确 mock origin，拒绝其它 HTTP/CONNECT 及替代 loopback；probe 的三次 native fetch 必须真实 settle，代理还要有匹配拒绝记录。这证明代理范围内没有向外转发，**不证明零外联尝试或 OS 级隔离**。smoke 的 page route 在 launch 后才设置，externalRequests=[] 不能替代该启动证据。

注入采样在同 profile/path/ID 下比较旧/新，各十次 cold/warm；WXT 显式 reload 并核对执行树 hash，检查同 app 对象、模块数/DOM/零 Provider 和每次 page 清理。报告 median/min/max，没有性能门槛，不能宣布加速。Chrome 102、真实 YouTube、付费 Provider、真实用户数据升级及 realOxford 均没有本轮新证据。

## 7. CI、安装和发布边界

[quality](../modules/build-test-release.md#file-quality-workflow)与[e2e.yml](../modules/build-test-release.md#file-e2e-workflow)均只由 workflow_dispatch 手动启动，不响应 PR/main push。quality 运行 validate，终点是 WXT dist。E2E 的 stable-wxt / wxt 矩阵分别选 dist 和 .output；每行先显式 WXT build+smoke，再默认 WXT build。两行都构建固定旧 commit 包并设置升级环境，但升级新包都明确指向 `.output/chrome-mv3`：不能称 stable-wxt 行的同 ID 升级测了 dist。失败上传 Playwright/test-results 七天，成功不保证上传完整报告。定义不是精确 head 的实际 run 结果。

词典专项 Actions 也只有手动入口，显式选 dist：lexicon-release、vNext 在 validate 后已有默认 WXT 包；MDD、rich cancellation、rich compatibility 在 focused E2E 前明确 build:extension。旧 step 名称中的 stage-one 不改变当前脚本路由。这些来源下载/认证定义不能证明本轮已下载、认证或真实词典全通过，见[专项 CI](../modules/build-test-release.md#partial-ci)。日常候选、指纹与验收绑定见[本地任务验收](local-task-acceptance.md)。

安装路径仍为 README 的 `dist/extension`，内容已是默认 WXT。重新加载扩展后刷新已有网页以获得新 Content context；删除数据后“重新安装成功”不能证明升级保留。代码中的 build/CI 没有自动商店上传或发布授权；本章未执行安装、升级、上传或发布。

## 8. 失败定位和最小改动入口

1. 选错/陈旧/缺包：查 TF_E2E_ARTIFACT、构建输出路径、源与副本树 hash，不增加 fallback 掩盖。
2. 输出被拒绝：查 path-boundaries 的关系、temp 边界、symlink/.git；不要绕过保护或用真实源码根重现删除。
3. 缺 Worker/MAIN/Content：查 runtime-assets/constants、sourceClosure/generation mapping，不能把整个 src 复制为 public。
4. 新增包资产：联动 descriptor、locale、audit 集合/字节/预算及测试副本 changes。
5. 用例似乎通过却跑旧 SW：保持 same-ID/path，读真实激活/执行 probe，不用 sourceHead/页面标题代替。
6. 升级丢数据或保留旧脚本：查完整快照、native lifecycle 和注册资源窄例外，不放宽成计数比较。
7. 用户体验改动：类型/Node 只是一层；补实际产物浏览器断言，真实权限弹窗/真实网页须单列证据。

本轮只读源码与修订文档，没有运行以上步骤。大型边界分析器、mock server、专项认证脚本/来源链及未展开的产品 spec 仍保留局部覆盖。读历史兼容报告前参照[规范与证据身份](../modules/build-test-release.md#file-wxt-compat-doc)，日常命令/隔离参照[E2E 规范详解](../modules/build-test-release.md#file-e2e-doc)。



