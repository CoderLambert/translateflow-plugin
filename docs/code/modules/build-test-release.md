# 构建与测试：逐文件说明

[完整功能链](../features/build-test-release.md) · [首页](../README.md)

固定源码 `86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d`，2026-10-03复核。本轮完整读取并解释下列27个文件；大型spec、专项CI、package脚本总路由与依赖分析器保留局部。已在启动章完整解释的wxt.config.mjs/entrypoints/background.ts不重复计数。运行验证全部 **NOT_RUN**；本文只说明代码中的断言与输出，不继承历史PASS。

## 完整文件索引

- [scripts/build-extension.mjs](#file-build-extension)
- [scripts/wxt-assets.mjs](#file-wxt-assets)
- [scripts/audit-wxt-extension.mjs](#file-audit)
- [scripts/run-e2e.mjs](#file-run-e2e)
- [scripts/check.mjs](#file-check)
- [scripts/i18n-locales.mjs](#file-i18n)
- [scripts/smoke-wxt-extension.mjs](#file-smoke)
- [playwright.config.mjs](#file-playwright)
- [vitest.config.ts](#file-vitest)
- [tsconfig.json](#file-tsconfig)
- [e2e/support/production-artifact.mjs](#file-production-artifact)
- [e2e/support/extension-fixture.mjs](#file-extension-fixture)
- [e2e/support/runtime-mapping.mjs](#file-runtime-mapping)
- [e2e/support/19e89b6-runtime-mapping.json](#file-frozen-mapping)
- [e2e/support/closed-network.mjs](#file-closed-network)
- [e2e/support/upgrade-expectations.mjs](#file-upgrade-expectations)
- [e2e/commands.spec.mjs](#file-commands)
- [e2e/stardict-import-worker.spec.mjs](#file-stardict-consumer)
- [.github/workflows/quality.yml](#file-quality-workflow)
- [.github/workflows/e2e.yml](#file-e2e-workflow)
- [tests/production-artifact.test.mjs](#test-artifact)
- [tests/wxt-e2e-entry.test.mjs](#test-entry)
- [tests/wxt-runtime-mapping.test.mjs](#test-mapping)
- [tests/wxt-closed-network.test.mjs](#test-network)
- [tests/wxt-upgrade-expectations.test.mjs](#test-upgrade)
- [tests/wxt-assets.test.mjs](#test-wxt-assets)
- [tests/curated-install-artifact-presentation.test.mjs](#test-presentation)

<a id="file-build-extension"></a>
## scripts/build-extension.mjs：默认legacy文件复制器

blob `0c6cf0f6f3ca35932c95bef4667319f939901d0c`；[完整源码 L1–L154](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/scripts/build-extension.mjs#L1-L154)。

**入口/输入输出。** package的build:extension与build:extension:release调用本CLI；也导出buildExtension({outDir,requireLexicon,allowExternalOutput})。默认dist/extension，输出报告含fileCount、totalBytes、lexicalBytes、largestFiles前20项。parseArgs只收--out及--require-lexicon，未知参数/缺值失败；主函数catch写stack并置exitCode=1。

**实现/所有权。** 先用relative检查输出为dist或其子目录，另尝试用raw equality拒绝ROOT和/；显式allowExternalOutput跳过insideDist。ROOT尾分隔符与resolve后output的等值问题及嵌套工作区删除风险见[安全后续](#output-safety-followup)，不能将这些分支概括为完整安全保护。校验locale后rm旧输出，再复制固定Manifest/locale/根JS、HTML、CSS、整个src（过滤.d.ts），可选assets/lexicon整目录。最终walkFiles检查禁入的顶层目录，按大小统计，局部entries不跨调用缓存。requireLexicon只要求词典目录曾被复制，不能证明两包完整或hash/质量合格；它不是WXT descriptor检查器。

**失败/影响。** 任一步异常立即reject，不回滚已删/复制文件；这不是原子发布器。没有取消接口；调用者若终止进程须把输出视为不完整。修改allowlist需联动安装入口、runtime mapping、测试产物消费和发布认证；不要从测试缺文件反推应扩大生产包。production-artifact/wxt-e2e-entry的无fallback断言保护的是消费者边界，不是该legacy builder的全分支测试。NOT_RUN。

<a id="file-wxt-assets"></a>
## scripts/wxt-assets.mjs：精确raw与生成词典资产闭包

blob `f7869e19ca6e9858dacc2b3eaaa22dc5a2ca6c73`；[完整源码 L1–L111](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/scripts/wxt-assets.mjs#L1-L111)。

**依赖/算法。** ROOT绑定repo；legacyAssetRoots把有序Content JS/CSS、MAIN及WORKER_PATHS组成roots。sourceClosure递归读取相对JS import/from/import()及带引号CSS import/url，Set去重防环，最终返回排序路径集合。真实文件先realpath，isInsideSourceRoot拒绝根自身、父级、Windows跨盘/UNC越界；assertAssetPath拒绝反斜杠、冒号、空段、点和父级段。扫描是限定语法的正则闭包，不是任意JavaScript/CSS依赖解释器；不能据此允许computed或外部imports。

**词典/状态。** lexicalAssetFiles逐个BUNDLED_LEXICON_PATHS读manifest，ENOENT记missing，其余错误上抛；拒绝重复路径，验证格式/manifest fingerprint，然后限制directory.json lookup-index、THIRD_PARTY_NOTICES license-notice及shards/*.jsonl lexical-data。每个descriptor核对size/hash、真实路径及普通文件，未声明的stray source-lock不会复制。requireLexicon遇任一missing失败。各调用局部数组/Set，无持久状态；不修改源文件。

**统计/测试/影响。** walkFiles拒绝非普通目录/文件的artifact entry；byteSummary排序文件并区分lexical/code字节，供audit和inventory。wxt-assets.test用真实临时文件、symlink及posix/win32路径测试约束，也检查缺包与corrupt；NOT_RUN。新资源要先更新唯一runtime mapping/真实源码依赖，再审查build hook和audit；roots顺序不能拿最终排序的资产集合替代。

<a id="file-audit"></a>
## scripts/audit-wxt-extension.mjs：生产WXT完整资产审计

blob `e2daa7a5480d136a891f8f72e612b3ec737b37c5`；[完整源码 L1–L86](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/scripts/audit-wxt-extension.mjs#L1-L86)。

**输入/步骤。** auditWxtExtension默认.output/chrome-mv3和.wxt/reports，读取输出与源码Manifest、asset-map、compiled-closures，重新推导raw/locale/lexical闭包与byteSummary。assertProductionManifest直接deepEqual全部字段，包括权限、版本、options语义；不是少数字段近似比较。present必须等于Manifest+页面+精确raw/词典/locale+所有记录的compiled输出，不允许缺项或多项；raw/locale/词典逐文件比源bytes，编译依赖路径必须实际存在。

**安全/输出。** 模块ID拒绝测试库、React、开发/私有源、WXT dev helper；安装树禁测试/构建/语料目录、map/pem/crx/zip、HMR和远端HTML资产。HTML script/link引用须在present。代码预算1576595字节不含lexical，统计background静态import闭包和UI chunks/assets+HTML；预算/报告不是延迟benchmark。报告status PASS仅在所有assert完成后写production-audit.json，本轮没有生成。

**失败/修改。** 读文件或assert失败即终止；无补文件、取消、重试或回滚。compiled-closures是构建hook提供的清单，audit不是独立重编译验证，更不是供应链签名。wxt-assets.test对Manifest扩权限、静态注入、web-accessible、Chrome最低版本/options_ui/background差异设置负例；修改bundle命名/资产依赖需同步配置、预算和smoke。NOT_RUN。

<a id="file-run-e2e"></a>
## scripts/run-e2e.mjs：明确选择产物的Playwright入口

blob `2f95ffa227fc8f1a9310dd1d97e71c1f2a8188a8`；[完整源码 L1–L37](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/scripts/run-e2e.mjs#L1-L37)。

e2eEnvironment保留传入env，以nullish默认TF_E2E_ARTIFACT=.output/chrome-mv3，非空trim断言；未设TF_I18N_ARTIFACT跟随所选包，显式locale保留。requireE2EArtifact仅resolve并access manifest，不认证整包；后续adapter负责runtime mapping。main透传CLI args，list/help/version免执行检查，以当前Node调用@playwright/test/cli test，cwd固定repo，stdio继承；spawn error抛出，status空视1，catch打印message并置exitCode。

没有构建调用、搜索残留dist、fallback或补asset。wxt-e2e-entry测试构造“旧包存在/WXT缺失”并断言仍ENOENT，同时对子进程缺包路径断言退出1且未开始Running；NOT_RUN。改默认值、环境优先级或参数处理会影响全部package E2E入口及locale专项/CI矩阵，必须联动fixture和workflow。

<a id="file-check"></a>
## scripts/check.mjs：语法与架构检查编排

blob `b3c6f3538d4ab75d1cca49b5bbe9f65943d3da0c`；[完整源码 L1–L47](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/scripts/check.mjs#L1-L47)。

CLI仅允许无参数或--root directory，后者供同规则的正负fixture。递归遍历跳.git/node_modules及根.wxt/.output/dist；用source-boundaries导出的SOURCE_EXTENSION筛选源文件，对JS/MJS/CJS逐一node --check，把stderr汇总；再把全部源交inspectSources。另查MV3/module背景固定background.js、根background/content入口行数、废弃根cache-db不存在。失败逐项输出并exit1，成功报告源数；不导出应用runtime、不写安装包。

failures局部收集，不能因为单个语法错误停止后续边界采集；JSON/manifest错误加入列表，但目录读取等未专门catch。TS/TSX的语义/typecheck由另一路负责，不是node --check。source-boundaries及source-api-boundaries大型分析器本章仅相关入口，未解释其全部AST/alias规则；改过滤/跳过目录需同时审查它们、source-boundaries测试及tsconfig，防生成文件误入或真实源码遗漏。NOT_RUN。

<a id="file-i18n"></a>
## scripts/i18n-locales.mjs：Manifest locale可重复投影与检查

blob `f28c31e218d6933156620ee9579dba0b0c7816e3`；[完整源码 L1–L38](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/scripts/i18n-locales.mjs#L1-L38)。

checkManifestLocales从纯i18n catalog的validateCatalogs/getManifestMessages获得权威投影，核对Manifest default_locale=en及六个name/description/action/commands引用恰为__MSG_key__。对MANIFEST_LOCALE_FILES根据目录名选语言，用固定JSON缩进+换行生成expected；正常只读逐字比较，generate=true才mkdir/write后核验。返回keyCount及files，legacy/WXT builder共用，语言源只有一份。

CLI只接受--generate/--check，未知参数throw；generate是明确写生成locale的模式，不在普通check偷偷修复漂移。缺失/陈旧文件或catalog错误阻止构建。无长期状态/回滚/重试；不是用户UI locale存储适配器，也不改变Provider target。修改Manifest消息名、catalog或支持语言需同步runtime-assets、两套build和语言测试；本轮NOT_RUN。

<a id="file-smoke"></a>
## scripts/smoke-wxt-extension.mjs：有限WXT产物Chromium验收脚本

blob `6aae188836a20ec38d14c764f8dee4fc503e8e9f`；[完整源码 L1–L125](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/scripts/smoke-wxt-extension.mjs#L1-L125)。

**建立/消费。** 顶层先audit实际WXT，不build旧包；临时目录复制.output/chrome-mv3，替换为synthetic Core、由reviewed本地extract编译Technical，仅临时Manifest加127.0.0.1权限。persistent context使用临时profile；实际Popup/Options可见控件及CACHE_STATS校验页面/后台。每个WORKER_PATHS通过真实module Worker发unknown message，期望对应错误type/requestId，超时/错误均terminate；这只验证worker装载及非法输入回包。

**主链/断言。** 设置本地mock Provider；本地persistent查词应返回两个fixture候选且零Provider；有序注入Content及MAIN，检查MAIN version，正文三段翻译一次调用、保留链接/code且无结构token泄漏；clear再restore得三cache hits且调用仍一。动态注册为空、pageerror/externalRequests为空后写.wxt/reports/browser-smoke.json，列完整E2E/升级/真实Chrome102/YouTube/Provider等notRun。

**边界/清理。** context.route在launch后建立，不能约束此前SW启动网络；不得把externalRequests=[]写成全部进程零外联。本脚本与新shared adapter是两条独立测试副本路径，不自动拥有production-artifact的tree/testChanges证明。finally关context、server、删临时目录；顺序清理不是嵌套容错，早一步清理异常可中断后续。修改runtime路径、UI控件、worker错误协议会影响smoke；全部NOT_RUN。

<a id="file-playwright"></a>
## playwright.config.mjs：浏览器测试发现与诊断策略

blob `c025e62d0c740f056b3f061eb0da00a17d310516`；[完整源码 L1–L20](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/playwright.config.mjs#L1-L20)。

defineConfig只发现e2e/**/*.spec.mjs，test超时30秒、expect6秒，fullyParallel=false/workers=1。CI重试一次并启用line+不自动打开的HTML reporter，本地零重试且line；outputDir=test-results/e2e，trace只保留失败。spec可覆盖timeout/output配置，所以升级180秒不与全局矛盾。此文件不build包、不授权限、不选profile；shared/专用fixture负责生命周期。修改发现范围或并行数会影响worker-scoped资源/串行证据与CI报告目录；重试通过不能抹去首次失败，NOT_RUN。

<a id="file-vitest"></a>
## vitest.config.ts：与Node和E2E隔离的unit配置

blob `5b4f30eb9750cc76078ab3466d2c6f4ee0034c37`；[完整源码 L1–L14](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/vitest.config.ts#L1-L14)。

Vite React plugin服务测试编译；test.include仅tests/unit/**/*.test.ts、tsx，明确排除旧mjs/E2E/node_modules和所有输出目录。默认environment=node、globals=false、maxWorkers=2、passWithNoTests=false，组件测试需自己声明jsdom。没有fixture代码自动进入生产构建；audit另防测试/React污染。修改include或environment需复核package test:unit、tsconfig及具体测试注释，不能把Node测试数量或没有测试运行算通过。NOT_RUN。

<a id="file-tsconfig"></a>
## tsconfig.json：严格新TS与声明文件编译域

blob `3439e83619736dedfa783ac6fdcb6075d695836f`；[完整源码 L1–L20](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tsconfig.json#L1-L20)。

extends WXT生成tsconfig，target ES2022/lib含DOM，strict/noEmit、noUncheckedIndexedAccess、exactOptionalPropertyTypes、skipLibCheck=false；ESNext/Bundler、react-jsx，types限定node/react/react-dom。allowJs=true但checkJs=false，旧JS可以互操作，不代表全仓JS已严格检查。include明确列WXT paths/i18n声明、本仓types、新src/entrypoints各TS变体、unit及Vitest配置，排除node_modules/output/dist/e2e。

typecheck和test:unit入口先wxt prepare提供生成类型；缺失/冲突由编译报错而非运行时fallback。该配置只定义编译域，不安装浏览器globals；未包含完整WXT env声明的已知限制仍应读TYPES_TESTS_V1。改include/exclude、skipLibCheck或alias需同步类型合同与source boundary，不能用扩大排除使失败消失。NOT_RUN。

<a id="file-production-artifact"></a>
## e2e/support/production-artifact.mjs：实际生产包复制、证明与受限适配

blob `3f094c07c3e36d3d0648b068c162012b3223fb7f`；[完整源码 L1–L258](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/support/production-artifact.mjs#L1-L258)。

**纯复制与身份。** defaultArtifact在模块加载时读取TF_E2E_ARTIFACT或WXT默认，显式空串拒绝。inventoryArtifact基于byteSummary排序列表，对每文件算sha256，再hash“path+NUL+sha256+LF”序列得treeSha256。assertIsolatedArtifactPaths用可注入posix/win32 pathApi拒绝同/父/子目录；它是路径拓扑guard，不声明任意symlink环境的安全隔离证明。copyProductionArtifact先inventory/read Manifest再按generation检查mapping；pre-switch另核对两个冻结源文件SHA。仅允flatRuntime或src/assets/chunks/_locales顶层、拒TS/map/pem/crx/zip，确认MV3和所有runtime paths，再cp errorOnExist/force=false并复核树hash。

**可观察输出。** 返回源inventory、artifact/output、generation、runtimeMapping、sourceHead；current sourceHead来自环境且可null，不验证git或构建来源。旧sourceHead固定mapping.sourceCommit，只认证规定的旧映射输入，非全包签名。prepare在其上生成testCopy inventory及changes；原始hash与变更后hash用途不同，不能只打印来源标签声称“测试了此head”。

**词典与权限。** 复制后删副本assets/lexicon：release从repo生成目录copy，missing留缺，默认拷fixture Core并本地编译Technical；corrupt追加shard字节，incompatible改formatVersion=2。副本host permissions并入localhost/DeepSeek/raw GitHub，opt-in release host再加GitHub/release-assets。cached archive path开启特定Worker override，所生成worker校验固定ECDICT recipe后只访问mock endpoint并转发原worker-core，不在副本补完整Options源模块。

**探针/状态。** captureCommands不能与lifecycle/execution/startup观察同用；它包裹已编译background，捕获实际onCommand listener、send/query/injection并保留native调用。observeInstalled仅增加最多4个事件的观察listener，overflow明确记录，不写storage不改原listener。executionProof把原tree hash注入global；startupNetwork校验token/origins后执行3次native fetch并记录settlement。每个probe记录修改前后hash（Commands用changes/副本hash），不作为生产业务接口。

**终检/失败。** 重新inventory，changes只许manifest、lexical及明确允许的Worker/background路径；Manifest除host_permissions外deepEqual原文件。错误立刻reject，无builder fallback、下载、回滚或自动重试；外层fixture负责关闭/删临时资源。production-artifact及wxt-runtime-mapping/wxt-closed-network测试对拷贝/映射/对照失败提供负例。改环境选择、runtime mapping或probe须复核所有E2E消费者和报告；NOT_RUN。

<a id="file-extension-fixture"></a>
## e2e/support/extension-fixture.mjs：worker-scoped共享MV3测试夹具

blob `f62436b74f966277cb3fc8f7e26c28c998410ff5`；[完整源码 L1–L217](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/support/extension-fixture.mjs#L1-L217)。

**输入/生命周期。** Playwright base.extend提供worker scope选项：词典模式、Commands probe、ECDICT host/cache；harness先startMockServer和mkdtemp，再调用prepareExtensionTestCopy，不调用legacy builder。日志E2E_PRODUCTION_ARTIFACT保留artifact、sourceHead、原tree/fileCount/大小、lexiconMode、testChanges/probe/override。Chromium仅加载临时extension，临时profile维持该worker的storage；等实际serviceworker，用其URL获得extensionId并打开Popup driver。

**调用接口。** reset先server.reset，经后台CACHE_CLEAR_ALL再clear local storage，写入mock Provider及默认站点/术语/外观；不全清Reading IDB/OPFS。open为每个page赋WeakMap token并写dataset；tabId按URL候选逐个executeScript比token，避免相同URL多tab混淆，无token才取首个。inject先ABT_STATUS ping，已有receiver成功则返回，否则insertCSS→有序Content；MAIN另用明确三文件和world MAIN注入。sendContent、captureSelectionContext、runtime、set/getStorage只是driver调用native API/现有app模块，不构造第二套后台业务。

**清理/局限。** await use前reset，harness由各spec选择是否beforeEach reset；finally嵌套关闭context/server/删除temp确保后续cleanup尝试。创建server/temp在try前，不能据此断言任意初始化失败也全部清理。此helper没有全局closed-network proxy，mock Provider配置不等于所有网络零外联。修改重置、tab选择、文件顺序影响全套共享spec；tests/production-artifact防止fixture错误被内部重建掩盖。NOT_RUN。

<a id="file-runtime-mapping"></a>
## e2e/support/runtime-mapping.mjs：按包代次选择运行时资源合同

blob `3ac011ef6bfe0a828e126d8ded9364d4c66b6c19`；[完整源码 L1–L22](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/support/runtime-mapping.mjs#L1-L22)。

currentRuntimeMapping由当前CONTENT_SCRIPT_FILES/STYLES、EXTENSION_PAGES/WORKER_PATHS/MAIN拷贝或引用组成；旧代导入冻结JSON。mappingForGeneration只接受current/pre-switch-19e，未知assert。assertRuntimeMapping要求Manifest/SW及全部指定资源路径在inventory Set，缺任一即失败，不负责文件内容校验、加载顺序执行或构建。

无持久/异步状态；旧代资源不能随当前新增功能被重写，否则旧包比较不再独立。冻结来源的两个file hash在copyProductionArtifact检查，JSON自身hash/48项顺序由wxt-runtime-mapping.test固定。修改现行资源集合联动builder/audit/injection，但不能以“新文件必需”要求历史旧包存在同文件。NOT_RUN。

<a id="file-frozen-mapping"></a>
## e2e/support/19e89b6-runtime-mapping.json：不可变旧代映射数据

blob `ecd5bcc6d17640093e3a7a0d2cc23c260889fa63`；[完整源码 L1–L85](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/support/19e89b6-runtime-mapping.json#L1-L85)。

数据固定sourceCommit=19e89b65fd3600073410407392da82ffa666ffc8，记录constants/runtime-assets两个Git blob及SHA-256；48个Content scripts按旧运行顺序并以content.js收尾，另列content.css、Popup/Options、六Worker、三MAIN。供旧产物闭包存在性/源输入hash与旧注入顺序使用，不执行代码、不表示当前main应该仍为48项。

wxt-runtime-mapping.test以完整JSON SHA-256 21eb874a9db5abf840537398dbf4fe9ed49b3338defed1b4e76ad1ed0dde1d35冻结bytes并测试未来资源不能追溯要求旧代。换基线是明确新代契约变更，须保留旧对照来源及所有消费者一致，而不是随手刷新JSON使测试通过。本轮只读，NOT_RUN。

<a id="file-closed-network"></a>
## e2e/support/closed-network.mjs：启动前精确mock-origin代理

blob `4960503300715ab2ab362e123080d6803e0dfc0d`；[完整源码 L1–L101](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/support/closed-network.mjs#L1-L101)。

startClosedNetwork仅接受显式端口的http://127.0.0.1 origin，拒路径/其他主机/protocol；先listen成功才交launchProxy，bypass <-loopback>移除隐式loopback直连。HTTP仅向该origin开上游连接，拒userinfo/相对URL/外部及替代loopback；转发移除proxy认证头，上游错误给502，abort/response close销毁上游。CONNECT一律403，upgrade销毁；sockets Set在close时逐个销毁并关闭server，listener冲突先reject。

attempts上限1024，仅kind/origin/blocked，无path/query/密码；超出置overflow。snapshot区分mockForwarded、attemptedOutsideMock和forwardedOutsideMock=0，并声明不是零尝试或OS隔离、普通来源不能归因给production/SW。startupNetworkControl生成唯一token的HTTP/HTTPS及替代loopback三origin；assertStartupNetworkControl需token、三调用三settlement、无overflow/外转发、对应HTTP或CONNECT拒绝记录，HTTP为FULFILLED403，HTTPS为REJECTED。

该proxy仅由migration消费者显式启动；不能推广为所有E2E的网络边界。wxt-closed-network测试用真实Node server/proxy及伪观察值负例检验转发、隐私、listen冲突与缺失对照；不替代实际Chromium启动probe。修改规则须重查升级启动时序和证据措辞。NOT_RUN。

<a id="file-upgrade-expectations"></a>
## e2e/support/upgrade-expectations.mjs：升级持久数据的窄例外比较器

blob `3a1a64f3c84255704a6621418f9a34581a081412`；[完整源码 L1–L44](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/support/upgrade-expectations.mjs#L1-L44)。

assertUnchangedUpgradeSnapshot对整个对象deepEqual，同版本字节替换不允许隐式写locale。expectedStorageAfterInstalledUpdate必须收到reason=update及准确previousVersion；仅原storage没有自有uiLocale属性时返回加auto的新对象，有现值（含null/未知字符串）原样保留；不修改before。

assertRecoveredDatabases克隆每行、排序行和库，再deepEqual所有库名称/version/store/rows/fields。唯一例外是ai_bilingual_translator v2的translations/pages现有行lastAccessedAt：按cacheKey/pageKey找原行、双方safe integer、原值≤新值≤observedAt，比较内容时移除该字段。其他store同名字段没有例外，不许新增缓存row或丢数据。没有I/O或业务迁移；它生成/断言期望，真实snapshot由spec读取。

wxt-upgrade-expectations测试突变所有持久域、缺/错生命周期、locale不同现值和“仍有三行却内容损坏”的对照。修改容许差异需对应真实storage owner读写契约，不可为绿测放宽成计数。NOT_RUN。

<a id="file-commands"></a>
## e2e/commands.spec.mjs：实际Command listener的受限探针

blob `5684595926ebd520fde02e426133f6aeb5b061b8`；[完整源码 L1–L85](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/commands.spec.mjs#L1-L85)。

显式test.use commandCallbackProbe，beforeEach reset shared harness，afterEach关driver外所有page。routeCommand先把目标页面带到前台并poll native active tab URL，然后在SW调用实际生产bundle注册的唯一callback；读取probe.sends新增部分，poll已settle的ok回应并返回。第一用例翻译三段且一次Provider，再切两次显隐和Quick Control DOM；第二用例使扩展Popup成为受保护active page，调用callback并等待query，断言一listener、零send/注入/Provider。

这些断言比import原源码handler更接近实际安装bundle，但仍不是浏览器按键/原生shortcut事件或activeTab手势授权证明。探针包装native API并主动调用callback，需和无probe的native permission spec区分。callback/probe全局只在临时SW持有，最终随context清理；修改commands路由需联动startup、manifest command定义、adapter包装与此spec。NOT_RUN。

<a id="file-stardict-consumer"></a>
## e2e/stardict-import-worker.spec.mjs：实际Options的StarDict导入消费者

blob `bc2274b2ed1abb9324680d410f4b36ff70407d24`；[完整源码 L1–L84](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/stardict-import-worker.spec.mjs#L1-L84)。

使用shared harness，创建page后addInitScript只对extension协议包装NativeWorker子类及native sendMessage，保留实际执行并收集transfer/ready/commit/terminate；goto真实Options后MutationObserver记录data-phase。构造一词条.ifo/.idx/.dict合成输入，走文件选择、preflight显示、semantic确认、点击导入，等完成/busy=false/取消按钮隐藏，不往artifact补controller/source module。

结果要求唯一对应WORKER_PATHS的module Worker、terminated、transfer后3个ArrayBuffer长度0、packId/version/fingerprint格式、read→convert→三stage→commit→done及entries/index/manifest阶段路径。ready token与后台COMMIT一致，回包imported、quarantine token已消失，真实LEXICAL_LOOKUP找到本地译文且零Provider。page关闭释放观察器/探针；异常时由context fixture清理。

它覆盖合成成功链，不覆盖真实大型/压缩文件、取消/失败全集或所有外部格式。旧测试的源码import/fake权限路线已移除，现有controller Node测试另补phase/activeRequestId复位断言。修改消息、阶段、Worker transfer或token清理需联动controller/worker/background和此断言；NOT_RUN。

<a id="file-quality-workflow"></a>
## .github/workflows/quality.yml：基础校验CI编排

blob `6e363e3a685ffc7e439bc802ec6ec45826e1e2c2`；[完整源码 L1–L20](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/.github/workflows/quality.yml#L1-L20)。

所有PR与main push触发，只读contents权限，Ubuntu checkout@v4、setup-node@v4固定24.21.0，npm ci --no-audit --no-fund后npm run validate。validate按package当前串行链终止于legacy build；此workflow不安装Playwright Chromium、不启动E2E、不宣称发布认证。安装/命令失败使job失败，无恢复/发布动作或报告上传步骤。改package validate会隐式改变本job覆盖；精确head的run结果需另查询，本轮未查询/执行，NOT_RUN。

<a id="file-e2e-workflow"></a>
## .github/workflows/e2e.yml：legacy/WXT双产物及旧代对照

blob `29fca98c37a59d997c8b044d44fa45e47a85fa04`；[完整源码 L1–L80](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/.github/workflows/e2e.yml#L1-L80)。

main push和受paths过滤的PR触发，contents read，Ubuntu12分钟job，matrix legacy dist/extension与wxt .output/chrome-mv3，fail-fast=false。env显式TF_E2E_ARTIFACT/TF_I18N_ARTIFACT对应矩阵，SOURCE_HEAD=github.sha只是标签。两行均npm ci、安装Chromium、build WXT、有限smoke、build legacy；不能把smoke误称只在wxt行跑。

仅wxt行fetch固定19e89b6并detached worktree，直接运行该旧builder，用GITHUB_ENV指定旧产物绝对路径和新WXT相对路径。最终npm run test:e2e带每行output目录；legacy行没升级环境时对应spec skip。失败上传Playwright report和test-results，名字带矩阵name、缺文件ignore、保留7天；成功没有always上传。runtime/config/scripts/package路径变更触发，纯docs/code不在PR path列表；github.sha在PR事件可代表merge ref，不应猜为PR head。

改fixture默认/locale/升级env必须同步矩阵，避免build一种却测试另一种；更改固定旧代需同步冻结mapping和hash。workflow定义和源码status PASS不是运行记录，全部NOT_RUN。

<a id="test-artifact"></a>
## tests/production-artifact.test.mjs：产物隔离、无fallback与hash回归

blob `45a818c3cf6b9838c16adca19d1afde03b7e6c0b`；[完整源码 L1–L55](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/production-artifact.test.mjs#L1-L55)。

三个Node测试分别用posix/win32/UNC/跨盘/大小写路径验证同或嵌套路径拒绝；造仅有manifest的临时包要求缺background映射失败、缺目录ENOENT并源码断言不存在builder；造所有runtime路径的synthetic bytes，检查copy tree/files/bytes完全一致、同/子/已有目标失败、加入tests目录拒绝。所有临时目录finally rm。该测试验证adapter合同，不代表合成JS能执行或sourceHead可信；修改复制/路径/hash逻辑优先运行它并补真实artifact E2E，NOT_RUN。

<a id="test-entry"></a>
## tests/wxt-e2e-entry.test.mjs：E2E默认值与缺包早失败

blob `e87a514e7f5109bcd810be4b44283e6c1ce6c6b8`；[完整源码 L1–L29](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/wxt-e2e-entry.test.mjs#L1-L29)。

第一例断言空env默认WXT且locale跟随、显式legacy同步locale、自定义locale保留、空artifact throw。第二例临时造残留legacy manifest，默认WXT仍ENOENT；显式legacy返回路径；spawn当前Node运行真实wrapper配missing路径，要求status1、无spawn error、stderr ENOENT且未Running，finally删除目录。它不运行成功Playwright suite，不能当WXT浏览器验收；修改命令入口和CI env选择应保持此失败路径。NOT_RUN。

<a id="test-mapping"></a>
## tests/wxt-runtime-mapping.test.mjs：旧代合同固定与未来闭包隔离

blob `df06c5574c0aa7b7a00c0dfdd5f98644613f2b85`；[完整源码 L1–L31](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/wxt-runtime-mapping.test.mjs#L1-L31)。

读取冻结JSON，断言精确sourceCommit、两Git blobs、48Content最后content.js及完整文件SHA，mappingForGeneration必须返回相同内容，未知代次失败。另用Set构造旧映射路径，未来current多一资源应缺失失败，补入后成功，删旧MDD worker旧代仍失败。纯内存/读文件，无Chromium/安装；守住“当前资源不能反向污染旧对照”，修改mapping需保留此独立性，NOT_RUN。

<a id="test-network"></a>
## tests/wxt-closed-network.test.mjs：代理真实socket与启动对照负例

blob `bcbdc3359ef41d993279d59fc7c6f3f092079822`；[完整源码 L1–L64](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/wxt-closed-network.test.mjs#L1-L64)。

throughProxy用Node http.request直接走launchProxy，2秒超时，CONNECT socket销毁。第一例真实mock/proxy只转发精确origin一次，外部、localhost、https、userinfo、相对路径、CONNECT均拒绝，报告不得含path或password且只保留三字段；finally关闭两server。第二例拒非法allowed origin及占用同端口，保证浏览器launch前失败。第三例合成三settlement及proxy记录，删观察、calls置零、漏attempt/result、overflow或forwardedOutsideMock>0全部拒绝。

它证明Node代理行为与checker不能接受缺证据，不自行创建MV3 worker；实际启动链另由升级spec证明。修改代理协议、报告预算或probe origins需对应两类测试，不可用fake result替代native fetch。NOT_RUN。

<a id="test-upgrade"></a>
## tests/wxt-upgrade-expectations.test.mjs：全量持久快照的对抗回归

blob `a7e43aa8db76b9ddcd56e07f2f0cfdd6c098c2c1`；[完整源码 L1–L90](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/wxt-upgrade-expectations.test.mjs#L1-L90)。

四组Node用例：同版本保持完整snapshot，逐项突变storage/DB/OPFS/registration必须失败；native update必须有准确旧version且只补缺locale；既有auto/en/zh_CN/unknown/null不能被删/替换；缓存恢复排序可变、translations/pages lastAccessedAt可在界内前进，其余内容/identity/大小/创建时间/store/库名版本/额外库任何差异拒绝。对抗case刻意保留三条translations，展示旧计数guard不充分；也确认before不被helper修改。

没有数据库操作或升级安装，只检验期望比较器。改例外字段/版本必须连同cache owner语义和真实snapshot消费者复核；运行NOT_RUN。

<a id="test-wxt-assets"></a>
## tests/wxt-assets.test.mjs：raw桥、词典及Manifest负例

blob `605b3ac67f1799df573a0882e4cb4ff723bfa7f5`；[完整源码 L1–L101](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/wxt-assets.test.mjs#L1-L101)。

七组Node测试检查roots开头遵循Content/Style顺序、MAIN同一引用、页面路径、闭包含worker/importer且不包含编译页面/后台；拒traversal/绝对/远端/空段；分别用win32/posix验证跨盘UNC/父目录；临时relative import可闭包且symlink escape失败；missing词典开发显式报告、release拒绝；已认证fixture只四文件、忽略stray source-lock、symlink及corrupt shard拒绝；productionManifest deepEqual拒加权限/static scripts/WAR/升最低Chrome/options_ui/改变背景语义。

依赖真实源码常量、临时fs和fixture；finally删除所有temp目录。不会调用完整WXT构建hook/启动浏览器，故需要build audit/smoke独立证据；变更asset安全边界须保留负例而非只更新成功快照。NOT_RUN。

<a id="test-presentation"></a>
## tests/curated-install-artifact-presentation.test.mjs：从浏览器源码import移出的纯展示合同

blob `1f59eff1326755dc7b37f2dfc332c5e2100dd792`；[完整源码 L1–L15](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/curated-install-artifact-presentation.test.mjs#L1-L15)。

以CURATED_DICTIONARIES首来源和healthy旧packVersion调用真实纯getCuratedInstallPresentation，断言update-available、已审核更新badge及更新按钮文案。无DOM/浏览器、下载/安装/storage；这个synthetic旧版本展示不能冒充实际artifact安装升级。它承接curated-ecdict-product移出的browser-side source-module import检查，生产安装/display仍由native E2E负责。修改presentation规则、catalog首项或locale文案要重查此例与真实产品用例，NOT_RUN。

<a id="package-routing"></a>
## package.json：命令总路由（局部）

[package.json L1–L73](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/package.json#L1-L73)；blob `366e613a206b983c14b911c0fbb49527e527519c`。private ESM package版本0.8.0，Node>=24.21.0<25、npm>=11.19.0<12、packageManager npm@11.19.0；依赖全部列devDependencies，固定WXT/Vite/React/TypeScript/Vitest/Playwright及test工具版本。依赖存在不证明React已进入产品页面。npm prepare执行wxt prepare；typecheck/test:unit也先prepare，dev是WXT Chrome MV3，build默认legacy而WXT为独立opt-in。

本切片已完整解释check/check:i18n/test/validate/test:e2e、两套build、smoke和test分域的路由。其他scripts分为词典setup/build/project/ingest、source audit、quality benchmark/evaluate、发布/产品certify、成本measure和富词典安全/取消focused tests；这些调用各自脚本，不等于validate自动包含它们。各来源下载、认证算法及锁文件解析尚未逐一讲解，因此package保留局部，不能以列出脚本名计全覆盖。更改任何script会影响对应CI，需查实际消费者。

<a id="upgrade-consumers"></a>
## 升级与native平台专项消费者（局部）

- [e2e/wxt-upgrade.spec.mjs L1–L301](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/wxt-upgrade.spec.mjs#L1-L301)：两情景为缺失uiLocale/已有zh_CN；旧新artifact双环境缺任一skip。旧/新同version、同路径/profile/ID，旧package两mapping输入hash验证；真实Settings导入两个synthetic MDX/MDD、首选/启停、三翻译cache、站点注册并集后读取全部storage/DB/OPFS/registrations。替换后识别cached-old runtime并保持完整快照；管理reload才以native lifecycle和Reading v2 NOT_READY证明新runtime激活，允许仅缺locale默认写。旧world通过原消息channel失败证明失效，刷新后cache恢复Provider仍1次，DB只容许窄lastAccessedAt变化，重启全快照继续相等。报告含phase/原树hash/testChanges/probe/network/ID/浏览器、失败保存partial completeAcceptance=false；嵌套finally释放context/proxy/server/temp，setImmediate后比较真实TCP listener数量。这里解释证据链，未逐一展开dictionary/snapshot/stable/summary及所有UI断言，保持局部。
- [e2e/wxt-injection-samples.spec.mjs L1–L90](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/wxt-injection-samples.spec.mjs#L1-L90)：旧/新明确输入，每代使用自身runtimeMapping，复用profile/path/ID；WXT强制管理reload、要求新worker和executionProof=原tree hash，再用native Reading响应区别旧runtime。各十次新article测cold insertCSS→scripts→status，原document再注入测warm；sameApp、loaded/module count不变，无译文/Provider，每次关page并核对pages数。报告原样本与median/min/max，没有性能阈值；不是单纯对source文本计时。未完整解释全部report字段/浏览器创建过程，局部、NOT_RUN。
- [e2e/wxt-platform-permissions.spec.mjs L1–L165](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/wxt-platform-permissions.spec.mjs#L1-L165)：真实临时Chrome management API控制权限，无fake permissions.contains/executeScript。先取可访问页面native稳定tabId；未申请localhost作为hard-denied严格REJECTED对照；required-but-withheld及revoked在1000ms窗口逐样本观察真实promise只可PENDING/REJECTED、marker=0且native receiver不存在。fresh document上的grant必须FULFILLED且frame0 marker可见，三站点模式并集只一条native注册；撤权/重启要求权限false、注册与站点设置被剪除、Provider0。报告明确pendingConsentCompletion和browserPermissionPrompt NOT RUN，不能说权限弹窗已被点击或待定最终被拒绝。仍保留局部，未把全部probe状态/测试平台特有API视为生产架构。

<a id="consumer-deltas"></a>
## 其余消费者增量与测试边界（局部）

[e2e/curated-ecdict-product.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/curated-ecdict-product.spec.mjs)仍走真实Settings安装/状态/Selection与本地查询，移出的旧版本presentation源码import现由上文16行Node合同承接；没有因此证明整套真实上游兼容。本文件约250行产品检查本章未全量解释。

[e2e/design-freeze-poc.spec.mjs L1–L60](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/design-freeze-poc.spec.mjs#L1-L60)的prepareExtension改为copyProductionArtifact(defaultArtifact,extensionDir)，缺资源不会调用旧builder。仍是POC：[e2e/design-freeze-poc.spec.mjs L268–L331](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/design-freeze-poc.spec.mjs#L268-L331)的文本extract是page.evaluate内自建算法，不能当生产selection source；末尾权限用例通过测试按钮发native request，等待500ms后接受result=null，最多证明观察窗口内仍pending，不能由此断言用户已授权或权限弹窗实际完成。OPFS/签名/恢复POC全流程尚未逐一解释，局部。

[tests/ecdict-mdx-package-boundary.test.mjs L14–L49](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/ecdict-mdx-package-boundary.test.mjs#L14-L49)确实直接调用legacy builder在temp输出，检查无MDX/MDD/ZIP、包小于corpus、生产host不宽、worker无cache bridge；读取缓存override的源码路径移到production-artifact。它是明确的builder单测，与shared E2E“不内部build”不冲突。本章不展开corpus lock与发布准入合同，局部。

[tests/selection-release-certification.test.mjs L10–L64](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/selection-release-certification.test.mjs#L10-L64)检查shared fixture出现prepareExtensionTestCopy且无buildExtension，corrupt/incompatible改查adapter；其余是源码marker/regex保护required fixture家族、Provider0/交互/隐私断言。静态包含标记不是浏览器执行；完整Selection认证另读该suite，局部。

[tests/stardict-import-controller.test.mjs L60–L100](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/stardict-import-controller.test.mjs#L60-L100)成功commit新增controller.phase==空、activeRequestId==空，结合worker terminated；这没有改变生产controller代码。大型suite的fake worker/取消/错误分支仍未逐文件完整说明，不将两个新增assert算全覆盖。

<a id="partial-ci"></a>
## 专项CI如何选择产物（局部）

以下workflow已读但只解释本链相关入口/产物/证据，不把其庞大认证步骤和全部触发规则算完整解释。均contents:read；定义不是运行结果，全为NOT_RUN。

- [.github/workflows/lexicon-release.yml L65–L144](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/.github/workflows/lexicon-release.yml#L65-L144)：锁定OMW/WordNet checkout→setup:lexicon、benchmark/bootstrap/footprint/StarDict cost→Selection+pack certify→validate构建legacy→Chromium E2E。环境显式TF_E2E_ARTIFACT及TF_I18N_ARTIFACT=dist/extension、SOURCE_HEAD=github.sha、REQUIRE_RELEASE_LEXICON_PACKS=1、JSON报告；再Offline Beta certify。上传质量/发布词典/认证报告各自保留期，不是商店发布。
- [.github/workflows/dictionary-library-vnext-certification.yml L120–L256](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/.github/workflows/dictionary-library-vnext-certification.yml#L120-L256)：独立临时cache/evidence-private/evidence-published及run marker；setup词典/validate提供legacy，锁定writer/真实MDX及100MiB MDD证据、focused E2E显式dist。vNext汇总后检查冻结scope必要slice状态，ready才resolve可信base并跑ecosystem certify，否则打印pending，仅上传脱敏published summaries。一个vNext子认证成功不能推导最终生态gate完成。
- [.github/workflows/mdd-resources.yml L38–L89](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/.github/workflows/mdd-resources.yml#L38-L89)：锁定独立writer→regenerate/checksum/large-range evidence→parser/security测试→Chromium→明确build:extension→直接npx playwright MDD spec并选dist/SOURCE_HEAD；always上传有限evidence，非corpus。
- [.github/workflows/rich-lookup-cancellation.yml L39–L78](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/.github/workflows/rich-lookup-cancellation.yml#L39-L78)：full checkout、锁定基线测量→明确legacy build→取消spec（CI true、dist/SOURCE_HEAD和证据目录）→always保留两个脱敏baseline/report。源码存在这个基线流程不表示本轮跑过。
- [.github/workflows/rich-mdict-compatibility.yml L83–L120](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/.github/workflows/rich-mdict-compatibility.yml#L83-L120)：先验证固定upstream MDX、parser/sanitizer，再legacy build；五个真实/本地preflight/one-click/hostile viewer specs显式dist/SOURCE_HEAD，ECDICT gate=1；always只上传证据目录，never corpus。它不消费默认WXT，即使本地wrapper已改默认值。

<a id="partial-adjacent"></a>
## 相邻完整说明与仍待解释的依赖

已在启动章完整解释的[wxt.config.mjs](startup.md#file-wxt-config)及[entrypoints/background.ts](startup.md#file-wxt-background-entry)源码blob与本基线相同，继续复用原章；前者收集compiled closure/精确public assets/locale，后者只有initializeBackground薄入口。它们不重复计27个新增说明。

下列文件只在调用边界解释，保留局部：[scripts/source-boundaries.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/scripts/source-boundaries.mjs)负责inspectSources及SOURCE_EXTENSION，[scripts/source-api-boundaries.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/scripts/source-api-boundaries.mjs)承接API所有权分析；本章未读完/解释AST依赖和alias细节。[e2e/support/mock-server.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/e2e/support/mock-server.mjs)提供startMockServer、baseUrl、calls/reset及mock fixture/cached archive响应，本章不解释全路由；[scripts/build-tflex-technical.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/scripts/build-tflex-technical.mjs)编译测试Technical pack，不把这个调用当完整来源/索引算法说明。

[docs/PLATFORM_UPGRADE_V1.md](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/docs/PLATFORM_UPGRADE_V1.md)是多轮契约和历史证据追加记录，开头旧Node/无lock描述绑定历史baseline，末尾更正证据也有各自head；本章只采用实际main代码路由，不把其中历史PASS继承成本轮运行结果。[README.md](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/README.md)安装dist路径、[CONTRIBUTING.md](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/CONTRIBUTING.md)validation约定和[docs/ARCHITECTURE.md](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/docs/ARCHITECTURE.md)双构建边界用于交叉核对，不算这些长文档逐文件完成。依赖锁文件、词典来源认证链、其他CI仍待后续切片。

<a id="output-safety-followup"></a>
## 已知输出删除风险与未合入修复

2026-10-03 08:29 UTC读取：[作者记录的#248事故](https://github.com/CoderLambert/translateflow-plugin/issues/248#issuecomment-5966960943)说明阶段二worktree曾被破坏性build/cleanup覆盖删除，主工作区和#234未受影响；[修复PR #278](https://github.com/CoderLambert/translateflow-plugin/pull/278)当时open、未merged，head为a33b6e2dd3db8f123b026df988e525eaab0081e7。[该head的P1审查](https://github.com/CoderLambert/translateflow-plugin/pull/278#discussion_r4172284125)指出允许输出树内的嵌套.git尚可被递归删除。此处是带日期的已知后续，不把未合入修复或review报告当本章86ed实现。

固定main的legacy builder在安全判断后会rm(output,{recursive:true,force:true})；ROOT由fileURLToPath目录URL保留尾分隔符，而output经过resolve，raw equality不能作为规范化same判断。默认insideDist限制与allowExternalOutput路径必须分开：后者跳过insideDist，不能宣称可安全删除任意外部测试目录。代码也没有删除前的canonical/link/目标内部Git工作区保全检查。上文描述检查分支是实现走读，**不构成其全面安全保证**。不要在真实源码根/用户目录重现破坏性负例；本轮未执行任何build/delete回归。默认WXT切换仍未由此交付。

