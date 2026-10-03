# 构建、实际产物与测试到安装升级

[逐文件说明](../modules/build-test-release.md) · [启动链](extension-startup.md) · [首页](../README.md)

本章构建/测试实现固定于 `86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d`；2026-10-03 按 main `9bea2ddbe9d91950cf49074f11b93fcbfcc8b9a0` 复核 Actions 触发语义，其余本章已完整解释的构建/测试源码字节未变。#266 合入的是产物消费/测试/CI证据链调整；不能由此推导默认发行切换。所有安装、构建、脚本、Node/Vitest、浏览器、CI和发布验证在本轮均 **NOT_RUN**。下文“断言/报告”指源码定义，非本轮 PASS。

## 1. 用户入口与两种安装包

开发者修改源码后，产物必须先构建，再交给指定消费者。安装用户加载产物目录，Chrome依 Manifest启动后台和扩展页面；Content/MAIN/Worker仍走[启动链](extension-startup.md)中的各自路径。

| 入口 | 实际调用与输出 | 能证明/不能证明 |
| --- | --- | --- |
| `npm run validate` | check → Node `tests/*.test.mjs` → typecheck → Vitest → legacy build | 构建 `dist/extension`；不构建WXT、不跑E2E、不做完整词典发布认证 |
| `npm run build:extension` | `scripts/build-extension.mjs` allowlist复制 | 默认旧包；允许缺少生成词典 |
| `npm run build:extension:release` | 同脚本 `--require-lexicon` | 要求 `assets/lexicon` 目录被复制；不等于每个包的完整认证 |
| `npm run build:extension:wxt` | WXT production build → audit | opt-in `.output/chrome-mv3`；Manifest和资源精确检查 |
| `npm run test:wxt:smoke` | audit → WXT临时副本 →有限Chromium流程 | 不自动build；不等于完整E2E/升级/发布 |
| `npm run test:e2e` | run-e2e → Playwright | 默认读已有WXT；可显式选legacy；缺包失败不回退 |
| `npm run test:e2e:rich-mdict` | 同wrapper，限定两个spec | 同样默认WXT；不是另一个隐式构建入口 |

这是两个不同的“默认”：**默认构建/发行仍是legacy，默认本地E2E选择WXT**。仅执行validate后直接跑test:e2e，可能因缺WXT失败；残留dist不能补这个缺口。旧根README“零bundler”的概括只适用于legacy路径，不能覆盖当前WXT配置。精确命令见[package及校验分工](../modules/build-test-release.md#package-routing)。

## 2. 源码 → legacy / WXT 产物

legacy builder先验证Manifest locale，再清理输出并复制固定根文件、整个src（排除.d.ts）及可选assets/lexicon，最后检查顶层禁入目录并统计大小。默认路径检查要求输出在dist下；allowExternalOutput跳过该限制。当前raw ROOT等值判断存在规范化风险，也没有删除前的link/嵌套Git保护，不能把这项guard视为完整安全边界，见[已知未合入修复](../modules/build-test-release.md#output-safety-followup)。失败会留下未完成目录，不是事务式发布，调用者不能只凭目录存在判断完成。

WXT由已解释的[wxt.config.mjs](../modules/startup.md#file-wxt-config)配置：background.ts复用initializeBackground；Popup/Options直接注册现有HTML源，Vite编译，保留原安装路径/options_page语义。Content有序列表、MAIN及Worker roots经[raw资产闭包](../modules/build-test-release.md#file-wxt-assets)逐文件复制；构建没有把整个src变成public。资产文件集合排序用于打包，运行时脚本顺序仍由CONTENT_SCRIPT_FILES决定。

生成词典不是源仓库覆盖分母中的现成可安装数据。WXT按TFLex manifest明确声明、指纹/descriptor hash、role和真实路径核验文件；开发缺包列出missing，TRANSLATEFLOW_WXT_REQUIRE_LEXICON=1才强制全部就绪。legacy的requireLexicon只验证目录被纳入，强度不同；都不能替代来源/质量/真实词典认证。

[audit](../modules/build-test-release.md#file-audit)检查Manifest与基线deepEqual、精确资产集合、raw/词典/locale源字节、编译依赖、禁入测试/React/开发资源、HTML本地引用和代码体积预算。报告在.wxt/reports，不是安装资源。build/audit成功也不证明Chrome102运行或真实网站兼容。

## 3. 选中的实际包 → 可追溯的测试副本

[run-e2e](../modules/build-test-release.md#file-run-e2e)设置TF_E2E_ARTIFACT，默认.output/chrome-mv3；TF_I18N_ARTIFACT未设置时跟随同包。显式空artifact报错；只检查manifest可访问才启动Playwright，具体资产由fixture继续验证。--list/help/version不执行产物检查。直接npx playwright绕过wrapper时，CI仍需显式环境变量，shared adapter自身默认仍为WXT。

[production-artifact](../modules/build-test-release.md#file-production-artifact)先inventory实际文件：每文件SHA-256、按路径排序的path+NUL+hash+换行组成treeSha256、总/词典/代码字节。copyProductionArtifact拒绝源/目标相同或嵌套，检查MV3及generation相应runtime mapping，拒绝非生产顶层/源码map/TS/归档等文件；复制后重新算树hash必须一致。缺包、缺映射、已有目标均失败，**不调用builder、不补源码、不回退旧包**。

current的sourceHead来自TF_E2E_ARTIFACT_SOURCE_HEAD，未设置是null。它是调用者提供的来源标签，既不查询git也不将每个包字节绑定到该提交；treeSha256证明被读取/复制的字节身份，也不是构建可信证明。报告必须同时保留artifact路径、generation、sourceHead、原树hash、testCopy hash/changes，以及构建/检查上下文。旧代mapping另固定19e89b6源码身份，但只对两个映射输入文件的SHA做比较，不能误称全旧包可复现证明。

prepareExtensionTestCopy完成精确复制后才允许测试适配：
- 替换词典为synthetic fixture、missing、corrupt、incompatible或repo生成release packs；
- 只在临时Manifest加入mock/特定测试host permissions；
- 可选本地ECDICT archive Worker适配，只接受固定recipe；
- 可选Commands回调探针、onInstalled观察器、executionProof及native启动fetch对照，修改均进入diff。

它最终重算副本inventory，逐路径约束变化，Manifest除host_permissions外必须保持一致。即使选择release，词典仍是从当前repo生成目录替换到副本，应读lexiconMode/testChanges，不能把整份测试副本称为未经改动的发行包。

[shared fixture](../modules/build-test-release.md#file-extension-fixture)再创建临时profile、启动Chromium、从真实SW URL取得extensionId、打开实际Popup driver，提供reset/open/tabId/inject/runtime/storage接口。reset清翻译缓存和local settings后设置mock；它不是清全部IDB/OPFS的万能隔离器。harness按worker scope复用，调用方有责任做用例隔离。finally按context→server→临时目录嵌套清理。

## 4. 测试跑到了哪一层

- Node regression是独立tests/*.test.mjs；纯输入/文件系统/源码断言不能替代真实浏览器。Vitest仅tests/unit/**/*.test.ts(x)，默认node；DOM fixture需显式环境。strict TS开启noUncheckedIndexedAccess/exactOptionalPropertyTypes且skipLibCheck=false，但旧JS checkJs=false，不代表全JS已严格类型化。
- 普通E2E实际消费指定产物的background/页面。需要补充测试模块的专项应单独披露，不能由shared fixture无fallback推导全仓所有spec都无注入。
- Commands spec调用实际bundle注册的listener探针，仍然**不是用户原生快捷键/activeTab授予手势验收**。包装保留native API，但测试主动调用callback；[详解](../modules/build-test-release.md#file-commands)。
- StarDict spec先在实际Options入口启动前包装native Worker和sendMessage，走UI选择合成文件、确认、导入、后台复核、查询，核对transfer后buffer长度0、token清理和worker终止；不是重新import控制器源码。纯旧版本展示断言已移到Node，[测试消费者变化](../modules/build-test-release.md#consumer-deltas)。
- fake permission API、mock runtime、DOM fixture只证明所模拟的分支。native permission spec另用临时profile的Chrome管理API操作hard-denied/withheld/granted/revoked；withheld/revoked的一秒观测允许PENDING或真实拒绝，但不允许执行/DOM标记/receiver。不能把PENDING描述成最终拒绝，未验证权限弹窗和pending consent completion。

## 5. 同ID升级、真正WXT激活、恢复与重启

[升级消费者](../modules/build-test-release.md#upgrade-consumers)只在TF_UPGRADE_OLD_ARTIFACT和TF_UPGRADE_NEW_ARTIFACT同时存在时运行；缺少时skip不是通过。旧包固定19e89b65fd3600073410407392da82ffa666ffc8，使用冻结48项Content顺序；新包用当前mapping。两者要求相同Manifest version，复用同unpacked路径、profile及ID，不改生产key。

在旧包真实Options导入两个合成MDX/MDD，设置启停/个人首选/默认展开，翻译三段留下缓存，注册auto/restore/quick-control并集。快照比较storage所有键、全部数据库名称/版本/store/rows、OPFS路径/size/hash、所有动态注册。替换目录字节后同版本Chromium可能仍保留旧SW；测试用onInstalled观察器和Reading v2 NOT_READY运行时差异区分，不能只看新的Options UI就宣称后台已换。

替换阶段要求整个快照不变，UI显示默认auto不允许偷偷写uiLocale。随后Chrome管理reload必须观察新SW、native onInstalled update及正确previousVersion，才允许缺失uiLocale补auto；已有值必须保留。用旧内容世界已注册message channel检查失效，再刷新页面恢复；恢复缓存不新增Provider调用。数据库比较只允许现有v2 translations/pages行的lastAccessedAt在原值到观测时间内前进，不能只比较“三行还在”。最后重启同profile，快照继续相等。

闭网代理在浏览器启动前监听，精确允许mock origin，拒绝其他HTTP/CONNECT及替代loopback；probe原生fetch需三次都真实settle，并在代理记录找到对应拒绝。它证明此代理范围内没有对外转发，**不证明零外联尝试或OS级隔离**。有限smoke启动后设置page route，其externalRequests=[]也不能替代MV3启动闭网证明。

十次cold/warm注入样本另在同profile/path/ID下比较旧/新；WXT显式reload并核对执行树hash，验证同app对象、模块数/DOM/零Provider调用和每次page清理。报告median/min/max，没有性能门槛，不能宣布加速。Chrome102、真实YouTube、付费Provider、真实用户数据升级仍非本轮证据。

## 6. CI、安装和发布边界

[quality](../modules/build-test-release.md#file-quality-workflow)和[e2e.yml](../modules/build-test-release.md#file-e2e-workflow)现在都只由 workflow_dispatch 手动启动，不再响应 PR/main push。前者运行 validate；后者建立 legacy/wxt 矩阵，显式设置artifact、locale、github.sha标签。每一行先WXT build+smoke再legacy build；WXT行额外构建固定旧commit worktree并传升级两个包，最后跑test:e2e。失败上传Playwright/test-results七天；并非每次成功都上传完整升级证据。没有 PR 路径过滤触发可供推定；具体 run 必须有实际证据，不能仅凭 workflow 定义称 CI 通过。日常验收及候选绑定见[本地任务验收](local-task-acceptance.md)，真实远端保护仍有效。

词典专项 Actions 同样只有手动入口，仍显式选 dist/extension：lexicon-release、vNext在validate后已有legacy；MDD、rich cancellation、rich compatibility在focused E2E前明确build。认证流水线下载锁定公开来源、合成互操作素材和脱敏报告；读到这些定义不等于本轮已下载/认证。见[专项CI边界](../modules/build-test-release.md#partial-ci)。

安装路径仍是根README的dist/extension，WXT安装属opt-in。重新加载扩展后刷新已有网页才能获得新的Content context；同ID/profiles/storage兼容是独立验收，删除数据“重新安装成功”不能证明升级保留。源码中的build和CI没有自动商店上传/发布授权，本章也未执行安装、升级、上传或发布。

## 7. 失败定位和最小改动入口

1. 选错包/缺manifest：先看TF_E2E_ARTIFACT、run-e2e和CI build顺序，不能增加fallback掩盖。
2. 缺Worker/MAIN/Content：看runtime-assets/constants、sourceClosure和generation mapping；不能复制整个src进WXT public救场。
3. 新增包资产：同时审查精确descriptor、locale、audit集合/字节/预算以及测试copy变化列表。
4. 用例“通过”却运行旧SW：保留same-ID/path，读真实激活/执行probe；不能以sourceHead或页面标题替代。
5. 数据丢失/隐式写默认：看upgrade-expectations的完整快照、native lifecycle时序，不能放宽为计数比较。
6. 用户体验改动：Node/类型检查只是起点，补实际产物浏览器断言；需要真实权限弹窗/真实网页时单列证据。

本轮没有运行以上步骤；没有把历史报告PASS、测试名称或test.skip当作新验收。后续逐文件待补：大型源边界分析器、mock server、专项认证脚本/来源链和各完整产品spec。


