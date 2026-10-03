# 构建与测试：逐文件说明

[完整功能链](../features/build-test-release.md) · [首页](../README.md)

固定源码 main `d5246cae6469e4a876fc122b229a2e0ddf115709`，2026-10-03复核；以当前源码重校 docs/code-walkthrough 的 f7bf28b546a58ac7debe6dd951bb502434dd915a 文档。本轮完整读取并解释下列30个文件；大型spec、专项CI、package脚本总路由与依赖分析器保留局部。wxt.config.mjs 当前实现移至本章完整说明；entrypoints/background.ts 仍由启动章负责。运行验证全部 **NOT_RUN**；本文只说明代码中的断言与输出，不继承历史PASS，也不推导 realOxford 通过。

## 完整文件索引

- [scripts/build-extension.mjs](#file-build-extension)
- [scripts/path-boundaries.mjs](#file-path-boundaries)
- [tests/path-boundaries.test.mjs](#test-path-boundaries)
- [wxt.config.mjs](#file-wxt-config)
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
## scripts/build-extension.mjs：单一 WXT 引擎与稳定安装路径

blob `fcefb73aff39e16bbde47dabe7fc7217df33589d`；[完整源码 L1–L61](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/build-extension.mjs#L1-L61)。

**入口/输入输出。** package 的 build:extension、build:extension:release 和 build:extension:wxt 均调用此 CLI；export buildExtension({outDir,requireLexicon,allowExternalOutput}) 默认输出 dist/extension。parseArgs 只收 --out 与 --require-lexicon；缺值/未知参数失败。返回 output、builder:"WXT"、fileCount/totalBytes/lexicalBytes、lexicalAssetsIncluded 和按 size 降序/path 排序的 largestFiles 前20项；没有旧 allowlist 复制引擎。

**阶段/所有权。** ROOT 先 resolve 规范化。第一次 assertBuildOutputPaths 允许 dist 的严格子目录和精确 .output/chrome-mv3，再 mkdtemp 创建独立 OS 临时 staging。用 promisify(execFile) 以当前 Node 调本仓 node_modules/wxt/bin/wxt.mjs build -b chrome --mv3，cwd 固定 ROOT、maxBuffer=4MiB；透传环境但覆盖 TF_WXT_BUILD_ROOT 与由 requireLexicon 决定的 TRANSLATEFLOW_WXT_REQUIRE_LEXICON。WXT 输出在 staging/output/chrome-mv3，reports 在 staging/reports；子进程完成后 auditWxtExtension 对两者执行审计。

**提交/清理。** audit 后再次 assertBuildOutputPaths，才 rm 最终输出→mkdir→cp 审计过的包。只有最终输出恰为 .output/chrome-mv3 才把 staging reports 复制到 .wxt/reports，供 standalone smoke 消费。默认 dist 不持久保存这份 audit report，也不刷新另一目录已有包/报告。finally 无论成功失败都尝试 rm staging；CLI catch 输出 stack 并设 exitCode=1。

**失败/并发边界。** 构建/audit 失败不先破坏已安装目录；但最终 rm→copy 不是原子 rename 或回滚事务，mkdir/cp/report-copy/finally 失败可能留下不完整产物或使调用失败。独立 staging 隔离中间文件，不提供同一最终输出的跨进程锁。无取消 API；不能从目录存在或 builder 字段声称浏览器已验证。requireLexicon 现在进入 WXT descriptor/fingerprint 检查，不再只检查词典目录曾被复制。修改入口/输出/环境须联动配置、audit、安全 helper、package/CI 和实际包消费者；[安全回归](#test-path-boundaries)含真实临时 WXT 构建，但本轮 NOT_RUN。

<a id="file-path-boundaries"></a>
## scripts/path-boundaries.mjs：构建输出与测试副本的共用路径边界

blob `03d46bdf9085d8510155c2b6a00b36705967d4c1`；[完整源码 L1–L112](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/path-boundaries.mjs#L1-L112)。

**纯关系与可写范围。** pathRelation(parent,candidate,pathApi) 先 resolve 两端，relative 为空是 same；相对结果不是绝对、.. 或 ..+sep 才是 descendant，反向同理判 ancestor，其余 disjoint。允许注入 posix/win32，避免原始字符串、尾分隔符或固定 / 前缀判断。assertDisjointPaths 只接受 disjoint。assertBuildOutputLocation 禁源码根/祖先/磁盘根；源码内仅允许 dist 的严格子目录，或 allowWxtOutput 明确允许的精确 .output/chrome-mv3；dist 本身不允许。allowExternalOutput 只在纯判定开放源码外路径，不跳过后续磁盘边界。

**磁盘核验。** optionalLstat 仅吞 ENOENT；canonicalPath 向上寻找存在祖先，用 realpath 加回未创建的路径段，缺失子目录也能检查真实归属。assertBuildOutputPaths 先纯判定；源码外路径还须位于 tmpdir 或其 canonical 根的严格子目录。trusted source/OS-temp root 可以是系统别名，assertDirectoryWritePath 从目标向上检查其下每级：symlink、已有非目录或 .git 标记即拒绝；拥有者根自身可带 .git。assertDisposableOutputTree 再递归整个目标树，大小写不敏感拒 .git、拒任意 symlink，防仅查祖先漏掉嵌套 worktree。最后对 canonical source/target 再判位置，返回规范化目标。

**测试副本与限制。** assertDisjointPathsOnDisk 先词法不相交，再限定副本到临时根、检查写入路径/目标树，最后 canonical 双端仍须不相交；copyProductionArtifact 在读取/复制前调用。helper 只读 filesystem，不执行 rm/cp，不授予任意外部删除权。检查与随后写入之间没有锁或基于句柄的原子绑定，不能描述成恶意并发替换下的全面防竞态保证；builder 两次复检也不等于发布事务。

**修改入口/测试。** 路径、symlink、Windows/UNC/temp 系统别名规则变化须同时审查 builder、artifact adapter、wxt-assets 的 pathRelation 复用及下列负例。#278 对应实现已在本基线；本轮没有拿真实源码/worktree 根调用破坏性 builder。NOT_RUN。

<a id="test-path-boundaries"></a>
## tests/path-boundaries.test.mjs：安全判定与一次性临时目录回归

blob `c70e53d6ef533f0dfac8e01dff733e08d54461ff`；[完整源码 L1–L141](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/path-boundaries.test.mjs#L1-L141)。

五个 Node 测试覆盖：ROOT 规范化且真实源码根别名仅交纯 predicate；posix/win32/大小写/尾分隔符/parent segments/跨盘/UNC 四种关系及 dist/WXT 许可；一次性 temp 中存在/缺失 symlink、foreign .git、嵌套 .git、非目录和 retained sentinel；隔离子进程通过 TMPDIR/TMP/TEMP 验证系统临时根别名与 canonical 根均可用、根本身及其下 redirect 不可用；真实 buildExtension 只写 temp/package，断言 builder=WXT、background 不再 import 原根 index、Options 有 chunks、MV3，并确认链接或目标内部 worktree 被拒后 sentinel 保留。

posix/win32 pathApi 模拟词法规则，不代表各 OS 已实测；symlink/junction 按当前平台，真实 WXT builder 依赖调用环境。子进程临时环境不改父进程；实际目录 finally 删除。危险源码/盘根负例不调用 rm 型 builder。本文件含真实构建说明 npm test 不是纯静态检查；本轮不安装、不执行用例，NOT_RUN。

<a id="file-wxt-config"></a>
## wxt.config.mjs：编译入口、精确桥接与每次构建报告

blob `e1fe3d14d9ebeaf291ff32b221ecd66bf49e18d6`；[完整源码 L1–L58](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/wxt.config.mjs#L1-L58)。

**加载/输入。** 顶层读唯一 manifest.json，去掉 manifest_version 后交 WXT（CLI 指定 MV3）；runtime-assets 给页面路径，wxt-assets 给 raw/lexical 闭包，i18n-locales 给受控 locale。imports=false 不自动导入业务依赖；@wxt-dev/module-react 是工程模块，不能推导产品已用 React。Vite JS/CSS target=chrome102、sourcemap=false，是编译目标而非 Chrome 102 实测。

**staging 与编译图。** 有 TF_WXT_BUILD_ROOT 时 outDir=该目录/output、reportDir=该目录/reports；否则 WXT 默认输出及 .wxt/reports。compiledChunks 是本配置加载内的可变数组；build:before 清空，generateBundle 记录每个 output 的 fileName/type，chunk 另记 imports/dynamicImports/modules（移除 ROOT 前缀）；build:done 写 compiled-closures.json。audit 消费此图，不是独立重编译或供应链签名。

**HTML 与 Manifest。** entrypoints:found 直接注册原 popup.html 为 popup、options.html 为 unlisted-page，没有第二份 UI 模板；后者保留 options_page/full-tab 语义而非 options_ui。entrypoints:resolved 必须找到 popup，再设 defaultTitle=Manifest action.default_title，区分 HTML title 与 Chrome 本地化 action title。background TS 薄入口由 WXT 常规发现，见[启动章](startup.md#file-wxt-background-entry)。

**public assets 与失败。** build:publicAssets 遇非空现成 assets 即 throw，禁止泛化 public 目录；按 Content/MAIN/Worker 的 sourceClosure、checkManifestLocales 后的 locale closure、lexicalAssetFiles descriptor 精确集合追加 absoluteSrc/relativeDest。开发缺词典 warn 并记录 missing；TRANSLATEFLOW_WXT_REQUIRE_LEXICON==="1" 时缺包失败。asset-map.json 写 raw/lexical/locale 清单，audit 与当前源码重算比对。资源失败不补拷整个 src；报告写盘失败中断构建。外层 builder 拥有 staging 生命周期和最终发布，本配置不清理最终目录。修改 hooks/命名/资源根须联动 audit、smoke、mapping；NOT_RUN。

<a id="file-wxt-assets"></a>
## scripts/wxt-assets.mjs：精确raw与生成词典资产闭包

blob `b9afabb9407bbfa7c1ca6dc9a333b816a11df2ea`；[完整源码 L1–L110](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/wxt-assets.mjs#L1-L110)。

**依赖/算法。** ROOT绑定repo且经resolve规范化；legacyAssetRoots把有序Content JS/CSS、MAIN及WORKER_PATHS组成roots。sourceClosure递归读取相对JS import/from/import()及带引号CSS import/url，Set去重防环，最终返回排序路径集合。真实文件先realpath，isInsideSourceRoot复用pathRelation，仅接受descendant，拒绝根自身、父级、Windows跨盘/UNC越界；assertAssetPath拒绝反斜杠、冒号、空段、点和父级段。扫描是限定语法的正则闭包，不是任意JavaScript/CSS依赖解释器；不能据此允许computed或外部imports。

**词典/状态。** lexicalAssetFiles逐个BUNDLED_LEXICON_PATHS读manifest，ENOENT记missing，其余错误上抛；拒绝重复路径，验证格式/manifest fingerprint，然后限制directory.json lookup-index、THIRD_PARTY_NOTICES license-notice及shards/*.jsonl lexical-data。每个descriptor核对size/hash、真实路径及普通文件，未声明的stray source-lock不会复制。requireLexicon遇任一missing失败。各调用局部数组/Set，无持久状态；不修改源文件。

**统计/测试/影响。** walkFiles拒绝非普通目录/文件的artifact entry；byteSummary排序文件并区分lexical/code字节，供audit和inventory。wxt-assets.test用真实临时文件、symlink及posix/win32路径测试约束，也检查缺包与corrupt；NOT_RUN。新资源要先更新唯一runtime mapping/真实源码依赖，再审查build hook和audit；roots顺序不能拿最终排序的资产集合替代。

<a id="file-audit"></a>
## scripts/audit-wxt-extension.mjs：生产WXT完整资产审计

blob `e2daa7a5480d136a891f8f72e612b3ec737b37c5`；[完整源码 L1–L86](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/audit-wxt-extension.mjs#L1-L86)。

**输入/步骤。** auditWxtExtension默认.output/chrome-mv3和.wxt/reports，读取输出与源码Manifest、asset-map、compiled-closures，重新推导raw/locale/lexical闭包与byteSummary。assertProductionManifest直接deepEqual全部字段，包括权限、版本、options语义；不是少数字段近似比较。present必须等于Manifest+页面+精确raw/词典/locale+所有记录的compiled输出，不允许缺项或多项；raw/locale/词典逐文件比源bytes，编译依赖路径必须实际存在。

**安全/输出。** 模块ID拒绝测试库、React、开发/私有源、WXT dev helper；安装树禁测试/构建/语料目录、map/pem/crx/zip、HMR和远端HTML资产。HTML script/link引用须在present。代码预算1576595字节不含lexical，统计background静态import闭包和UI chunks/assets+HTML；预算/报告不是延迟benchmark。报告status PASS仅在所有assert完成后写production-audit.json，本轮没有生成。output/reportDir 可由 builder 指向隔离 staging；报告 source 文案仍固定为 WXT production .output/chrome-mv3，不是实际输入路径证明，应使用调用上下文与 artifact inventory。

**失败/修改。** 读文件或assert失败即终止；无补文件、取消、重试或回滚。compiled-closures是构建hook提供的清单，audit不是独立重编译验证，更不是供应链签名。wxt-assets.test对Manifest扩权限、静态注入、web-accessible、Chrome最低版本/options_ui/background差异设置负例；修改bundle命名/资产依赖需同步配置、预算和smoke。NOT_RUN。

<a id="file-run-e2e"></a>
## scripts/run-e2e.mjs：明确选择产物的Playwright入口

blob `2f95ffa227fc8f1a9310dd1d97e71c1f2a8188a8`；[完整源码 L1–L37](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/run-e2e.mjs#L1-L37)。

e2eEnvironment保留传入env，以nullish默认TF_E2E_ARTIFACT=.output/chrome-mv3，非空trim断言；未设TF_I18N_ARTIFACT跟随所选包，显式locale保留。requireE2EArtifact仅resolve并access manifest，不认证整包；后续adapter负责runtime mapping。main透传CLI args，list/help/version免执行检查，以当前Node调用@playwright/test/cli test，cwd固定repo，stdio继承；spawn error抛出，status空视1，catch打印message并置exitCode。

没有构建调用、搜索残留dist、fallback或补asset。wxt-e2e-entry测试构造“dist包存在而默认.output包缺失”（测试名保留历史legacy措辞）并断言仍ENOENT，同时对子进程缺包路径断言退出1且未开始Running；NOT_RUN。改默认值、环境优先级或参数处理会影响全部package E2E入口及locale专项/CI矩阵，必须联动fixture和workflow。

<a id="file-check"></a>
## scripts/check.mjs：语法与架构检查编排

blob `b3c6f3538d4ab75d1cca49b5bbe9f65943d3da0c`；[完整源码 L1–L47](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/check.mjs#L1-L47)。

CLI仅允许无参数或--root directory，后者供同规则的正负fixture。递归遍历跳.git/node_modules及根.wxt/.output/dist；用source-boundaries导出的SOURCE_EXTENSION筛选源文件，对JS/MJS/CJS逐一node --check，把stderr汇总；再把全部源交inspectSources。另查MV3/module背景固定background.js、根background/content入口行数、废弃根cache-db不存在。失败逐项输出并exit1，成功报告源数；不导出应用runtime、不写安装包。

failures局部收集，不能因为单个语法错误停止后续边界采集；JSON/manifest错误加入列表，但目录读取等未专门catch。TS/TSX的语义/typecheck由另一路负责，不是node --check。source-boundaries及source-api-boundaries大型分析器本章仅相关入口，未解释其全部AST/alias规则；改过滤/跳过目录需同时审查它们、source-boundaries测试及tsconfig，防生成文件误入或真实源码遗漏。NOT_RUN。

<a id="file-i18n"></a>
## scripts/i18n-locales.mjs：Manifest locale可重复投影与检查

blob `f28c31e218d6933156620ee9579dba0b0c7816e3`；[完整源码 L1–L38](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/i18n-locales.mjs#L1-L38)。

checkManifestLocales从纯i18n catalog的validateCatalogs/getManifestMessages获得权威投影，核对Manifest default_locale=en及六个name/description/action/commands引用恰为__MSG_key__。对MANIFEST_LOCALE_FILES根据目录名选语言，用固定JSON缩进+换行生成expected；正常只读逐字比较，generate=true才mkdir/write后核验。返回keyCount及files，默认/显式 WXT 输出共用，语言源只有一份。

CLI只接受--generate/--check，未知参数throw；generate是明确写生成locale的模式，不在普通check偷偷修复漂移。缺失/陈旧文件或catalog错误阻止构建。无长期状态/回滚/重试；不是用户UI locale存储适配器，也不改变Provider target。修改Manifest消息名、catalog或支持语言需同步runtime-assets、两个 WXT 输出消费者和语言测试；本轮NOT_RUN。

<a id="file-smoke"></a>
## scripts/smoke-wxt-extension.mjs：有限WXT产物Chromium验收脚本

blob `6aae188836a20ec38d14c764f8dee4fc503e8e9f`；[完整源码 L1–L125](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/smoke-wxt-extension.mjs#L1-L125)。

**建立/消费。** 顶层先audit实际WXT，不build旧包；临时目录复制.output/chrome-mv3，替换为synthetic Core、由reviewed本地extract编译Technical，仅临时Manifest加127.0.0.1权限。persistent context使用临时profile；实际Popup/Options可见控件及CACHE_STATS校验页面/后台。每个WORKER_PATHS通过真实module Worker发unknown message，期望对应错误type/requestId，超时/错误均terminate；这只验证worker装载及非法输入回包。

**主链/断言。** 设置本地mock Provider；本地persistent查词应返回两个fixture候选且零Provider；有序注入Content及MAIN，检查MAIN version，正文三段翻译一次调用、保留链接/code且无结构token泄漏；clear再restore得三cache hits且调用仍一。动态注册为空、pageerror/externalRequests为空后写.wxt/reports/browser-smoke.json，列完整E2E/升级/真实Chrome102/YouTube/Provider等notRun。

**边界/清理。** context.route在launch后建立，不能约束此前SW启动网络；不得把externalRequests=[]写成全部进程零外联。本脚本与新shared adapter是两条独立测试副本路径，不自动拥有production-artifact的tree/testChanges证明。finally关context、server、删临时目录；顺序清理不是嵌套容错，早一步清理异常可中断后续。修改runtime路径、UI控件、worker错误协议会影响smoke；全部NOT_RUN。

<a id="file-playwright"></a>
## playwright.config.mjs：浏览器测试发现与诊断策略

blob `c025e62d0c740f056b3f061eb0da00a17d310516`；[完整源码 L1–L20](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/playwright.config.mjs#L1-L20)。

defineConfig只发现e2e/**/*.spec.mjs，test超时30秒、expect6秒，fullyParallel=false/workers=1。CI重试一次并启用line+不自动打开的HTML reporter，本地零重试且line；outputDir=test-results/e2e，trace只保留失败。spec可覆盖timeout/output配置，所以升级180秒不与全局矛盾。此文件不build包、不授权限、不选profile；shared/专用fixture负责生命周期。修改发现范围或并行数会影响worker-scoped资源/串行证据与CI报告目录；重试通过不能抹去首次失败，NOT_RUN。

<a id="file-vitest"></a>
## vitest.config.ts：与Node和E2E隔离的unit配置

blob `5b4f30eb9750cc76078ab3466d2c6f4ee0034c37`；[完整源码 L1–L14](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/vitest.config.ts#L1-L14)。

Vite React plugin服务测试编译；test.include仅tests/unit/**/*.test.ts、tsx，明确排除旧mjs/E2E/node_modules和所有输出目录。默认environment=node、globals=false、maxWorkers=2、passWithNoTests=false，组件测试需自己声明jsdom。没有fixture代码自动进入生产构建；audit另防测试/React污染。修改include或environment需复核package test:unit、tsconfig及具体测试注释，不能把Node测试数量或没有测试运行算通过。NOT_RUN。

<a id="file-tsconfig"></a>
## tsconfig.json：严格新TS与声明文件编译域

blob `3439e83619736dedfa783ac6fdcb6075d695836f`；[完整源码 L1–L20](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tsconfig.json#L1-L20)。

extends WXT生成tsconfig，target ES2022/lib含DOM，strict/noEmit、noUncheckedIndexedAccess、exactOptionalPropertyTypes、skipLibCheck=false；ESNext/Bundler、react-jsx，types限定node/react/react-dom。allowJs=true但checkJs=false，旧JS可以互操作，不代表全仓JS已严格检查。include明确列WXT paths/i18n声明、本仓types、新src/entrypoints各TS变体、unit及Vitest配置，排除node_modules/output/dist/e2e。

typecheck和test:unit入口先wxt prepare提供生成类型；缺失/冲突由编译报错而非运行时fallback。该配置只定义编译域，不安装浏览器globals；未包含完整WXT env声明的已知限制仍应读TYPES_TESTS_V1。改include/exclude、skipLibCheck或alias需同步类型合同与source boundary，不能用扩大排除使失败消失。NOT_RUN。

<a id="file-production-artifact"></a>
## e2e/support/production-artifact.mjs：实际生产包复制、证明与受限适配

blob `ca29ef79fb97c172ed36fdc62e40f069c90303b9`；[完整源码 L1–L254](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/support/production-artifact.mjs#L1-L254)。

**纯复制与身份。** defaultArtifact在模块加载时读取TF_E2E_ARTIFACT或WXT默认，显式空串拒绝。inventoryArtifact基于byteSummary排序列表，对每文件算sha256，再hash“path+NUL+sha256+LF”序列得treeSha256。assertIsolatedArtifactPaths复用assertDisjointPaths，可注入posix/win32 pathApi；copyProductionArtifact随后调用assertDisjointPathsOnDisk，要求临时目录副本且通过路径/目标树链接及Git工作区检查，canonical双端仍不相交。安全检查后才inventory/read Manifest并按generation检查mapping；pre-switch另核对两个冻结源文件SHA。仅允flatRuntime或src/assets/chunks/_locales顶层、拒TS/map/pem/crx/zip，确认MV3和所有runtime paths，再cp errorOnExist/force=false并复核树hash。

**可观察输出。** 返回源inventory、artifact/output、generation、runtimeMapping、sourceHead；current sourceHead来自环境且可null，不验证git或构建来源。旧sourceHead固定mapping.sourceCommit，只认证规定的旧映射输入，非全包签名。prepare在其上生成testCopy inventory及changes；原始hash与变更后hash用途不同，不能只打印来源标签声称“测试了此head”。

**词典与权限。** 复制后删副本assets/lexicon：release从repo生成目录copy，missing留缺，默认拷fixture Core并本地编译Technical；corrupt追加shard字节，incompatible改formatVersion=2。副本host permissions并入localhost/DeepSeek/raw GitHub，opt-in release host再加GitHub/release-assets。cached archive path开启特定Worker override，所生成worker校验固定ECDICT recipe后只访问mock endpoint并转发原worker-core，不在副本补完整Options源模块。

**探针/状态。** captureCommands不能与lifecycle/execution/startup观察同用；它包裹已编译background，捕获实际onCommand listener、send/query/injection并保留native调用。observeInstalled仅增加最多4个事件的观察listener，overflow明确记录，不写storage不改原listener。executionProof把原tree hash注入global；startupNetwork校验token/origins后执行3次native fetch并记录settlement。每个probe记录修改前后hash（Commands用changes/副本hash），不作为生产业务接口。

**终检/失败。** 重新inventory，changes只许manifest、lexical及明确允许的Worker/background路径；Manifest除host_permissions外deepEqual原文件。错误立刻reject，无builder fallback、下载、回滚或自动重试；外层fixture负责关闭/删临时资源。production-artifact及wxt-runtime-mapping/wxt-closed-network测试对拷贝/映射/对照失败提供负例。改环境选择、runtime mapping或probe须复核所有E2E消费者和报告；NOT_RUN。

<a id="file-extension-fixture"></a>
## e2e/support/extension-fixture.mjs：worker-scoped共享MV3测试夹具

blob `f62436b74f966277cb3fc8f7e26c28c998410ff5`；[完整源码 L1–L217](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/support/extension-fixture.mjs#L1-L217)。

**输入/生命周期。** Playwright base.extend提供worker scope选项：词典模式、Commands probe、ECDICT host/cache；harness先startMockServer和mkdtemp，再调用prepareExtensionTestCopy，不调用任何builder。日志E2E_PRODUCTION_ARTIFACT保留artifact、sourceHead、原tree/fileCount/大小、lexiconMode、testChanges/probe/override。Chromium仅加载临时extension，临时profile维持该worker的storage；等实际serviceworker，用其URL获得extensionId并打开Popup driver。

**调用接口。** reset先server.reset，经后台CACHE_CLEAR_ALL再clear local storage，写入mock Provider及默认站点/术语/外观；不全清Reading IDB/OPFS。open为每个page赋WeakMap token并写dataset；tabId按URL候选逐个executeScript比token，避免相同URL多tab混淆，无token才取首个。inject先ABT_STATUS ping，已有receiver成功则返回，否则insertCSS→有序Content；MAIN另用明确三文件和world MAIN注入。sendContent、captureSelectionContext、runtime、set/getStorage只是driver调用native API/现有app模块，不构造第二套后台业务。

**清理/局限。** await use前reset，harness由各spec选择是否beforeEach reset；finally嵌套关闭context/server/删除temp确保后续cleanup尝试。创建server/temp在try前，不能据此断言任意初始化失败也全部清理。此helper没有全局closed-network proxy，mock Provider配置不等于所有网络零外联。修改重置、tab选择、文件顺序影响全套共享spec；tests/production-artifact防止fixture错误被内部重建掩盖。NOT_RUN。

<a id="file-runtime-mapping"></a>
## e2e/support/runtime-mapping.mjs：按包代次选择运行时资源合同

blob `3ac011ef6bfe0a828e126d8ded9364d4c66b6c19`；[完整源码 L1–L22](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/support/runtime-mapping.mjs#L1-L22)。

currentRuntimeMapping由当前CONTENT_SCRIPT_FILES/STYLES、EXTENSION_PAGES/WORKER_PATHS/MAIN拷贝或引用组成；旧代导入冻结JSON。mappingForGeneration只接受current/pre-switch-19e，未知assert。assertRuntimeMapping要求Manifest/SW及全部指定资源路径在inventory Set，缺任一即失败，不负责文件内容校验、加载顺序执行或构建。

无持久/异步状态；旧代资源不能随当前新增功能被重写，否则旧包比较不再独立。冻结来源的两个file hash在copyProductionArtifact检查，JSON自身hash/48项顺序由wxt-runtime-mapping.test固定。修改现行资源集合联动builder/audit/injection，但不能以“新文件必需”要求历史旧包存在同文件。NOT_RUN。

<a id="file-frozen-mapping"></a>
## e2e/support/19e89b6-runtime-mapping.json：不可变旧代映射数据

blob `ecd5bcc6d17640093e3a7a0d2cc23c260889fa63`；[完整源码 L1–L85](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/support/19e89b6-runtime-mapping.json#L1-L85)。

数据固定sourceCommit=19e89b65fd3600073410407392da82ffa666ffc8，记录constants/runtime-assets两个Git blob及SHA-256；48个Content scripts按旧运行顺序并以content.js收尾，另列content.css、Popup/Options、六Worker、三MAIN。供旧产物闭包存在性/源输入hash与旧注入顺序使用，不执行代码、不表示当前main应该仍为48项。

wxt-runtime-mapping.test以完整JSON SHA-256 21eb874a9db5abf840537398dbf4fe9ed49b3338defed1b4e76ad1ed0dde1d35冻结bytes并测试未来资源不能追溯要求旧代。换基线是明确新代契约变更，须保留旧对照来源及所有消费者一致，而不是随手刷新JSON使测试通过。本轮只读，NOT_RUN。

<a id="file-closed-network"></a>
## e2e/support/closed-network.mjs：启动前精确mock-origin代理

blob `4960503300715ab2ab362e123080d6803e0dfc0d`；[完整源码 L1–L101](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/support/closed-network.mjs#L1-L101)。

startClosedNetwork仅接受显式端口的http://127.0.0.1 origin，拒路径/其他主机/protocol；先listen成功才交launchProxy，bypass <-loopback>移除隐式loopback直连。HTTP仅向该origin开上游连接，拒userinfo/相对URL/外部及替代loopback；转发移除proxy认证头，上游错误给502，abort/response close销毁上游。CONNECT一律403，upgrade销毁；sockets Set在close时逐个销毁并关闭server，listener冲突先reject。

attempts上限1024，仅kind/origin/blocked，无path/query/密码；超出置overflow。snapshot区分mockForwarded、attemptedOutsideMock和forwardedOutsideMock=0，并声明不是零尝试或OS隔离、普通来源不能归因给production/SW。startupNetworkControl生成唯一token的HTTP/HTTPS及替代loopback三origin；assertStartupNetworkControl需token、三调用三settlement、无overflow/外转发、对应HTTP或CONNECT拒绝记录，HTTP为FULFILLED403，HTTPS为REJECTED。

该proxy仅由migration消费者显式启动；不能推广为所有E2E的网络边界。wxt-closed-network测试用真实Node server/proxy及伪观察值负例检验转发、隐私、listen冲突与缺失对照；不替代实际Chromium启动probe。修改规则须重查升级启动时序和证据措辞。NOT_RUN。

<a id="file-upgrade-expectations"></a>
## e2e/support/upgrade-expectations.mjs：升级持久数据的窄例外比较器

blob `57a3ef94243b558e7894de7daa224f2bc0796637`；[完整源码 L1–L56](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/support/upgrade-expectations.mjs#L1-L56)。

assertUnchangedUpgradeSnapshot对整个对象deepEqual，同版本字节替换不允许隐式写locale。expectedStorageAfterInstalledUpdate必须收到reason=update及准确previousVersion；仅原storage没有自有uiLocale属性时返回加auto的新对象，有现值（含null/未知字符串）原样保留；不修改before。

expectedRegistrationsAfterInstalledUpdate同样要求准确native update，逐条确认before.js/css等于oldMapping，再返回仅js/css换为newMapping的新对象与数组；id/matches/persistAcrossSessions/runAt/world等其它字段保留。它不调用Chrome、不扩大权限、不要求旧包具备新reading-contract。替换未收到update时仍全快照不变，激活后才采用资源闭包窄例外。

assertRecoveredDatabases克隆每行、排序行和库，再deepEqual所有库名称/version/store/rows/fields。唯一例外是ai_bilingual_translator v2的translations/pages现有行lastAccessedAt：按cacheKey/pageKey找原行、双方safe integer、原值≤新值≤observedAt，比较内容时移除该字段。其他store同名字段没有例外，不许新增缓存row或丢数据。没有I/O或业务迁移；它生成/断言期望，真实snapshot由spec读取。

wxt-upgrade-expectations测试注册闭包替换、缺/错event/旧资源负例，并突变所有持久域、缺/错生命周期、locale不同现值和“仍有三行却内容损坏”的对照。修改容许差异需对应真实storage owner读写契约，不可为绿测放宽成计数。NOT_RUN。

<a id="file-commands"></a>
## e2e/commands.spec.mjs：实际Command listener的受限探针

blob `5684595926ebd520fde02e426133f6aeb5b061b8`；[完整源码 L1–L85](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/commands.spec.mjs#L1-L85)。

显式test.use commandCallbackProbe，beforeEach reset shared harness，afterEach关driver外所有page。routeCommand先把目标页面带到前台并poll native active tab URL，然后在SW调用实际生产bundle注册的唯一callback；读取probe.sends新增部分，poll已settle的ok回应并返回。第一用例翻译三段且一次Provider，再切两次显隐和Quick Control DOM；第二用例使扩展Popup成为受保护active page，调用callback并等待query，断言一listener、零send/注入/Provider。

这些断言比import原源码handler更接近实际安装bundle，但仍不是浏览器按键/原生shortcut事件或activeTab手势授权证明。探针包装native API并主动调用callback，需和无probe的native permission spec区分。callback/probe全局只在临时SW持有，最终随context清理；修改commands路由需联动startup、manifest command定义、adapter包装与此spec。NOT_RUN。

<a id="file-stardict-consumer"></a>
## e2e/stardict-import-worker.spec.mjs：实际Options的StarDict导入消费者

blob `bc2274b2ed1abb9324680d410f4b36ff70407d24`；[完整源码 L1–L84](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/stardict-import-worker.spec.mjs#L1-L84)。

使用shared harness，创建page后addInitScript只对extension协议包装NativeWorker子类及native sendMessage，保留实际执行并收集transfer/ready/commit/terminate；goto真实Options后MutationObserver记录data-phase。构造一词条.ifo/.idx/.dict合成输入，走文件选择、preflight显示、semantic确认、点击导入，等完成/busy=false/取消按钮隐藏，不往artifact补controller/source module。

结果要求唯一对应WORKER_PATHS的module Worker、terminated、transfer后3个ArrayBuffer长度0、packId/version/fingerprint格式、read→convert→三stage→commit→done及entries/index/manifest阶段路径。ready token与后台COMMIT一致，回包imported、quarantine token已消失，真实LEXICAL_LOOKUP找到本地译文且零Provider。page关闭释放观察器/探针；异常时由context fixture清理。

它覆盖合成成功链，不覆盖真实大型/压缩文件、取消/失败全集或所有外部格式。旧测试的源码import/fake权限路线已移除，现有controller Node测试另补phase/activeRequestId复位断言。修改消息、阶段、Worker transfer或token清理需联动controller/worker/background和此断言；NOT_RUN。

本章 Actions 与构建/测试均按上述 main 基线复核；命令仍由当前 package/build 脚本决定。新的 local-task 包指纹与 E2E treeSha256 串行化不同，不能互换，见[指纹边界](local-task-acceptance.md#fingerprint-boundary)。

<a id="file-quality-workflow"></a>
## .github/workflows/quality.yml：基础校验CI编排

blob `613171104d9b1e73336d691570854617dd918c7d`；[完整源码 L1–L18](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/.github/workflows/quality.yml#L1-L18)。

只有 workflow_dispatch 手动入口，不再由 PR/main push 触发；只读contents权限，Ubuntu checkout@v4、setup-node@v4固定24.21.0，npm ci --no-audit --no-fund后npm run validate。validate按package当前串行链终止于默认 WXT build，输出 dist/extension；此workflow不安装Playwright Chromium、不启动E2E、不宣称发布认证。安装/命令失败使job失败，无恢复/发布动作或报告上传步骤。改package validate会隐式改变本job覆盖；精确 head 的手动 run 必须另有实际证据；日常按[本地任务流程](local-task-acceptance.md)验收，不恢复例行 CI 查询，本轮 NOT_RUN。

<a id="file-e2e-workflow"></a>
## .github/workflows/e2e.yml：同一 WXT 引擎双路径及固定旧代对照

blob `ffc5326b2efbc38f0b4bc9ba45b7e886b9bc04f8`；[完整源码 L1–L53](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/.github/workflows/e2e.yml#L1-L53)。

仅 workflow_dispatch 手动入口，不监听 push/pull_request、没有 PR paths 过滤；contents read，Ubuntu12分钟 job，matrix stable-wxt=dist/extension 与 wxt=.output/chrome-mv3，fail-fast=false。env 明确 TF_E2E_ARTIFACT/TF_I18N_ARTIFACT 与矩阵对应，SOURCE_HEAD=github.sha 只是标签。两行均 npm ci、安装 Chromium、build:extension:wxt、smoke、build:extension；两个当前包都由同一 WXT 引擎编译/审计。

固定旧代步骤已无 matrix 条件，两行均 fetch 19e89b65fd3600073410407392da82ffa666ffc8、detached worktree、运行该提交自己的旧 builder。GITHUB_ENV 写旧包绝对路径，TF_UPGRADE_NEW_ARTIFACT 都固定 .output/chrome-mv3；最终 test:e2e 的一般 shared fixture 消费矩阵包，升级/采样用双升级变量。因此 stable-wxt 行不代表同 ID 升级验收了 dist，也不是两种当前构建引擎的矩阵。

失败上传 playwright-report 与 test-results，名字含 matrix.name，缺文件 ignore、保留7天；成功无 always 上传。无商店发布步骤，定义不是本轮运行记录。改默认目录、locale/升级变量或固定旧代须联动 wrapper、mapping/hash 和消费者，避免构建一种却读另一包。NOT_RUN。

<a id="test-artifact"></a>
## tests/production-artifact.test.mjs：产物隔离、无fallback与hash回归

blob `3963f009e469a5b8a23a0f05b52c17c77c8d2620`；[完整源码 L1–L66](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/production-artifact.test.mjs#L1-L66)。

三个Node测试分别用posix/win32/UNC/跨盘/大小写路径验证同或嵌套路径拒绝；造仅有manifest的临时包要求缺background映射失败、缺目录ENOENT并源码断言不存在builder；造所有runtime路径的synthetic bytes，检查copy tree/files/bytes完全一致、同/子/已有目标失败、加入tests目录拒绝。新增foreign .git及其symlink alias的副本路径，prepareExtensionTestCopy须在词典删除/适配前拒绝，检查foreign lexicon sentinel保留。所有临时目录finally rm。该测试验证adapter合同，不代表合成JS能执行或sourceHead可信；修改复制/路径/hash逻辑优先运行它并补真实artifact E2E，NOT_RUN。

<a id="test-entry"></a>
## tests/wxt-e2e-entry.test.mjs：E2E默认值与缺包早失败

blob `e87a514e7f5109bcd810be4b44283e6c1ce6c6b8`；[完整源码 L1–L29](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/wxt-e2e-entry.test.mjs#L1-L29)。

第一例断言空env默认WXT且locale跟随、显式dist同步locale、自定义locale保留、空artifact throw。第二例临时造残留dist manifest，默认WXT仍ENOENT；显式dist返回路径；spawn当前Node运行真实wrapper配missing路径，要求status1、无spawn error、stderr ENOENT且未Running，finally删除目录。它不运行成功Playwright suite，不能当WXT浏览器验收；修改命令入口和CI env选择应保持此失败路径。NOT_RUN。

<a id="test-mapping"></a>
## tests/wxt-runtime-mapping.test.mjs：旧代合同固定与未来闭包隔离

blob `9b49ab80d16929e82eda16848365b431f15e92f8`；[完整源码 L1–L34](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/wxt-runtime-mapping.test.mjs#L1-L34)。

读取冻结JSON，断言精确sourceCommit、两Git blobs、48Content最后content.js及完整文件SHA，mappingForGeneration必须返回相同内容，未知代次失败。另用Set构造旧映射路径，current新增reading-contract在旧闭包中缺失应失败；补入当前Content集合后，缺未来资源仍失败，补入才成功，删旧MDD worker旧代仍失败。纯内存/读文件，无Chromium/安装；守住“当前资源不能反向污染旧对照”，修改mapping需保留此独立性，NOT_RUN。

<a id="test-network"></a>
## tests/wxt-closed-network.test.mjs：代理真实socket与启动对照负例

blob `bcbdc3359ef41d993279d59fc7c6f3f092079822`；[完整源码 L1–L64](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/wxt-closed-network.test.mjs#L1-L64)。

throughProxy用Node http.request直接走launchProxy，2秒超时，CONNECT socket销毁。第一例真实mock/proxy只转发精确origin一次，外部、localhost、https、userinfo、相对路径、CONNECT均拒绝，报告不得含path或password且只保留三字段；finally关闭两server。第二例拒非法allowed origin及占用同端口，保证浏览器launch前失败。第三例合成三settlement及proxy记录，删观察、calls置零、漏attempt/result、overflow或forwardedOutsideMock>0全部拒绝。

它证明Node代理行为与checker不能接受缺证据，不自行创建MV3 worker；实际启动链另由升级spec证明。修改代理协议、报告预算或probe origins需对应两类测试，不可用fake result替代native fetch。NOT_RUN。

<a id="test-upgrade"></a>
## tests/wxt-upgrade-expectations.test.mjs：全量持久快照的对抗回归

blob `ee73bcc7f05aac74e28351ba31e35fdfc7923f04`；[完整源码 L1–L106](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/wxt-upgrade-expectations.test.mjs#L1-L106)。

五组Node用例：首先native update后仅JS/CSS闭包更新、其它注册策略/原数组保留，缺/错event及不精确旧闭包失败；同版本保持完整snapshot，逐项突变storage/DB/OPFS/registration必须失败；native update必须有准确旧version且只补缺locale；既有auto/en/zh_CN/unknown/null不能被删/替换；缓存恢复排序可变、translations/pages lastAccessedAt可在界内前进，其余内容/identity/大小/创建时间/store/库名版本/额外库任何差异拒绝。对抗case刻意保留三条translations，展示旧计数guard不充分；也确认before不被helper修改。

没有数据库操作或升级安装，只检验期望比较器。改例外字段/版本必须连同cache owner语义和真实snapshot消费者复核；运行NOT_RUN。

<a id="test-wxt-assets"></a>
## tests/wxt-assets.test.mjs：raw桥、词典及Manifest负例

blob `605b3ac67f1799df573a0882e4cb4ff723bfa7f5`；[完整源码 L1–L101](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/wxt-assets.test.mjs#L1-L101)。

七组Node测试检查roots开头遵循Content/Style顺序、MAIN同一引用、页面路径、闭包含worker/importer且不包含编译页面/后台；拒traversal/绝对/远端/空段；分别用win32/posix验证跨盘UNC/父目录；临时relative import可闭包且symlink escape失败；missing词典开发显式报告、release拒绝；已认证fixture只四文件、忽略stray source-lock、symlink及corrupt shard拒绝；productionManifest deepEqual拒加权限/static scripts/WAR/升最低Chrome/options_ui/改变背景语义。

依赖真实源码常量、临时fs和fixture；finally删除所有temp目录。不会调用完整WXT构建hook/启动浏览器，故需要build audit/smoke独立证据；变更asset安全边界须保留负例而非只更新成功快照。NOT_RUN。

<a id="test-presentation"></a>
## tests/curated-install-artifact-presentation.test.mjs：从浏览器源码import移出的纯展示合同

blob `1f59eff1326755dc7b37f2dfc332c5e2100dd792`；[完整源码 L1–L15](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/curated-install-artifact-presentation.test.mjs#L1-L15)。

以CURATED_DICTIONARIES首来源和healthy旧packVersion调用真实纯getCuratedInstallPresentation，断言update-available、已审核更新badge及更新按钮文案。无DOM/浏览器、下载/安装/storage；这个synthetic旧版本展示不能冒充实际artifact安装升级。它承接curated-ecdict-product移出的browser-side source-module import检查，生产安装/display仍由native E2E负责。修改presentation规则、catalog首项或locale文案要重查此例与真实产品用例，NOT_RUN。

<a id="package-routing"></a>
## package.json：命令总路由（局部）

[package.json L1–L73](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/package.json#L1-L73)；blob `9e350ac3486e526f6588a71c899d5d844d6ba7a7`。private ESM package版本0.8.0，Node>=24.21.0<25、npm>=11.19.0<12、packageManager npm@11.19.0；依赖全部列devDependencies，固定WXT/Vite/React/TypeScript/Vitest/Playwright及test工具版本。依赖存在不证明React已进入产品页面。npm prepare执行wxt prepare；typecheck/test:unit也先prepare，dev是WXT Chrome MV3，build默认WXT到dist/extension；build:extension:wxt调用同一builder，只以--out换到.output/chrome-mv3。validate不更新另一个输出；E2E默认仍选.output，测试dist须显式TF_E2E_ARTIFACT=dist/extension，未另设时locale跟随。

本切片已完整解释check/check:i18n/test/validate/test:e2e、同引擎两个输出、smoke和test分域的路由。其他scripts分为词典setup/build/project/ingest、source audit、quality benchmark/evaluate、发布/产品certify、成本measure和富词典安全/取消focused tests；这些调用各自脚本，不等于validate自动包含它们。各来源下载、认证算法及锁文件解析尚未逐一讲解，因此package保留局部，不能以列出脚本名计全覆盖。更改任何script会影响对应CI，需查实际消费者。

<a id="upgrade-consumers"></a>
## 升级与native平台专项消费者（局部）

- [e2e/wxt-upgrade.spec.mjs L1–L307](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/wxt-upgrade.spec.mjs#L1-L307)：两情景为缺失uiLocale/已有zh_CN；旧新artifact双环境缺任一skip。旧/新同version、同路径/profile/ID，旧package两mapping输入hash验证；真实Settings导入两个synthetic MDX/MDD、首选/启停、三翻译cache、站点注册并集后读取全部storage/DB/OPFS/registrations。替换后识别cached-old runtime并保持完整快照；管理reload才以native lifecycle和Reading v2 NOT_READY证明新runtime激活，允许仅缺locale默认写，以及动态注册只把js/css从精确oldMapping换为currentMapping，ID/matches/其它策略保留。旧world通过原消息channel失败证明失效，刷新后cache恢复Provider仍1次，DB只容许窄lastAccessedAt变化，注册采用newMapping期望，重启与恢复后全快照继续相等。报告含phase/原树hash/testChanges/probe/network/ID/浏览器、失败保存partial completeAcceptance=false；嵌套finally释放context/proxy/server/temp，setImmediate后比较真实TCP listener数量。这里解释证据链，未逐一展开dictionary/snapshot/stable/summary及所有UI断言，保持局部。
- [e2e/wxt-injection-samples.spec.mjs L1–L90](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/wxt-injection-samples.spec.mjs#L1-L90)：旧/新明确输入，每代使用自身runtimeMapping，复用profile/path/ID；WXT强制管理reload、要求新worker和executionProof=原tree hash，再用native Reading响应区别旧runtime。各十次新article测cold insertCSS→scripts→status，原document再注入测warm；sameApp、loaded/module count不变，无译文/Provider，每次关page并核对pages数。报告原样本与median/min/max，没有性能阈值；不是单纯对source文本计时。未完整解释全部report字段/浏览器创建过程，局部、NOT_RUN。
- [e2e/wxt-platform-permissions.spec.mjs L1–L165](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/wxt-platform-permissions.spec.mjs#L1-L165)：真实临时Chrome management API控制权限，无fake permissions.contains/executeScript。先取可访问页面native稳定tabId；未申请localhost作为hard-denied严格REJECTED对照；required-but-withheld及revoked在1000ms窗口逐样本观察真实promise只可PENDING/REJECTED、marker=0且native receiver不存在。fresh document上的grant必须FULFILLED且frame0 marker可见，三站点模式并集只一条native注册；撤权/重启要求权限false、注册与站点设置被剪除、Provider0。报告明确pendingConsentCompletion和browserPermissionPrompt NOT RUN，不能说权限弹窗已被点击或待定最终被拒绝。仍保留局部，未把全部probe状态/测试平台特有API视为生产架构。

<a id="consumer-deltas"></a>
## 其余消费者增量与测试边界（局部）

[e2e/curated-ecdict-product.spec.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/curated-ecdict-product.spec.mjs)仍走真实Settings安装/状态/Selection与本地查询，移出的旧版本presentation源码import现由上文15行Node合同承接；没有因此证明整套真实上游兼容。本文件约250行产品检查本章未全量解释。

[e2e/design-freeze-poc.spec.mjs L1–L60](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/design-freeze-poc.spec.mjs#L1-L60)的prepareExtension改为copyProductionArtifact(defaultArtifact,extensionDir)，缺资源不会调用旧builder。仍是POC：[e2e/design-freeze-poc.spec.mjs L268–L331](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/design-freeze-poc.spec.mjs#L268-L331)的文本extract是page.evaluate内自建算法，不能当生产selection source；末尾权限用例通过测试按钮发native request，等待500ms后接受result=null，最多证明观察窗口内仍pending，不能由此断言用户已授权或权限弹窗实际完成。OPFS/签名/恢复POC全流程尚未逐一解释，局部。

[tests/ecdict-mdx-package-boundary.test.mjs L14–L49](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/ecdict-mdx-package-boundary.test.mjs#L14-L49)确实直接调用当前WXT builder在temp输出，检查无MDX/MDD/ZIP、包小于corpus、生产host不宽、worker无cache bridge；读取缓存override的源码路径移到production-artifact。它是明确的builder单测，与shared E2E“不内部build”不冲突。本章不展开corpus lock与发布准入合同，局部。

[tests/selection-release-certification.test.mjs L10–L64](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/selection-release-certification.test.mjs#L10-L64)检查shared fixture出现prepareExtensionTestCopy且无buildExtension，corrupt/incompatible改查adapter；其余是源码marker/regex保护required fixture家族、Provider0/交互/隐私断言。静态包含标记不是浏览器执行；完整Selection认证另读该suite，局部。

[tests/stardict-import-controller.test.mjs L60–L100](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/tests/stardict-import-controller.test.mjs#L60-L100)成功commit新增controller.phase==空、activeRequestId==空，结合worker terminated；这没有改变生产controller代码。大型suite的fake worker/取消/错误分支仍未逐文件完整说明，不将两个新增assert算全覆盖。

<a id="partial-ci"></a>
## 专项CI如何选择产物（局部）

以下 workflow 的入口/产物/证据已按上述 main 基线复核；均只有 workflow_dispatch、contents:read，不再自动响应 PR/push。这里只解释本链相关部分，不把庞大认证算法算完整解释。vNext 保留必填 base_sha；job 内遗留 event-base 表达式不代表仍订阅 PR/push。定义不是运行结果，全为 NOT_RUN。

- [.github/workflows/lexicon-release.yml L1–L151](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/.github/workflows/lexicon-release.yml#L1-L151)：锁定OMW/WordNet checkout→setup:lexicon、benchmark/bootstrap/footprint/StarDict cost→Selection+pack certify→validate构建默认WXT到dist→Chromium E2E。环境显式TF_E2E_ARTIFACT及TF_I18N_ARTIFACT=dist/extension、SOURCE_HEAD=github.sha、REQUIRE_RELEASE_LEXICON_PACKS=1、JSON报告；再Offline Beta certify。上传质量/发布词典/认证报告各自保留期，不是商店发布。
- [.github/workflows/dictionary-library-vnext-certification.yml L1–L191](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/.github/workflows/dictionary-library-vnext-certification.yml#L1-L191)：独立临时cache/evidence-private/evidence-published及run marker；setup词典/validate提供默认WXT到dist，锁定writer/真实MDX及100MiB MDD证据、focused E2E显式dist。vNext汇总后检查冻结scope必要slice状态，ready才resolve可信base并跑ecosystem certify，否则打印pending，仅上传脱敏published summaries。一个vNext子认证成功不能推导最终生态gate完成。
- [.github/workflows/mdd-resources.yml L1–L63](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/.github/workflows/mdd-resources.yml#L1-L63)：锁定独立writer→regenerate/checksum/large-range evidence→parser/security测试→Chromium→明确build:extension→直接npx playwright MDD spec并选dist/SOURCE_HEAD；always上传有限evidence，非corpus。
- [.github/workflows/rich-lookup-cancellation.yml L1–L51](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/.github/workflows/rich-lookup-cancellation.yml#L1-L51)：full checkout、锁定基线测量→明确默认WXT build→取消spec（CI true、dist/SOURCE_HEAD和证据目录）→always保留两个脱敏baseline/report。源码存在这个基线流程不表示本轮跑过。
- [.github/workflows/rich-mdict-compatibility.yml L1–L45](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/.github/workflows/rich-mdict-compatibility.yml#L1-L45)：先验证固定upstream MDX、parser/sanitizer，再默认WXT build；五个真实/本地preflight/one-click/hostile viewer specs显式dist/SOURCE_HEAD，ECDICT gate=1；always只上传证据目录，never corpus。它消费默认WXT的dist目录；wrapper默认.output的路径选择不影响显式dist。

<a id="partial-adjacent"></a>
## 相邻完整说明与仍待解释的依赖

[wxt.config.mjs](#file-wxt-config)当前 staging、hooks 与编译/资产报告在本章完整说明；[entrypoints/background.ts](startup.md#file-wxt-background-entry)仍由启动章解释 initializeBackground 薄入口，不重复计数。

下列只到调用边界，保留局部：[scripts/source-boundaries.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/source-boundaries.mjs)负责 inspectSources/SOURCE_EXTENSION，[scripts/source-api-boundaries.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/source-api-boundaries.mjs)承接 API 所有权分析；未逐一说明 AST、alias 全部规则。[e2e/support/mock-server.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/support/mock-server.mjs)给 baseUrl/calls/reset、fixture/cached archive 路由；[scripts/build-tflex-technical.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/build-tflex-technical.mjs)编译测试 Technical。调用点不是大文件全覆盖，也不表示执行过。

[README.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/README.md#L149-L206)安装dist现为默认WXT；[CONTRIBUTING.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/CONTRIBUTING.md#L1-L47)说明validation分域、同引擎双目录与本地验收；[docs/ARCHITECTURE.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/docs/ARCHITECTURE.md)作为运行时归属/包边界背景。这些长文档不计本章逐文件完成。旧平台/兼容文档及归档JSON的历史PASS仍绑定原tested head，未继承本轮。依赖锁、词典来源认证链、其它CI和完整产品spec仍待后续；realOxford本轮未验证。

<a id="output-safety-followup"></a>
## #278 输出安全实现现状与剩余边界

原文“未合入”只描述2026-10-03 08:29 UTC历史观察，不能继续用作当前状态。固定main的[path-boundaries](#file-path-boundaries)、[builder](#file-build-extension)和[production-artifact](#file-production-artifact)已实现ROOT规范化、四种路径关系、真实路径/链接/临时目录限制、目标内部嵌套Git与链接保全，builder删除前再检查一次。此为源码事实，不借旧PR/review报告推导任何新运行PASS。

build/audit先在独立staging完成，使两阶段失败不删除最终包；发布仍是rm→mkdir→cp，非原子/回滚事务，也无同目标互斥锁。检查不是竞态下的持锁原子边界。不要给allowExternalOutput任意外部删除含义，不要用真实源码/worktree根重现破坏性负例。本轮build/delete/安全回归全部NOT_RUN。
