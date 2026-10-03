# MDX/MDD 导入与受控渲染：逐文件说明

导航：[阅读入口](../README.md) · [架构总览](../architecture.md) · [仓库地图](../repository-map.md) · [功能调用链](../features/local-dictionary-import.md) · [前篇：划词模块](selection.md)

> 源码身份：main `d5e308a709c008acf6b277d466d020f13025bdca`；复核日期 2026-10-02。本章完整解释 15 个文件，其余明确标为局部边界。源码、函数和测试断言为静态阅读证据；所有运行验证均 **NOT_RUN**。不包含 Oxford10 后续方案的未合入能力，不使用私有词典正文作为例子。

## 阅读方式与共同契约

先读 Options 入口与 preflight，再读 MDX/MDD controller → worker → 后台提交，最后接上前篇已经解释的 rich-details/lookup controller，阅读 sanitizer → viewer → resource resolver。下文“测试”指现有断言覆盖方向，均未运行；测试本身只登记局部阅读，不能算完整文件解释。

本地文件保留在浏览器上下文内：File 发给模块 Worker；后台消息传身份、大小、摘要和提交元数据，不把整个文件转成 runtime message。后台从 OPFS 再读取核验；Content 收到的是有界词条或单个资源。UI 的兼容性检查、Worker 的 READY 和后台 active 指针写入是三个不同的完成点。

<a id="file-local-ui"></a>
## 1. src/options/local-dictionary-import-ui.js

源码：[src/options/local-dictionary-import-ui.js L1–419](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/local-dictionary-import-ui.js#L1-L419)；重点 [src/options/local-dictionary-import-ui.js L142–374](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/local-dictionary-import-ui.js#L142-L374)。

- **职责/调用方**：Options HTML 直接加载的统一多文件入口。initializeLocalDictionaryImportUi 找齐 DOM 才初始化，创建富文本 MDX、结构化 MDX、StarDict、MDD、TFLex 控制器。选择、拖放、键盘选择和移除最终进入 replaceSelection；此处只协调，不实现压缩格式或后台激活。
- **数据流**：runPreflight 直接在 Options 上下文调用 preflightLocalDictionaryFiles，并非将 preflight 全部交给 Worker。输入 selectedFiles/AbortSignal/用户语义确认；输出 report 决定 importer。renderPreflight 委托 presentation，refreshInstalledCandidates 委托 installed-state；两套 sequence 分别防止旧检查、旧安装状态覆盖新选择。
- **安装门槛**：updateImportEnabled 只接受 supported/已确认限制的 partial；还检查 importer、缺失/无关联文件、MDD 检查数量、语义确认、重复确认、TFLex 安装大小及该 family 的已安装状态已知。partial 不等于自动可安装。同名 MDX 的重复确认是“另存一份”，不是覆盖授权。
- **关键流程**：importSelected 固定本次文件与报告。rich 分支先完成 MDX，再以返回的 dictionaryId 附加已安全匹配的 MDD；MDD 失败或取消设置 retryAttachment，显示“MDX 已安装，附件未更改”，触发状态刷新并保留重试按钮。retryMddAttachment 只重试附件，不重新导入 MDX。其他 importer 委托原控制器，不能据此算它们算法已解释。
- **状态/错误/释放**：busy 阻止换文件；activeImport 指向当前 controller 的 cancel/dispose。cancelActive 根据 cancelled/commitpoint 显示正在清理、不可取消或已结束；发送取消请求不直接等于安装已取消。异常通过 userMessage 呈现，finally 恢复控件。pagehide → dispose 中止 preflight、使已安装刷新过期并释放各控制器；文件与重试对象只在页面内存，刷新页面不会续跑未完安装。
- **安全/修改影响**：展示通过 DOM/textContent 与 presentation，不执行文件内容，不自动调用 Provider。修改此文件首先验证不明安装状态阻断、旧响应隔离、MDX/MDD 两阶段语义，不能将附件失败写成整组回滚。测试：local-dictionary-preflight、local-dictionary-import-presentation，E2E local-dictionary-import-v2-product（见[测试边界](#test-boundaries)）。

<a id="file-preflight"></a>
## 2. src/background/packs/local-dictionary-preflight.js

源码：[src/background/packs/local-dictionary-preflight.js L1–50](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight.js#L1-L50)。

- **职责**：preflightLocalDictionaryFiles 是纯本地文件组路由入口；虽位于 background 目录，实际也被 Options 直接 import。依赖三个 family 实现和 contract，没有 chrome 存储、网络或 Provider 副作用。
- **输入/输出与算法**：先检查 signal、规范化 1–32 个 File/Blob、累计总大小与重复名；超过 640 MiB 返回 unsupported，重名返回 invalid。存在 MDX 时必须恰好一本，交 MDX 分支；单独 MDD 返回 unsupported/mdd.mdx_required。其后才依次尝试 StarDict、TFLex，均不认则 unknown/unsupported。
- **状态/错误**：无持久状态；AbortError 向上抛，非法输入形状可抛 TypeError，格式识别结果由 schemaVersion=1 报告表达。这里不安装、不凭扩展名声明 verified。
- **改动/测试**：路由顺序影响混合文件组归属和 UI 提示；增加 family 要同步 contract 的 importer/schema、UI 控制器和测试。local-dictionary-preflight.test.mjs 检查 MDD 关联、格式分流、取消与无网络调用，运行 NOT_RUN。

<a id="file-preflight-contract"></a>
## 3. src/background/packs/local-dictionary-preflight-contract.js

源码：[src/background/packs/local-dictionary-preflight-contract.js L1–199](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight-contract.js#L1-L199)。

- **职责/输出**：basePreflightResult 统一 identity、compatibility、route、resources、estimates。status 限 supported/partial/unsupported/invalid；importer 也为有限集合；capability 经共享 catalog schema 过滤和去重，未知值不冒充已交付能力。expectedLocalBytes 当前为 null，源大小不等于可靠安装占用估计。
- **输入工具**：normalizePreflightFiles 只接受数组及具 name/非负安全整数 size/slice 的对象；hasDuplicateFileNames 用 NFKC 和 en-US 小写比较。preflightExtension 特别识别 .dict.dz；语言规范化、正则转义供 family 层复用。
- **读取与预算**：blobRangeSource 包装 slice 并在 await 两边查取消，具体越界由其调用的 parser 控制；readPreflightRange 自己检查 offset/length/文件边界及短读；readPreflightBytes 先限定整文件大小再读，readPreflightUtf8 使用 fatal UTF-8。不可把这两种 reader 说成具有完全相同的校验。
- **错误与安全**：assertPreflightFileLimit 附 preflightReason，assertPreflightActive/isPreflightAbort 统一取消。cleanDisplayText/safeFileLabel 去控制、双向控制和标签字符；后者还替换路径分隔符。这只是显示标签，不授予任意 OPFS 路径。reason 只保留已知 capability。无持久状态或资源句柄。
- **改动/测试**：schema/限制修改会影响所有导入 family 与 Options 提示；扩容必须连同解压、索引和存储预算验证。preflight 测试覆盖重复、无效组与取消，NOT_RUN。

<a id="file-preflight-mdx"></a>
## 4. src/background/packs/local-dictionary-preflight-mdx.js

源码：[src/background/packs/local-dictionary-preflight-mdx.js L1–315](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight-mdx.js#L1-L315)。

- **调用/职责**：由 preflight dispatcher 在已确认只有一本 MDX 后调用。preflightMdxFiles 将同 basename 的 base/连续编号 MDD 与无关文件分离，validateMddCompanions 负责顺序、数量和歧义拒绝。
- **真实检查深度**：先以有界 source 调 buildRichMdictIndex，随后对每个已关联 MDD 调 buildMddIndex；这里会读取/解压 key blocks 并建立紧凑描述符，不只是“读取文件头”，但不等于逐条正文或所有媒体 payload 验证。MDX/MDD 单文件上限均 128 MiB。
- **输出与分流**：mdxCapabilities/mddCapabilities 从已解析 header/索引提取当前能力标记，与 SHIPPED_CAPABILITIES 比较。默认 rich；只有 semanticConfirmation=true、en→zh-cn、Format=Text、未加密、无 StyleSheet/Compact/Compat 且没有已关联 MDD 才 structuredReady。用户仅勾选不能越过这些格式条件；Text 未确认保留 rich 并给语义警告。
- **失败区分**：MDX unsupported/limit → unsupported，损坏等 → invalid，不能路由导入。MDD 不支持或超限可能返回 partial/rich route，损坏返回 invalid/none；UI 仍会因未读完 MDD 数量等阻断。无关文件使报告 partial，但 UI 也阻止静默忽略。mapMdxError/mapMddError/infer* 将错误类型与部分详情映射为有限原因、编码/压缩能力，取消永远重新抛 AbortError。
- **身份/状态**：成功后只取 recordBlocksOffset 之前的有界抽样 hint，不散发正文；局部数组和索引随本次调用结束，没有写入存储。mdxUnsupportedCapability 是当前文件内未被主路径调用的辅助函数，不应描述成额外验证步骤。
- **改动/测试**：兼容提示不等于完整兼容认证；新格式支持必须同时进入 parser、schema、worker/commit 和 renderer。preflight 测试覆盖未确认纯文本、LZO 与损坏区别、MDD 编号与取消；真实词典测试未运行。

<a id="file-preflight-identity"></a>
## 5. src/background/packs/local-dictionary-preflight-identity.js

源码：[src/background/packs/local-dictionary-preflight-identity.js L1–56](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight-identity.js#L1-L56)。

- **用途/调用**：MDX preflight 用 makeBoundedFileIdentityHint 提供本地候选身份线索；makeBoundedBytesIdentityHint 也可接受调用者提供的 ranges。不是信任证明、全文哈希或许可证认证。
- **算法/IO**：验证 readableEnd，读前 16 KiB 及 readableEnd 前最多 16 KiB，避免重叠；将版本化前缀、文件大小、readableEnd、offset+length 描述与样本字节连接后 SHA-256。返回 kind、脱敏显示文件名、范围/大小、摘要及明确 verified=false / verification=unverified。
- **状态/错误/取消**：无存储副作用。readableEnd 无效或 WebCrypto 不可用返回 null；读取失败可抛出，读前和 digest 后检查取消，防止旧摘要进入新报告。算法只指纹采样区域，正文不同仍可能得到相同 hint。
- **修改/测试**：改变采样协议影响未来身份比较兼容，不应把“同 title/同 hint”升级为可自动覆盖。相关 preflight/重复提示测试方向见测试边界；NOT_RUN。

<a id="file-mdx-controller"></a>
## 6. src/options/rich-mdict-import-controller.js

源码：[src/options/rich-mdict-import-controller.js L1–294](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/rich-mdict-import-controller.js#L1-L294)；取消 [src/options/rich-mdict-import-controller.js L139–200](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/rich-mdict-import-controller.js#L139-L200)。

- **职责/依赖**：createRichMdictImportController 为统一入口、旧 rich UI 和精选导入复用；要求 runtime.sendMessage/getURL、Worker 和静态 WORKER_PATHS。一个实例只允许一个 active，入口 importDictionary 验证 .mdx、正大小及 128 MiB 上限。
- **身份/流程**：createIdentity 要有效 UUID 与正时间，普通本地每次产生新 packId/import-version；声明的 curated recipe 可用固定 packId，并携带 recipeId/expectedActiveVersion 做受限替换。发送 RICH_MDICT_IMPORT_PREFLIGHT 预留 → 创建 module Worker → START 携 File/身份/显示元数据 → 等 READY → terminate → RICH_MDICT_IMPORT_COMMIT → 返回 {requestId,ready,commit}。
- **协议与错误**：waitForReady 仅处理本 requestId；PROGRESS 转 onProgress，READY resolve，ERROR 保留 errorName/code reject；原生 worker error 同样 reject。监听器在完成时移除。UI progress 回调异常被吞掉，不改变存储事务。READY 只是暂存结束，不是安装成功。
- **取消/状态**：worker 阶段发 CANCEL 并设 cancelRequested，等待 Worker 报取消/清理；preflight 阶段设标记，由 assertCurrent 拒绝继续。commit 阶段问后台，只有 response.cancelled=true 才记取消；commitpoint 的 false 不能包装成 AbortError。dispose 在 worker 阶段同时拒绝等待，在 commit 阶段请求取消。未 committed 的 catch 尽力 abort staged，finally terminate 并清 active。
- **精确边界**：代码保留“commit 成功但 cancelRequested 已被接受”的防御分支，会请求卸载再抛 AbortError；正常不可逆 commitpoint 后的取消不会设置该标记。清理 sendMessage 的拒绝/失败并非都能在 UI 证明已清干净，不能保证浏览器崩溃等价于完整回滚。
- **修改/测试**：变更协议或身份影响 Worker、router、预留/commit 和精选 replacement；优先读 rich-mdict-product 测试中的 too-late cancel 与 accepted cancellation。NOT_RUN。

<a id="file-install-preflight"></a>
## 7. src/background/packs/rich-mdict-install-preflight.js

源码：[src/background/packs/rich-mdict-install-preflight.js L1–74](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-install-preflight.js#L1-L74)。

- **职责**：createRichMdictInstallPreflight 由 manager 注入 store/stateStore/storageManager/serialize，返回 preflightQuota；与文件兼容性 preflight 不同，这是后台配额和身份预留。
- **算法/输入输出**：sourceBytes 须 1–128 MiB；可用 estimate 时要求剩余空间至少 sourceBytes+32 MiB，无 estimate 不伪造容量保证。identity 缺省只检查大小/配额；有 identity 时规范化 request/pack/version、验证 curated replacement。
- **状态**：按 pack 串行，读取已存在版本，再在 stateStore.update 中复核安装目标、同包预留、版本冲突。成功写 reservations[requestId]={packId,packVersion,catalogReplacement?,createdAt}，不写 active；返回无业务结果，由 router 包 ready。
- **错误/恢复**：LIMIT/QUOTA/EXISTS/REPLACEMENT_CONFLICT 等向上抛；函数本身无 AbortSignal，controller 取消后通过 abortImport 释放相应暂存与预留。createdAt 是记录时间，不能据此宣称有 TTL 自动清理。
- **修改/测试**：预留是后台 commit 的必要条件，不能为方便去除；和 rich-mdict-storage 的重复身份、取消、精选替换断言一同复核，NOT_RUN。

<a id="file-mdx-worker"></a>
## 8. src/options/workers/rich-mdict-import-worker-core.js

源码：[src/options/workers/rich-mdict-import-worker-core.js L1–253](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/rich-mdict-import-worker-core.js#L1-L253)。

- **职责/调用**：Worker 壳传入 postMessage，由 createRichMdictImportWorkerHandler 提供 handleMessage/cancel/activeRequestId。依赖 OPFS store、buildRichMdictIndex、curated provenance contract；不直接激活词典。
- **输入验证**：START 先校验 request、File/尺寸、packId/version、curated recipe 与 packId 对应，再声明 active AbortController。CANCEL 只能中止同 request；未知消息/busy/无效 input 在 try 外抛，由 Worker 壳统一回 ERROR。
- **索引/写入**：File range source 检查整数边界和短读，在 await 两边查 signal；buildIndex 建紧凑索引，JSON 编码须 ≤8 MiB，WebCrypto SHA-256 保护索引。普通本地拒绝该 packId 的任意已有版本；curated 允许已声明流程。先保存原 MDX File，再写 index，重读两者大小；READY 返回身份、source/index 大小、indexSha256、entryCount/header/title/format/encoding 等元数据。
- **状态/取消/错误**：active 仅内存；每次索引/存储阶段报告进度。异常尽力 removeVersion 后 post ERROR；finally 清 active。原文件作为 Blob 写入，不能说整文件从未被浏览器持有；实现避免的是把全词典展开成正文数组再转发。同步解码期间取消仍依赖内部可让出的检查点，不是任意指令级抢占。
- **修改/测试**：index 字节内容必须与后台重新构造完全一致，任意 schema 或排序变化都会影响 commit。rich-mdict-product 检查预验证、标题优先级与协议，rich-mdict-storage 检查重新构造；NOT_RUN。

<a id="file-mdd-controller"></a>
## 9. src/options/mdd-resource-import-controller.js

源码：[src/options/mdd-resource-import-controller.js L1–227](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/mdd-resource-import-controller.js#L1-L227)。

- **职责**：统一入口和已安装 rich UI 调 attachResources(dictionaryId,mdxFileName,files)，只能给已安装 MDX 增加/替换资源集合。validateFiles 通过 contract 排序同名 base+.1…，校验每文件 ≤128 MiB、总计 ≤512 MiB，再建立独立 resourceVersion。
- **IO/调用链**：PREFLIGHT 只发文件名/大小等摘要；Worker START 才传 File 集合。READY 后终止 Worker，COMMIT 携 dictionaryId/request/resourceVersion/metadata；返回 ready+commit。waitForReady 过滤请求 ID、转发文件级进度并移除监听，错误保留 code/name。
- **状态/取消**：active 独占；phase 为 preflight/worker/commit。cancel/dispose 同 MDX 的分阶段语义，后台 commitpoint 拒绝取消。未 committed 的 catch 请求 RICH_MDD_RESOURCE_ABORT；finally 终止 Worker、清 active。与 MDX controller 的差别：没有成功后卸载整本 MDX 的步骤，附件只管理自己的暂存版本。
- **安全/恢复**：文件名必须匹配 MDX，不能用归档提供的路径当任意输出路径；控制器不读/执行 CSS/媒体。旧资源保持与否最终依赖后台 active.resources 指针，而不是本地 cancelled 布尔值。
- **修改/测试**：调整附件顺序、fileName 或 version 协议须同步 MDD contract/worker/manager；E2E mdd-resources、local-dictionary-import-v2-product 包含附件与取消路径，NOT_RUN。

<a id="file-mdd-worker"></a>
## 10. src/options/workers/mdd-resource-import-worker-core.js

源码：[src/options/workers/mdd-resource-import-worker-core.js L1–173](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/mdd-resource-import-worker-core.js#L1-L173)。

- **职责/IO**：createMddResourceImportWorkerHandler 接收已排序文件组，建立多源紧凑索引并写同一 rich OPFS 根目录下独立 resourceVersion。READY 的 metadata={mdxFileName,resources}，每个 descriptor 含槽位 source/index 路径、文件名、大小、索引哈希和 keyCount。
- **算法**：validateInput 检查 dictionary/request/version、1–16 文件、同名连续编号与大小。确认 resourceVersion 不存在；依次构建/validate MDD index，索引每个 ≤16 MiB、总计 ≤32 MiB，源总计 ≤512 MiB；对索引做 SHA-256，保存 source 与 index 后重读大小。resourceFilePaths(index) 使用固定编号槽位，不照抄归档路径。最后再次核对资源顺序。
- **状态/失败**：单 active AbortController；fileSource 在范围读取前后检查取消和短读；任意文件失败清整次 resourceVersion，旧 active.resources 不由此 Worker 触碰。post ERROR 保留 code/name；未进入 active 的验证异常由壳处理。emitProgress 尽力发送，不让 UI 进度失败主导导入。
- **检查边界**：buildIndex 检查键与块描述符，不等于每个媒体均可播放；后台提交还要 rebuild 并 verifyMddRecordBlocks。真正请求资源时才分类 payload/MIME/尺寸。
- **修改/测试**：index schema/路径/顺序变化同时影响后台 snapshot、哈希和重建比较；mdd-format 的 record 验证和 E2E mdd-resources 是相关断言，NOT_RUN。

<a id="file-sanitizer"></a>
## 11. src/content/selection/rich-sanitizer.js

源码：[src/content/selection/rich-sanitizer.js L1–134](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-sanitizer.js#L1-L134)。

- **职责/调用方**：classic IIFE 幂等注册 selectionRichSanitizer；必须先有 tokenizer/style 模块。result-renderer 将 rawRecord/format/styleSheetRules 交 sanitizeRichDictionaryRecord；输出普通对象 AST {nodes,truncated}，不是可插入 innerHTML 的字符串。
- **算法**：先有界计算 UTF-8；输入/Compact 展开均 ≤512 KiB。非 HTML 按字面 Text 返回最多 64 KiB。HTML 将合规的 1–255 Compact marker 包成 span+对应 begin/end，再交同一 tokenizer，规则内 HTML 一样不可信。未知 marker 保留字面；rules 数量/ID 重复/类型/单片 4096 字节/总 64 KiB 任一失格即用空规则。
- **降级/状态**：输入不能转字符串返回空 fallback；超限、解析 invalid/truncated 或展开溢出时 stripToPlainText，再 UTF-8 裁剪，不返回半棵未经说明的富文本树。limits 还约束节点8192、深度32、标签4096、属性2048、每标签属性32、资源8。所有中间状态按次调用创建，无持久化，无 async cancellation；外层选择会话控制过期结果。
- **修改/测试**：不能改成浏览器 HTML parser 来“修复显示”；Compact 展开不是执行样式脚本。rich-dictionary-sanitizer 与 rich-viewer-contract 检查恶意标记、实体、未知 Compact 和预算；NOT_RUN。

<a id="file-sanitizer-style"></a>
## 12. src/content/selection/rich-sanitizer-style.js

源码：[src/content/selection/rich-sanitizer-style.js L1–145](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-sanitizer-style.js#L1-L145)。

- **用途/调用**：classic 幂等 style API 同时供 tokenizer 的内联样式和 resource resolver 的外部本地 CSS 重建使用；只返回安全属性/值对象，无 DOM 或网络副作用。
- **safeAttributes**：class 名采用有限字符/48 字符/最多4项去重；colspan/rowspan 仅 td/th 且1–100；data-compact-id 至255。不保留 id、href、事件属性或任意 data 属性。viewer 后面会把表格跨度再收紧到50，不能把100当最终 DOM 上限。
- **safeStyle/safeStyleValue**：按分号拆声明，仅允许排版/颜色/间距/边框集合；拒绝 url/expression/@import/javascript/data/var/env/calc/behavior/binding/!important，值长度≤128且排除控制/引号/反斜杠等。字体大小按单位设上限；字体粗细/样式、对齐/white-space、行高有具体枚举或数值语法；safeSpacing 不接受负值及任意单位；safeBorder 按宽度/样式/颜色最多各一项组合。
- **safeColor**：接受固定命名、hex 与有限 rgb/hsl 语法；这不是完整 CSS 解析器，也不是任意浏览器颜色函数。unsupported 值被略过，整条失败不抛用户异常；无全局可变查询状态，无取消动作。
- **修改/测试**：新增属性/单位要同时检查 viewer 二次白名单和 MDD stylesheet 编译器，不应为兼容词典加入位置覆盖、网络 URL 或 CSS 执行能力。sanitizer/viewer/security 测试相关，NOT_RUN。

<a id="file-viewer"></a>
## 13. src/content/selection/rich-viewer.js

源码：[src/content/selection/rich-viewer.js L1–230](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-viewer.js#L1-L230)。

- **职责/输入输出**：selectionRichViewer.render(container,ast,fallbackText,options) 创建/复用 open ShadowRoot，返回布尔是否可渲染。renderPlainText 保留换行。由 result-renderer 调用；先 close 旧资源 session，再 replaceChildren 建样式与可聚焦 role=region viewport。
- **构建方式**：仅 createElement/createTextNode；renderNode/appendChildren 双重约束8192节点、深度32。text 为惰性文本；允许基础段落、列表、表格、ruby，active 标签丢弃子树；未知标签只展开孩子。table 包横向滚动，viewport 高210px可滚动；空树用 fallback，truncated 附提示。light DOM 也保留有界 fallback 文本。
- **二次守门**：重新验证 class/Compact/表格跨度和 style，字体强制 clamp(8px,…,48px) 防嵌套相对单位无界放大；特定蓝/灰色映射暗色 token。此层不是替代 sanitizer 的完整 CSS validator，应只接收 sanitizer AST。
- **资源**：resource 节点需 canonical path 且 kind 为 image/audio/stylesheet；图片音频先占位，stylesheet 只收集描述，交 resolver+dictionaryId。普通 img/audio AST 不直接设置任意 src；脚本、表单、SVG、iframe 不进入 viewer。
- **状态/错误/释放**：无持久状态；无 ShadowRoot 能力返回 false，由调用方走纯文本。换词/关闭通过外层 rich-details/resolver 释放 URL，重 render 主动关闭旧 session。Shadow DOM 是样式隔离，安全还依赖 AST/路径/资源策略，不能把它称为执行沙箱或 iframe。
- **修改/测试**：layout/暗色/键盘/窄屏改动需浏览器验证；rich-viewer-contract 的节点限制、独立字号 clamp、无网络/HTML parser 断言以及 rich-viewer-security E2E 均 NOT_RUN。

<a id="file-resource-path"></a>
## 14. src/content/selection/rich-resource-path.js

源码：[src/content/selection/rich-resource-path.js L1–26](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-resource-path.js#L1-L26)。

- **职责/调用**：tokenizer、viewer、resolver 共用 normalize，将不可信词典引用转成 MDD 内相对键；不是 URL resolver，没有当前网页 baseURL。
- **算法**：输入非空字符串≤4096；在 decodeURIComponent 前拒绝百分号编码分隔符/控制字符，解码一次后拒绝残余%、控制、冒号、查询/fragment、scheme/盘符与双起始分隔符；允许去掉一个虚拟根 / 或反斜杠，随后统一为 /。段不得为空、.、..，保留大小写。
- **结果/状态/错误**：无效或解码失败返回空字符串，调用者略过资源；无读写、网络、持久状态或取消句柄。canonical path 是内部键，不赋予宿主文件系统访问能力。
- **修改/测试**：前端与后台 normalizeMddResourcePath 必须语义协调，但后台仍须独立验证；不能允许远程/协议相对地址来补图。MDD security 和 sanitizer/浏览器安全相关断言，NOT_RUN。

<a id="file-resource-resolver"></a>
## 15. src/content/selection/rich-resource-resolver.js

源码：[src/content/selection/rich-resource-resolver.js L1–412](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-resource-resolver.js#L1-L412)；生命周期 [src/content/selection/rich-resource-resolver.js L217–301](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-resource-resolver.js#L217-L301)；CSS [src/content/selection/rich-resource-resolver.js L303–354](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-resource-resolver.js#L303-L354)。

- **职责/IO**：classic 模块依赖 runtime/path。attach 为 container 建 WeakMap session，activeSessions 支持全关闭；session 保存 dictionaryId、资源、URL、请求ID、字节/像素预算。最多8个引用；图片/stylesheet 自动排队读取，audio 先安装加载按钮，点击后才取字节，创建 controls/preload=none/autoplay=false 的 audio。
- **并发/请求**：模块全局 readQueue 最多2个 runningReads。fetchAsset 创建 selection-mdd-resource-* requestId 和固定本 Content 文档 ownerToken，发 RICH_MDD_RESOURCE；返回后复核 session 当前性、ok/found、MIME、正尺寸、≤8 MiB、base64字符上限及解码后精确长度；CSS≤64 KiB，图片需有效宽高。不是远程 fetch。
- **媒体/预算**：createTrackedUrl 仅从响应字节创建 Blob URL；每 view 总 Blob≤32 MiB、图片总像素≤16 Mi，超限保留占位。图片 error、过期 load、失败或关闭均 revoke；音频按用户加载，失败不自动重试/播放。URL 仅活在 session 内，activeObjectUrlCount 可供断言观察。
- **受限 CSS 编译**：compileLocalStylesheet 用 fatal UTF-8，拒绝控制、任何 @、注释、反斜杠、url/expression/脚本 scheme；逐块严格匹配，没有剩余杂文。每组最多3选择器，仅 tag、.class、tag.class；每规则≤12声明、最终≤64规则。属性受白名单与 safeStyleValue 双重校验，每个 selector 加 .tf-rich-viewer 前缀并放本 ShadowRoot；font-size 再 clamp。复杂选择器/伪类/@font-face/背景图均非当前支持能力。
- **取消/清理**：close/closeAll/closeDictionary → closeSession 标记 closed、移除映射和队列项、对正在读取请求发 RICH_MDD_RESOURCE_READ_CANCEL、清 inFlight、撤销所有URL、移除 stylesheet；closeDictionary 另将可见媒体恢复占位。取消消息失败被吞掉，但 isCurrent 防止迟到响应重建 DOM；后台 owner 校验/AbortSignal 才取消实际 IO。runningReads 在 finally 降计数继续排队，关闭不会凭空将实际运行数清零。
- **细节/改动影响**：请求随机数不可用时有 Math.random+计数 fallback，不能把 ownerToken 单独说成安全认证；Chrome sender 身份才是后台边界。decodeBase64 使用正则+expectedSize，CSS解析和路径规范化均 fail closed。更改缓存、并发、图片像素、closeDictionary 或 CSS 支持，应同时复核后台 MDD预算、消息身份与泄漏测试；rich-resource-resolver 测试检查清队列，mdd-resources E2E 检查刷新/图片/音频/CSS，均 NOT_RUN。

## 局部依赖：只解释本链需要的边界

以下文件没有升级为“完整解释”。解析器内部、所有快照字段/迁移、跨功能路由、完整测试夹具仍需各自专题。

<a id="partial-options"></a>
### Options HTML、旧入口与提示辅助

- [options.html L106–161](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/options.html#L106-L161) 与 [options.html L368–375](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/options.html#L368-L375)：当前显示的是 localDictionaryFiles 多选入口和 richMdictInstalledList，加载统一 local UI 与 rich UI。没有 richMdictFile，因此 rich-mdict-import-ui.js 实际走“仅已安装列表”分支；不能将其后半旧单文件 inspectSelection 当当前统一入口。
- [src/options/rich-mdict-import-ui.js L17–213](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/rich-mdict-import-ui.js#L17-L213)：当前分支创建 MDD controller、监听 dictionary-state-changed、刷新 RICH_MDICT_LIST，并在 pagehide dispose。后面的 renderInstalled 建健康/元数据/偏好/添加替换附件/删除按钮；旧单文件路径保留在源码，不是 Oxford10 新入口。
- [src/options/local-dictionary-installed-state.js L1–54](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/local-dictionary-installed-state.js#L1-L54)：两类状态查询 Promise.allSettled；rich/packs 分开记录 known，不能将失败查询当“没有安装任何词典”。[src/options/local-dictionary-import-presentation.js L1–333](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/local-dictionary-import-presentation.js#L1-L333)：只在本链范围复核报告、限制/语义/重复确认与进度/错误文案；普通 MDX 重复候选按名称等提示，用户确认后保留另一份。完整文案表与其他 family 分支待后续解释。

<a id="partial-protocol"></a>
### Worker 壳与消息协议

[src/options/workers/rich-mdict-import-worker-protocol.js L1–8](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/rich-mdict-import-worker-protocol.js#L1-L8)、[src/options/workers/mdd-resource-import-worker-protocol.js L1–8](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/mdd-resource-import-worker-protocol.js#L1-L8) 定义 START/CANCEL/PROGRESS/READY/ERROR 字符串。[src/options/workers/rich-mdict-import-worker.js L1–20](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/rich-mdict-import-worker.js#L1-L20)、[src/options/workers/mdd-resource-import-worker.js L1–18](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/mdd-resource-import-worker.js#L1-L18) 各创建一个 handler，监听 message，并给在 handler 外层抛出的输入/忙碌等异常补上 requestId/errorName/errorCode。这里仅解释连接 controller/core 的薄层；未将它们加进15个完整文件计数，也未展开生产构建资源闭包。

<a id="partial-router"></a>
### 路由、身份与 API 组合

[src/background/router.js L226–403](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js#L226-L403)：
- IMPORT_PREFLIGHT/COMMIT/CANCEL/ABORT、LIST、偏好和 UNINSTALL 要求 Options sender URL。
- 单词典 rich lookup、viewer list、MDD读取与取消要求扩展自身 sender.id、tab.id、HTTP(S) Content 来源；ownerKey 优先 Chrome documentId，回退合法 ownerToken，合并 tab/frame/document。
- MDD commit/卸载成功后通知 Content RICH_MDD_RESOURCES_CHANGED；缺少 content script 的 tab 通知失败被忽略。
- 旧未带 dictionaryId 的 RICH_MDICT_LOOKUP 另走旧 API 分支，不能用受保护的单词典分支描述所有历史路由。

[src/background/packs/api.js L1–299](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/api.js#L1-L299) 的本链部分懒建 rich/MDD manager 并共用 rich state store；commit 后 reconcile 偏好，viewer list 返回启用元数据，lookup 检查停用。uninstall 后清 MDD index cache 和偏好。本章不展开全体结构化 pack API/偏好排序；已详解查询请回[selection 模块](selection.md#file-rich-lookup-controller)。

<a id="partial-storage"></a>
### OPFS、状态、MDX 提交与重启

[src/background/packs/rich-mdict-contract.js L1–24](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-contract.js#L1-L24) 定义独立根 rich-mdict-dictionaries、state key tfRichMdictStateV1、source.mdx/index.json 和格式预算；其完整 metadata/schema/migration 校验不在本轮覆盖内。

[src/background/packs/opfs-store.js L1–290](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/opfs-store.js#L1-L290) 提供 pack/version/path 验证、Blob 写入、范围读取及目录删除；带 signal 的 Blob stream 读取会 cancel reader 并检查累积/短读。[src/background/packs/state.js L1–74](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/state.js#L1-L74) 将 active/reservations/resourceReservations 放 chrome.storage.local，update 按同 storageArea+stateKey Promise 队列读改写。两个存储系统不是同一个数据库事务。

[src/background/packs/rich-mdict.js L94–230](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict.js#L94-L230)：commit 按 pack 串行，检查预留/替换身份，assertStagedFiles 后生成 snapshot，commitpoint 内再次核对并写 healthy/active/fallback=null、移除预留；失败且未提交才清 staged。cancel 在 commitpoint 明确返回 false。
[src/background/packs/rich-mdict.js L289–342](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict.js#L289-L342)：暂存核验不是仅比传入 checksum，还从 OPFS 原 MDX 范围重建索引，与暂存 JSON 严格比较；buildRichMdictIndex 不展开全量 records。因此“安装完整复核”不等于全词典每条正文渲染已认证。
[src/background/packs/rich-mdict.js L244–287](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict.js#L244-L287)：卸载先删字节，失败保留可重试行；abortImport 不删已经 active 的同版本。

重启后懒建新的 manager/indexCache，active 快照与字节仍存在；list/lookup 校验 source 大小、index 大小/哈希及 metadata 对应关系，随后有界查询。这里没有导入任务 checkpoint 自动续传，也没有在该 manager 中实现“重启即扫描回收所有 rich reservations/orphan staging”。createdAt 和持久预留不等于恢复调度器。成功导入的重新打开可查询，与进程中断时所有暂存必定清理，是不同承诺。

<a id="partial-replacement"></a>
### 已交付的替换范围

[src/background/packs/rich-mdict-catalog-replacement.js L1–86](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-catalog-replacement.js#L1-L86) 只允许声明的同 curated recipe、expectedActiveVersion 与现 active 一致的新版本；普通 UUID 本地 MDX 不走同名覆盖。预留阶段、提交前和状态更新内都复查目标，避免旧确认覆盖新安装。
retainCatalogResources 仅当旧新 curated mdxSha256 相同且资源所记 mdxFileName 与新 filename 相同时把旧 resource snapshot 保留；成功提交后 cleanupCatalogVersions 删除除新MDX与保留附件外的版本，清理失败吞掉，不伪装提交回滚。需要改普通本地替换行为时，不能借这段代码声称已经支持。

<a id="partial-parser"></a>
### MDX/MDD 索引与查询内部

[src/background/packs/importers/mdict-rich-metadata.js L17–110](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-metadata.js#L17-L110) 检查 MDX v2、HTML/Text、0/2 加密及 header校验，parseStyleSheet 得到 Compact 规则。[src/background/packs/importers/mdict-rich-index.js L41–249](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-index.js#L41-L249) 读取 header、key preamble/info、逐 key block 与 record descriptors，检查数量/offset/总量，并给 key block 添加规范化 lookupMin/Max、首末 record offset；原始 MDX 保留为 query 数据源，不转成全部 records 的常驻数组。
[src/background/packs/importers/mdict-rich-lookup.js L1–370](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-lookup.js#L1-L370) 在候选 key block 内找匹配，按 record offset 范围读取/解压；共享本次查询 budget，受限处理 @@@LINK=（最多8 alias hops）与取消，返回 rawRecord+safeTextFallback。这里仅解释上下游接口，不逐个讲 key-codec、block-codec、解密/预算/实体算法。
[src/background/packs/importers/mdd-index.js L1–239](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-index.js#L1-L239) 为资源键与二进制 record 范围建索引；verifyMddRecordBlocks 在提交前逐块解码验证损坏，不是把二进制当 UTF-8 字典正文。压缩类型/展开比例/范围检查仍由相邻 codec/validation 负责，未将整个 parser 家族标为已解释。

<a id="partial-mdd-manager"></a>
### MDD 原子附件集合、查资源与取消

[src/background/packs/rich-mdd-contract.js L1–62](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdd-contract.js#L1-L62)：base .mdd 必须在场，编号 .1…连续，最多16文件；固定 resources/NNN.mdd 和对应 index.json 槽位，附件 snapshot 指向独立 resourceVersion。单源128 MiB、总源512 MiB、单索引16 MiB、总索引32 MiB、单asset8 MiB是不同预算。

[src/background/packs/rich-mdd-resources.js L68–207](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdd-resources.js#L68-L207)：
1. preflight 确认已安装 MDX 身份/文件名、配额、无同包资源预留。
2. commit 核对 reservation、每个 source/index 大小和哈希，重建索引严格比较，再 verifyMddRecordBlocks；全部成功后才进入 commitpoint。
3. state update 再核对 MDX packVersion 未变，将 active.resources 一次换成新集合，删除预留；成功后尽力清旧资源版本。验证失败/获准取消清新 staging，旧指针保持。
4. abort 不删除已经 active.resources 指向的版本。并发卸载/替换通过与 MDX 共用的 serializeRichMdictPack 排序。

[src/background/packs/rich-mdd-resources.js L209–267](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdd-resources.js#L209-L267) 查资源：规范化请求，确认 healthy MDX 及 resource snapshot，遍历 companions 共用预算；重复命中是 ambiguous 错误，不选“第一份”。返回 found/MIME/kind/size/base64，图片附 dimensions。索引缓存按总32 MiB/LRU处理；资源不是任意外部 URL。
[src/background/packs/rich-mdd-lookup-cancellation.js L1–82](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdd-lookup-cancellation.js#L1-L82) 将 requestId 与 ownerKey 配对；先取消后到达的查询记15秒、最多128条 tombstone。owner-mismatch 不取消他人请求。该 TTL 属于查询取消缓存，不是导入 reservation 的 TTL。

<a id="partial-tokenizer"></a>
### HTML tokenizer 与资源内容策略

[src/content/selection/rich-sanitizer-tokenizer.js L1–399](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-sanitizer-tokenizer.js#L1-L399) 在字符串上扫描有界标签/属性，不使用 DOMParser/innerHTML。危险 active 子树丢弃；基本排版元素转 AST；font 转 span；href 导航不保留；img/audio/link stylesheet 只在相对路径合规时生成 resource。实体解码结果是文本，不回灌 HTML parser。注释未闭合、超大/非法 tag 或嵌套预算失败交 sanitizer 做纯文本 fallback。这里没有逐个解释 tokenizer helper 的完整边界，仍为局部。

[src/background/packs/importers/mdd-resource-policy.js L1–61](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-resource-policy.js#L1-L61) 请求资源时按扩展名与字节结构分类，图片支持受限 PNG/JPEG/GIF/WebP，当前音频实际分类仅 MP3/OGG/WAV；CSS 为 fatal UTF-8、≤64 KiB。不能因为上层 MIME 正则还出现 AAC/MP4/FLAC 就声称这些已能从当前 parser 输出。图片格式结构检查、边长/总像素和动画拒绝也在此文件，完整格式解析以后再讲。SVG、HTML、JS、不明媒体不进入资源交付；CSS 在 Content 仍要再次受限编译。

<a id="test-boundaries"></a>
## 测试证据与未验证项

以下均 **NOT_RUN**，只是已存在测试的静态断言阅读。每个链接固定到本章 main；不引用某次旧 CI 成功作为本轮结论。

- [tests/local-dictionary-preflight.test.mjs L1–358](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/local-dictionary-preflight.test.mjs#L1-L358)：MDX+连续MDD关联、无关文件、未确认 Text 仍 rich、LZO 与损坏分类、重复名/取消及无网络；也有 StarDict/TFLex 断言，本章只引用其分流边界。
- [tests/rich-mdict-product.test.mjs L11–106](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdict-product.test.mjs#L11-L106)：假 runtime/worker 验证 File 直接交 Worker、先 preflight 后 commit、too-late cancel 不误报取消、接受取消才 abort、无效 input 不占 active。模拟并不能证明浏览器真实 Worker/OPFS 行为。
- [tests/rich-mdict-storage.test.mjs L1–759](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-mdict-storage.test.mjs#L1-L759)：commit 从源重建索引、同尺寸伪索引拒绝、reload 后范围查询、取消串行、卸载失败可重试、精选失败替换保留旧版本及成功保留MDD。底层主要为测试 store，不是实机崩溃恢复认证。
- [tests/mdd-format.test.mjs L1–199](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/mdd-format.test.mjs#L1-L199) / [tests/mdd-security.test.mjs L1–153](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/mdd-security.test.mjs#L1-L153)：独立小型fixture、none/zlib、跨record block字节、所有 staged record块核验、预算、路径歧义、损坏/图片炸弹与中止范围读取；不证明任意真实词典全面兼容。
- [tests/rich-dictionary-sanitizer.test.mjs L1–154](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-dictionary-sanitizer.test.mjs#L1-L154) / [tests/rich-viewer-contract.test.mjs L1–245](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-viewer-contract.test.mjs#L1-L245)：基础层次、Compact、实体惰性、危险标签/事件/远程资源拒绝、纯文本 fallback、AST/字号边界。VM/模拟DOM断言不能替代真实浏览器视觉/可访问性。
- [tests/rich-resource-resolver.test.mjs L1–84](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/tests/rich-resource-resolver.test.mjs#L1-L84)：8个资源只有2个读取启动，close清6个排队项并给2个在途请求各发取消，旧结果返回后运行/排队计数归零。它没有单独证明所有 object URL 行为；这些还需浏览器路径。
- [e2e/local-dictionary-import-v2-product.spec.mjs L1–485](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/local-dictionary-import-v2-product.spec.mjs#L1-L485)：统一选择器、无关/编号MDD阻断、重复另存确认、preflight/索引取消、附件取消保留旧集合。
- [e2e/mdd-resources.spec.mjs L1–318](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/mdd-resources.spec.mjs#L1-L318)：MDX/MDD小型独立fixture在reload后恢复图片、按需音频、safe CSS，并观察网络与资源清理；[e2e/rich-viewer-security.spec.mjs L1–273](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/e2e/rich-viewer-security.spec.mjs#L1-L273)：敌意HTML/CSS不可执行、可读结构保留。
- 项目 validate、构建、富文本安全/取消专项、浏览器E2E、实际私有词典、扩展重启/崩溃手工验收本轮全部 NOT_RUN。本章不包含文件正文/下载地址，不以“supported”状态背书 Oxford10 完整阅读体验。

## 最小改动入口与影响半径

- 改文件选择/提示：从 local UI 与 presentation 入手，保留报告状态、重复确认和 installed-known 阻断。
- 改支持格式：从 preflight-mdx 与 parser capability/validation 入手；Worker、后台重建、schema 和查询预算必须一致，单改提示没有实现兼容。
- 改持久化/替换：检查 reservation → staged → active 指针和 commitpoint；普通本地、curated reinstall、MDD附件集合是不同替换合同。
- 改富文本样式：从 sanitizer-style 与 resolver 的有限 CSS 编译器入手；同时验证 tokenizer/viewer AST边界。缺图或交互缺失不能通过执行词典脚本、允许远程资源或放宽CSP解决。
- 改关闭/取消：前篇 rich-details/controller 与本章 resolver、后台 ownerKey/AbortSignal 一起看。只隐藏UI会留下工作和句柄，只发送cancel也不能让旧结果写回。


## 后续内部链

前述局部Rich MDX/MDD parser、资源策略、OPFS与manager现在有[完整内部说明](mdict-storage-internals.md)及[功能链](../features/mdict-storage-internals.md)。本章原固定源码引用与当前main相关blob一致，历史“局部”只描述本章范围；全仓完整状态以coverage为准，不重复计数。未执行真实词典或浏览器验证。
