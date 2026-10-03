# TranslateFlow Oxford10 兼容性设计

日期：2026-10-02

> 状态：设计方案。实际 Oxford10 元数据与当前源码已做只读检查；浏览器导入、展示、交互、性能及安全验收全部为 `NOT_RUN`。本次不实施代码，待额度重置后再开始。

> 公开范围：仅包含结构元数据、词条标识、摘要和开源源码链接；不提供词典下载地址、原始 HTML、释义、例句或媒体内容。

## 1 结论与实际验收对象

**实现必读：[第5A节核心执行合同](#parse-render-contract)**。它把安装、网页查询入口、MDX索引/记录解压、HTML与CSS编译、MDD/外置资源、viewer动作、共同消息结构、重启恢复及最终制品验收串为同一条产品流程。T1–T6是实现分工，不是六个互相独立的产品。


建议保留现有 OPFS 原文件存储、分块索引、按需解压和安全 AST 渲染链，围绕这份 Oxford10 补齐资源包关联、原布局和有限交互。拟采用成熟 CSS 解析依赖及扩展自有的 Oxford10 行为适配器；整套 reader 替换、WASM 迁移和通用词典脚本运行时均不进入本轮方案。

**交付目标**是让用户手中的完整 Oxford10 在浏览器中呈现原词条布局、字体、图片、发音与已确认交互，并以欧路中的实际表现为参照。欧路应用外壳和任意 MDX 的通用脚本兼容不属于该目标。当前仅完成只读研究，实施须等额度重置后再开始。

### 本次包的静态证据

| 文件 | 实测字节数 | 作用 |
| --- | --- | --- |
| 主 MDX | 38,807,694 | 词条索引与 HTML 正文 |
| 基础 MDD | 30,900,438 | 图片 字体 CSS 与内嵌 JS |
| 编号 1 MDD | 1,463,189,889 | 音频资源卷 |
| 外置 CSS JS PNG | 61,996 / 14,852 / 35,943 | 同目录样式 脚本与图像 |
| 六文件合计 | 1,533,010,812 | 约 1.533 GB 十进制 |

MDX 头部为 v2、UTF-8、HTML、未加密，Stripkey=Yes、KeyCaseSensitive=No；133,571 个索引项不等于独立主词条数量。基础 MDD 的 193 个资源包括 155 JPG、29 PNG、3 SVG、4 TTF，以及 CSS 和 JS。音频卷有 203,285 个索引项；抽查键名和首块 ID3 标记与 MP3 相符，未实际播放。

**验证边界**：已通过目录清单与 HTTP 范围读取核对元数据，并抽出 arch 的 18,923 字节 HTML、CSS 和 JS；未对完整大文件计算哈希，未完成全部媒体检查，也未做浏览器导入、视觉或交互验收。欧路的 arch 截图是参照，不是浏览器通过证据。

## 2 当前实现与确定的阻塞

**本轮精读修正**：词条 viewer 实际使用 open Shadow DOM，安全性不能依赖其开放/封闭模式；实包头部精确写为 `Stripkey="Yes"`，当前代码仅查 `StripKey`，会漏读。第5A节明确属性兼容、索引语义版本与重建规则。当前一本词典只返回一个匹配正文，也需补同键多记录合同。字体/SVG还被后台资源分类拒绝，不能只改前台标签白名单。


以下代码结论固定在 main 的 d5e308a709c008acf6b277d466d020f13025bdca。现有链路已经用 File.slice 和 OPFS 范围读取，查询时定位相关块，并通过受控 AST 在词条 viewer 的 open Shadow DOM 内重建词条。应保留块校验、取消、资源并发限制、Blob URL 释放和附件替换失败保留旧版等能力。

### 总量限制需要按语义调整

每个 MDD 128 MiB、MDD 合计 512 MiB、所选文件合计 640 MiB 的限制均与实包冲突。实际 MDX 累计解压记录流为 344,095,474 字节，超出其 256 MiB 预算；音频 MDD 的累计解压记录流为 1,631,826,474 字节，也超出当前 MDD 的 128 MiB 预算。这是元数据与代码条件的对照结论，尚未运行浏览器导入。

累计记录流是逻辑地址空间，不能作为驻留内存大小来拒绝大包。保留现有安全整数、偏移单调性、区间边界及块校验，分别核算导入验证工作量和实际内存。MDD 顺序全块校验的进度应反映实际待解压总量；它与查询时按需读取是两条不同路径。[MDD 合同](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdd-contract.js) [MDD 元数据校验](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-validation.js)

### 外置资源尚未纳入词典包

预检将 CSS、JS、PNG 归入未关联文件，界面会阻止导入；现有资源查询仅访问已关联的 MDD。需要统一包清单并持久化外置样式和图像。JS 可以识别、登记和诊断，仍禁止执行。[文件组预检](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/local-dictionary-preflight-mdx.js)

### 布局和 HTML 动作存在明确缺口

61,996 字节的 CSS 未超过 64 KiB，但现有编译器遇注释、@规则、反斜线或 url() 会将整份样式清空，只支持简单标签或类选择器。当前 AST 缺少 radio、label、details、SVG 等实包结构；arch 有 26 个 img 标签，去重后仅 5 个图像引用，另有 12 个内联 SVG。每条最多 8 个资源的策略不能承载实际词条。

已有 @@@LINK= 别名最多跟随 8 跳，不能称为完全没有跳转。缺口是 HTML 内部的 entry://、sound:// 和片段导航。210 px 高度可保留为紧凑模式，完整阅读需可展开。[资源与 CSS 处理](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-resource-resolver.js) [现有渲染器](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-viewer.js)

## 3 长词条与有界预算

完整 MDX key offsets 显示，go 单条 HTML 为 778,100 字节，come 为 587,579，get 为 566,816，均超过现有 512 KiB 单记录上限。代码在记录读取、消息 rawRecord 和 sanitizer 三处设有该限额；只改一处仍会被拒绝或降级。现有跨 record block 的按需读取已实现，无需另造 reader。

go 的正文已通过范围读取完整提取作静态分析：13,644 个元素加 4,190 个文本节点，约 17,834 个原 HTML 节点；最大深度 17，含 777 个内联 SVG。去重引用包含 526 个音频、44 个词条链接及 14 个图像。此计数不是 sanitizer 实际输出，也不是浏览器性能结果，但足以表明 8,192 节点及八资源描述的上限不适用。

### 贯通各层的候选预算

| 对象 | 候选值或策略 | 依据与限制 |
| --- | --- | --- |
| 原始与展开正文 | 1 MiB / 2 MiB | 覆盖已测最大记录；读取 消息 sanitizer 统一策略，展开后仍有界 |
| AST 与 viewer | 32,768 节点 深度32 | 覆盖原HTML静态量级的候选；仍须测最终AST和完整显示，超限明确提示 |
| 资源描述 | 1,024 条去重路径 | 与活跃资源分离，覆盖go的586种引用；词条跳转不预取 |
| 活跃资源 | 并发2 单项8 MiB / 总Blob32 MiB | 沿用有界策略和LRU；音频点击加载 图片视口懒加载 |
| 驻留索引 | MDX8 MiB / MDD16 MiB 总32 MiB | 保留独立索引预算并验证实包是否适配，不随源文件上限一并取消 |
| 逻辑流与导入工作 | 安全偏移与实际工作计数 | 累计decoded不是内存cap；继续单块 解压比 元数据与越界检查 |

这些值是设计候选，不是性能承诺。词性或长段落可按需挂载，保证片段导航能先挂载目标；不得预加载 go 的 526 项音频。任何截断或纯文本降级都应显式显示，验收时必须可达长词条末尾。

实包最大解压块分别为 MDX 778,100 字节、基础 MDD 842,168 字节、音频 MDD 175,147 字节。保留现有有界解压策略，先测实际取消延迟；MDD 已有块间 abort，无需先加新的 worker 层。

[正文与索引合同](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-contract.js#L16-L20) [安全偏移和跨块读取](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-lookup.js#L270-L325)

## 4 成熟实现的可借鉴范围

保留现有架构是在核对成熟实现后的选择。最有价值的参照分别是 GoldenDict-ng 的格式兼容行为，以及 Readest 在真实浏览器产品中的布局、资源与受控点击处理。两者均没有提供这份 Oxford10 整包和 4 GB 浏览器全流程已经通过的证据。

| 参照 | 已核实能力 | 本项目取舍 |
| --- | --- | --- |
| GoldenDict-ng | Qt 桌面产品；按块读 MDD；支持编号资源卷、同目录外置文件、多文章和重定向 | 参考资源优先级与查询语义。Qt 文件映射与索引耦合深，整体移植 WASM 不属于最小变更 |
| Readest 与其 js-mdict fork | 真实产品使用 Blob 异步切片。Oxford9 修复覆盖片段跳转、MDD 发音和图片放大 | 参考浏览器 IO 和自有交互接管。Oxford9 的修复不能作为 Oxford10 验收 |
| css-tree | 成熟 CSS AST 的 parse walk generate；MIT；可选择 parser 与 walker 入口 | 引入为语法解析和 URL 重写工具，配合自有显式白名单；它本身不是安全清洗器 |

### 为什么不直接换成 Readest fork

固定版本已支持安全范围内的 64 位数字字段和 File/Blob 输入，但 Readest 的 MDD.create 默认未开启 lazy，会驻留全部资源键。fork 的 lazy 路径还有末项终点、重复键、跨 record block 记录及 checksum 等需要验证或补齐的边界。数字能表达 4 GB，不能推导出完整导入和峰值内存已获验证。

Readest 不执行词典附带 JS，而接管特定音频与导航动作，支持本方案的有限适配方向。其 Shadow DOM 只是样式封装；保留 onclick、按空白截断重定向目标等做法不可照搬。TranslateFlow 应继续删除源脚本和 inline handler，并保留多词目标。

### 固定来源与依赖边界

GoldenDict-ng 固定 6a665d4fef18a9edd4102d97960a6db6d4204618：[资源卷与外部文件](https://github.com/xiaoyifang/goldendict-ng/blob/6a665d4fef18a9edd4102d97960a6db6d4204618/src/dict/mdx.cc#L1322-L1347)、[多文章与重定向](https://github.com/xiaoyifang/goldendict-ng/blob/6a665d4fef18a9edd4102d97960a6db6d4204618/src/dict/mdx.cc#L565-L618)。Readest：[Oxford9 PR 6021](https://github.com/readest/readest/pull/6021)、[固定 provider](https://github.com/readest/readest/blob/6ac46954e7a585dcd5a91c34f32a7b79ddb96bf4/apps/readest-app/src/services/dictionaries/providers/mdictProvider.ts)、[fork lazy 查询](https://github.com/readest/js-mdict/blob/d01bf62af872b1fbeacb2f18446460960e7400de/src/mdx.ts#L70-L128)。[css-tree 官方说明](https://github.com/csstree/csstree)

GoldenDict-ng 为 GPL，Readest fork 为 AGPL。当前 TranslateFlow 未发现 LICENSE，package 标记 private，不能据此推断许可兼容。若复制其代码，须另行核对分发与许可义务；本方案优先借鉴行为和测试，并将 css-tree 在构建时打包，实施时锁版本、检查新增包体积。

## 5 最小兼容设计

### 统一资源清单和路径解析

将 MDX、按编号排序的 MDD 和匹配的外置资源归为同一个词典包，保存文件角色、相对路径、大小、来源与内容摘要。统一解析器接管 HTML、CSS、音频和片段引用：规范斜杠与受控百分号解码，处理 %20 与实际空格，拒绝目录越界及外部网络 URL；只在当前词典内查找。 包内四个 TTF 通过该解析器按需提供受控字体资源。

外置 CSS 与 MDD 内嵌 CSS 的 SHA-256 一致；内嵌 JS 为 10,551 字节，外置为 14,852 字节且摘要不同。采用明确的外置资源优先规则，并显示同名差异诊断。首次完整获取后冻结整文件摘要与包清单，按已核实的资源摘要和结构识别 Oxford10 profile，不能仅凭自报名称启用适配器。JS 两份均不执行。

### 扩展受控 AST 和 CSS 能力

沿用 AST 重建，按实包需要加入结构标签、radio-only input、label、details/summary 及静态 SVG 子集。保留 DOM 顺序和 radio 的 name、id、for、ARIA 与 CSS 关系；若同一根内有冲突，须一致映射全部关联引用。剔除 form 提交、源 script、事件属性和危险 URL；SVG 的 href 与 xlink:href 也经本地资源解析器。Shadow DOM 不替代清洗器。

用 css-tree 替换手写正则解析，逐节点验证允许的选择器、属性和值，覆盖实包需要的 :checked 兄弟选择器、伪元素、媒体规则和字体声明。所有 url() 交给同一资源解析器，拒绝外部 import。无法解析的 Raw 节点或不安全规则局部丢弃并报告，避免一个注释导致整份 CSS 消失。保持隔离范围，不放宽扩展 CSP。

css-tree 的接入须同时兼容当前默认安装包与 opt-in WXT：Content 仍是 classic script，不得直接加入 ESM/npm import 或假定 WXT 已切为默认。优先把 CSS 解析与安全转换放入现有后台资源处理边界，以固定版本、可审核的本地打包资源交付，前台只接收验证后的样式结果。实现须给出默认构建和 WXT 的精确资源闭包、许可声明及包体积变化；若需新增一条运行时依赖例外，只审核该固定依赖，不全局关闭源码检查或放宽 allowlist。

### 固定行为适配器接管有限交互

原 CSS 已能通过 radio:checked 显示对应词性面板。扩展自有代码补齐：词性高亮与 ARIA、音标和发音符号组同步、键盘左右键；符号提示的外点或 Escape 关闭；unbox 弹层的打开、返回、Escape 和滚动管理；多词条活动状态。适配器不解释任意脚本或命令。

entry:// 转同词典查询，sound:// 转有用户手势的本地音频动作；片段导航先切换所属词性、展开目标，再滚动。使用明确的 entry 与 fragment 状态，替代原 JS 为欧路导航设置的 30 秒 localStorage 临时保存。图片、音频和字体按需加载，以并发、字节和缓存预算取代僵硬的总数量 8；切词取消旧请求并释放 URL。

先用实际 arch 验证这一条路径。如受控 AST 和 CSS 在合理范围仍无法保留布局，再单独验证小型 iframe 方案的既定 CSP、Blob 资源和通信边界；不能默认执行词典 JS 或放宽 CSP。[Chrome sandbox 能力边界](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox)

<a id="parse-render-contract"></a>

## 5A 从文件字节到插件交互的核心执行合同


> 本节是完整产品交付的核心执行合同。现状源码固定于 `d5e308a709c008acf6b277d466d020f13025bdca`；本章的“拟新增”都是设计合同，不表示已有 API 或已实现功能。本次仅只读代码检查，未改业务代码，未运行浏览器验收。商业词典原文和下载地址不进入本章。

### 5A.1 唯一产品闭环与集成责任

用户在 Options 选择自己持有的完整六文件包，预检明确 MDX、基础 MDD、编号音频 MDD、外置 CSS/PNG 和仅诊断的 JS。导入显示真实复制、索引、校验进度。成功后网页选中 arch，点击现有查询入口，展开 Oxford10，看到完整词条、原有词性切换和插图；点发音可听，点词条链接可以继续查词并返回。再查 go，所有词性及末尾可达，526 个音频引用不会提前下载/创建音频对象。关闭弹层、重启扩展/浏览器后仍能使用，无须重选本地文件。中断、附件损坏、配额不足时能明确恢复，不能把“只有正文安装成功”显示成“完整 Oxford10 已就绪”。

指定一个 integration owner 对这条旅程、共享合同、最终制品和证据负责。T3（解析/样式）、T4（viewer/actions）、T5（安装/资源）共同冻结第 5A.7 节的版本化合同及夹具，再并行实现；不允许各自定义另一份资源 key、articleId 或版本身份。任务独立提交可以保留，但局部 PASS 只说明局部，不代表完成。集成 owner 至少维护一条持续可运行的 arch 纵向切片，再把 go、多 records、恢复、安全纳入同一切片，不能到 T6 才第一次连接接口。

### 5A.2 当前实际调用链：安装如何挂到网页 selection

#### 2.1 安装及持久化

1. `initializeLocalDictionaryImportUi(...)` 内的 `runPreflight()` 得到报告；`importSelected()` 对 `report.route.importer === "rich-mdict"` 找 MDX，`resolveAssociatedMddFiles(...)` 找关联 MDD。
2. `createRichMdictImportController(...).importDictionary({mdxFile, displayMetadata, curatedRecipe, expectedActiveVersion})` 发送 `RICH_MDICT_IMPORT_PREFLIGHT`，启动 worker，等待 READY，再发送 `RICH_MDICT_IMPORT_COMMIT`，返回 `{requestId, ready, commit}`。
3. `createRichMdictImportWorkerHandler(...).handleMessage(message)` 用 `File.slice` 实现 `{size, read(offset,length)}`；调用 `buildRichMdictIndex({source,signal})`，写原 MDX 和 compact index 到 OPFS，核对写入长度并生成索引摘要。不是将全部 HTML 展开保存。
4. `createRichMdictManager(...).commit(input)` 验证 reservation、staged source/index 长度与索引哈希，通过 `assertStagedFiles` 从 OPFS 范围读取重建 compact descriptors，比对后才更新 active snapshot。
5. UI 取得 `imported.commit.dictionary.id` 后另调 `mddController.attachResources({dictionaryId,mdxFileName,files})`。现状是 MDX 先提交、MDD 后提交的两段流程，不是六文件事务。MDD 失败已有 `retryAttachment`/`retryMddAttachment()`，保留已装 MDX 和旧附件；当前重试所用 File 引用只在这次 UI 会话内。

**拟变更**：保留 OPFS 和 compact index。为六文件生成持久化 package manifest，给 MDX 与 resources 的不同完成状态单独展示。所有必需资源校验并激活后才显示 `ready`；只有 MDX 时显示 `text-only/resource-incomplete`。重启后从持久化状态恢复；若暂存文件已清理，则重试明确要求重新选附件，而不是保留不可用的内存 File 引用。附件版本切换继续失败保留旧版；不要宣称现有代码已实现全包原子提交。

源码：[Options 安装流程](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/local-dictionary-import-ui.js#L235-L282) · [MDX controller](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/rich-mdict-import-controller.js#L27-L138) · [worker](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/options/workers/rich-mdict-import-worker-core.js#L49-L146) · [manager commit](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict.js#L95-L194)

#### 2.2 查询时机，不另造一套入口

`selection/controller.js` 的 `translateSnapshot(snapshot, {forceTranslation})` 先调用 `SELECTION_RESOLVE`。local 命中、no-hit-local、以及 unresolved 且 intent 为 lexical 时，调用 `loadRichDictionaryDetails(snapshot,version,expectedPage,isCurrentSelection)`。普通 translation/forceTranslation 分支目前不走此富词典加载。

`selectionRichDetails.load(...)` 只发送 `RICH_MDICT_VIEWER_LIST`。后台 `createRichMdictViewerDictionaryLister({manager,preferencesStore})` 从 `listMetadata()` 取词典，合并持久化 enabled/order/expandedByDefault，滤掉禁用项并排序，第一本被标成 preferred 且默认展开。`appendRichDictionaryCards(...)` 对已展开卡立即调用 onLookup，其余等 toggle 展开才调用。

`lookupDictionary(session,dictionary,card)` 通过最多 3 路队列发：

```js
{ type: RICH_MDICT_LOOKUP, requestId, ownerToken,
  text: session.snapshot.text, dictionaryId }
```

router 验证 content sender，用实际 tab/frame/document 身份与 token 构造 owner key；`lookupRichMdictDictionaries(request,selectionOwnerKey)` 再查 enabled，然后 `manager.lookupDictionary(text,id,lookupIdentity)` → `createRichMdictLookupController(...).lookupText(text,dictionaryId,lookupIdentity)`。选择改变、页面离开、关闭会取消请求；新 adapter 的跨词导航必须复用该生命周期，不绕过 owner/cancel 校验。

**拟变更**：在原卡片内接完整阅读模式与历史；跨词导航查询词来自受控 action，不再硬编码 `snapshot.text`，但请求仍绑定原 selection session 的版本/owner。只有词典导航状态改变，不把网页本身导航到 entry://。Options 修改 enabled/order 后新查询按现有列表重新读取；活动 viewer 收到资源变更须失效旧版本资源并重新加载。

源码：[selection 路由](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/controller.js#L88-L165) · [延迟查询与取消](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-details.js#L22-L138) · [卡片展开](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/result-renderer.js#L130-L223) · [列表与查询 API](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/api.js#L70-L102) · [router](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js#L253-L329)

### 5A.3 MDX key → record span → HTML：现成能力与必须补齐的语义

`buildRichMdictIndex({source,limits,...})` 持久化 header、entryCount、totalRecordBytes、keyBlocks 和 recordBlocks。key block descriptor 保留 lookupMinKey/lookupMaxKey 及 record-offset 边界；record block descriptor 保留 dataOffset、compressedBytes、uncompressedOffset、decompressedBytes。这里的 recordOffset 是解压后逻辑记录流地址，不是 MDX 文件内的物理地址。

`lookupRichMdict({source,index,text,limits,decompressionStreamFactory,onMetrics,signal})` 的当前过程：

1. 规范化查询并检查字节预算；`findExactEntry(...)` 按规范化 key 的 min/max 选择候选 key blocks，逐块 `decodeRichKeyBlock(...)`，比较 displayForm。
2. 优先选择 normalizeLexicalExactKey 后匹配的 spelling，否则选择第一个 folded match。**当前最终只选一个 entry**，不是同键所有 records。
3. `findNextRecordOffset(...)` 找后续第一个严格大于当前 offset 的地址，必要时跨 key block，最后一个用 `index.totalRecordBytes`。相同 offset 不代表两个正文，更不能用零长度作为 record。
4. `readRecord({start,end,...})` 检查安全整数、范围和 entryBytes；二分 `findRecordBlock` 后读取所有相交 record blocks，用 `readSourceRange` 和 `decodeMdictBlock` 解压/校验，将每块的 overlap 拼接。已有跨块读取，不另写 reader。
5. `decodeRichMdictRecordText(record,index.header.encoding,displayForm,limits)` 解码为原字符串。只有以 `@@@LINK=` 开始的记录走别名处理，目标会验证，最多 8 跳，visited 检测环，目标不存在报损坏；普通 HTML 内的 entry:// 是另一件事。
6. 当前命中返回 `{found:true,requestedKey,displayForm,rawRecord,safeTextFallback,aliasTarget}`；未命中返回 `{found:false,requestedKey}`。

后台 lookup controller 现状将其包装为 `{found,dictionaries,errors}`，每本一个 `{id,title,headword,packVersion,text,richRecord:{rawRecord,format,styleSheetRules},aliasTarget?}`；router 再加 `{ok:true}`。这里 `dictionaries[]` 是多本词典，不能当作一本词典的多 articles。

**拟变更：多记录精确合同**

- 查询返回所有满足该 header 比较语义的匹配项，扫描全部候选 blocks，不因首个 spelling 命中提前结束。排序为原词典顺序；额外记录 exact/folded 类型，不把不同正文合并。
- 每个唯一 `(start,end)` 生成稳定 articleId；同 offset 的多 key 保留 matchedKeys，但正文去重。每个不同 offset 的正文独立保存、独立挂载，不能先拼成一段 HTML 造成 ID/radio 冲突。
- 别名按每条匹配记录解析；别名链有分支时保留所有唯一终点，环检测按路径、8 跳按路径，另有总展开数量/总工作预算。不得用全局 visited 把两条正常汇合的别名误判成环。保留 alias trace 元数据，不显示商业正文诊断。
- 每条 span 的结尾仍必须取原 key 序列的下一个不同 offset，不是“下一条命中的 offset”。总条数超限须返回显式部分结果/错误和原因，禁止声称完整命中。

#### Header 必须实测落到 parser 的值

头部本身用 UTF-16LE 解码，正文 Encoding 为 UTF-8，两者不同。`parseRichMdictHeader` 当前要求 v2.0，支持 HTML/Text、Encrypted 0/2，解析 StyleSheet 三行一组 `{id,begin,end}`。这是 compact marker 的包裹规则，**不是外部 CSS**。

`normalizeRichMdictLookupKey(value,header)` 为 NFKC，KeyCaseSensitive=false 时 lower-case，stripKey=true 时删除 Unicode 标点/分隔符/空白；索引边界和查询必须用同一个函数/同一个持久化 header。本次已从原始 UTF-16LE 头确认 Oxford10 精确写为 `Stripkey="Yes"`（小写 k）、`KeyCaseSensitive="No"`；两个 MDD 精确写为 `Stripkey="No"`。基线 `parseDictionaryAttributes` 保留属性名大小写，`parseRichMdictHeader` 读取 `attributes.StripKey`。所以当前 MDX 路径会把实际 Yes 默认成 false，这是确定的兼容缺口。T1 必须把原字段名和期望解析结果固化成回归夹具，明确支持该拼写；遇大小写等价重复且值冲突应拒绝，不静默挑一项。不能仅根据元数据报告写“现 reader 已正确支持这份包的 Stripkey”。

MDX 总逻辑记录流 344,095,474 字节不是常驻内存。继续保留块校验和偏移检查，调整的是错误的累计流上限。arch 原始 18,923 字节；go 为 778,100 字节，超过当前 512 KiB entry/message/sanitizer 上限，因此所有层必须共用预算，且禁止 clamp 后冒充完整 HTML。

源码：[compact index](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-index.js#L40-L250) · [完整 lookup 与跨块读取](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-lookup.js#L33-L370) · [实际响应包装](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-lookup-controller.js#L28-L94) · [header 与 normalize](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-rich-metadata.js#L17-L122) · [属性大小写](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdict-metadata.js#L189-L243)

### 5A.4 HTML、CSS、资源 key 必须一起编译，而不是“允许更多标签”

当前 `sanitizeRichDictionaryRecord({rawRecord,format,styleSheetRules})` 先展开 compact markers，再调用 tokenizer.parseHtml，返回 `{nodes,truncated}`。节点是 text / element / resource。`renderRichDictionaryRecord` 只在 !truncated 时调用 viewer，否则回退纯文本。tokenizer 只识别 img/src、audio/src、link stylesheet/href 为资源，**sound:// 链接不是 audio/src，entry:// 也没有变成可执行 action**。input 被丢弃，SVG 整棵删除，label/id/for/checked 等未形成可用关联。

**拟新增固定 Oxford10 编译流程（没有这套现成 API）**：

1. 根据导入 manifest 的可信 profileVersion 选择扩展打包的固定 adapter；未知包只走通用安全视图，不能让正文中的 class 或 script 声明自己获得执行权限。
2. 对每个 article 展开 compact marker，有界 token 化。收集 class、id、label-for、radio-name、片段目标以及 link/sound/entry；这一步生成数据，不运行文档脚本，不将原 HTML 直接插入 DOM。
3. 优先用每个 article 的独立渲染根隔离原 ID/radio group；在同根合并且发生冲突时才统一映射。若采用全新 scope，必须一次生成完整 idMap/nameMap，并同步 HTML id、label-for、radio-name、片段目标、CSS ID selector/相关属性选择器、SVG 本地 href/xlink:href 与 url(#ref)、aria-labelledby/aria-describedby 等所有允许的 ID 引用；存在无法安全重写的引用则明确拒绝该结构并诊断，不能盲改 ID 后保留失效引用。保留真实布局所需的有限标签/属性，增加静态 SVG 白名单；SVG 禁 script、foreignObject、事件和外部引用。
4. content 只做有界 HTML 安全 AST 与 idMap/nameMap，收集 stylesheet 引用；通过下述固定消息入口交后台资源处理边界（或其已有 worker）解析 CSS AST。css-tree 作为构建期审查并打包的本地依赖放在后台/worker，不在 content 闭包中执行 ESM/npm import，default/WXT 两套构建都须包含该入口。css-tree 只负责语法；自有策略决定允许的 selector/property/value/at-rule。支持本包实际用到的后代/兄弟/:checked/伪元素以及必要字体规则，拒绝危险部分并返回 diagnostics，不因一段注释将整份 CSS 清空。
5. CSS URL 依赖统一进入 resourceRefs；@font-face 中字体引用也一样。styles 与 AST 使用同一 scope/idMap。CSS 不是独立地套一个前缀就算完成，必须保持 radio/label/:checked + sibling 的结构关系。@import 本轮默认禁止；若实包有必需导入，应另以同包、深度/去重/字节预算显式处理，不能网络回退。
6. 输出安全 AST、sanitized styles、资源引用、action 引用、anchor 及 radio group 索引，交 viewer 二次验证后以 createElement/createTextNode 重建。

arch 的验收不是“有文字”：默认词性、点击 label、:checked 关联区块、字体/图标/插图都必须与参照核对。go 的约 17,834 是原 HTML 节点数，不等于输出 AST 数；32,768 AST 节点/深度32仍是候选预算，必须测编译后数量与末尾可达。

源码：[sanitizer](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-sanitizer.js#L7-L58) · [tokenizer](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-sanitizer-tokenizer.js#L7-L179) · [回退入口](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/result-renderer.js#L225-L262)

### 5A.5 统一资源解析及消息边界

#### 已有链

viewer 收集 resource nodes 后调用 `richResourceResolver.attach(container,shadowRoot,viewport,resources,dictionaryId)`。当前最多取8个描述；图片/CSS立即排队、音频点击后读，最多2路。`fetchAsset` 发送 `{type:RICH_MDD_RESOURCE,requestId,ownerToken,dictionaryId,path}`。

后台 `createRichMddResourceManager(...).lookupResource(input,lookupIdentity)` 查 active.resources 的每个 MDD index，按需 lookup；同一路径跨编号卷重复则报歧义，不是后卷覆盖前卷。成功返回 `{found,path,mime,kind,size,base64,width?,height?}`，不是 Blob URL。content 校验 MIME、base64 长度/解码后大小，再创建本地 Blob URL，关闭时 revoke。

`normalizeMddResourcePath` 与 content `richResourcePath.normalize` 目前保留大小写，去掉一个起始斜杠、反斜杠变斜杠、解码一次；拒绝协议、驱动器、query/hash、空段、`.`/`..`、编码分隔符和残留 `%`。不能把 `sound://...` 直接送进去，也不能以网页 URL 为 base。

#### 拟定资源解析合同

- action URL 先分类：entry 的词条字符串/fragment、sound 的资源路径、纯 #fragment；只有资产路径交资源解析器。fragment 不属于 MDD key。
- HTML 相对路径基于 manifest 的词条虚拟目录（本包通常根目录，须由夹具固定）；CSS 的 url() 基于**该 CSS 自己的虚拟目录**。例如 CSS 位于 styles/main.css，`../fonts/x.ttf` 解析到 fonts/x.ttf，先在虚拟根内消解点段，再交 canonicalizer；越出根立即拒绝。此 resolver 是新增，当前 normalize 函数会直接拒绝点段。
- 所有输入只做一次规定的 percent decode；CSS escape 由 CSS parser 解码后再走同一策略，不重复 URL 解码。`%20` 可形成空格；`%2f`/`%5c`、混淆编码、协议相对 URL 不接受。不 lower-case 资源 key，不套 MDX stripKey。
- 查找顺序由 manifest 固定：选入且校验过的同名外置资源优先，其次唯一 MDD 资源。外置与内嵌相同摘要可去重，不同摘要提示版本差异；MDD 之间重复仍报歧义。严禁同名 basename 全局模糊匹配或网络兜底。
- 后台按 dictionaryId + packageVersion + canonicalPath 解析已激活 sources 内的实际 source/path，不接受 content 指定 OPFS 路径或 sourceId。resourceId 可由版本与规范路径确定，只作引用/一致性校验，hash 同样不是身份认证或访问权限凭据；权限来自 router 的 sender/owner 校验与后台当前安装状态。替换/卸载后旧版本请求返回 stale，不能把新包资源拼给旧词条。

#### 不能漏掉的 MIME/传输缺口

后台 `classifyMddResource` 目前只接受 CSS、PNG/JPEG/GIF/WebP、MP3/OGG/WAV；TTF 与 SVG 不是“改一下 viewer 即可”，后台分类和响应校验也要改。content 的 image MIME 正则同样不含 SVG，kind 不含 font。三层分类、transport、viewer 必须同批落地。

本轮维持 JSON/base64 传输以最小化改动，新增 font 的受限 MIME/签名校验及大小限额，静态 SVG 经安全编译后再使用；不给 JS MIME 开洞。单项8 MiB意味着 base64约10.67 MiB，还有解码字符串/Uint8Array/Blob拷贝，不能把32 MiB Blob cap称为进程总内存。1024条去重资源描述与2路活跃读取/32MiB Blob预算分离；526音频保持惰性，图片视口加载，字体按需，去重缓存按 packageVersion/path/kind，释放时引用计数或明确所有权。

当前 `compileLocalStylesheet(bytes)` 遇注释、@、反斜杠或url()返回空串；它只支持简单 tag/class selector，最多64条。Oxford10 CSS 61,996字节虽然低于64KiB，仍不能被当前编译器正确呈现。

源码：[路径规范化](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-resource-path.js#L10-L51) · [后台 lookupResource](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdd-resources.js#L209-L266) · [资产类型限制](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/importers/mdd-resource-policy.js#L14-L28) · [content 消息、Blob 与 CSS](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-resource-resolver.js#L165-L341)

### 5A.6 Viewer 与 actions 执行合同

当前 `selectionRichViewer.render(container,ast,fallbackText,{preserveNewlines,dictionaryId})` 用白名单重建DOM，最多8192节点、深度32、viewport max-height210px。`getShadowRoot` 实际使用 `attachShadow({mode:"open"})`，不能把词条 viewer 写成 closed。Shadow DOM 是样式封装手段，不是防恶意宿主页的安全边界；不论 open/closed，都必须依靠“不运行原脚本、不接受任意URL/事件”的策略。

**拟新增**固定 action union，由 AST 中不可执行的 actionId 引用；viewer 只注册扩展自己的 listener：

- `selectTab {groupId,optionId}`：只作用于当前 article 的 radio/label 关系；确需音标组同步时按已验证 adapter 映射同步，并更新键盘/ARIA状态。
- `navigateEntry {query,fragment?}`：同本词典的新请求、新requestId；保持旧视图直到新结果或明确错误，支持后退。短语原样传递，不截第一个词。
- `navigateFragment {targetId}`：先定位 article/所属词性、挂载长段落、激活目标tab，再滚动并移动焦点。不修改宿主页hash。
- `playAudio {resourceId}`：在用户手势下读取目标资源，准备后受控播放；自动播放被浏览器拒绝时显示播放控件。切词时暂停旧音频并失效未完成请求，不让旧响应开始播放。
- `toggleDisclosure / openPanel / closePanel`：固定实现已识别提示/unbox，Escape关闭、恢复触发点焦点。未知 onclick 或JS函数只诊断，不解释/执行。

渲染侧二次校验 node/resource/action schema、命名空间和预算；radio/name/id全部限定在当前article。紧凑卡片可保留，但必须有完整阅读入口；长词条可分区挂载，导航索引能定位尚未挂载的目标。结果过长、安全过滤、媒体缺失必须显示具体状态，不能成功徽章下静默回退成不完整纯文本。

源码：[viewer 签名与预算](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-viewer.js#L25-L116) · [真实 Shadow mode](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/content/selection/rich-viewer.js#L222-L226)

### 5A.7 共同 DTO 草案（全部为拟新增，不是现有接口）

下列名字是语义合同，实施时可合并到现有模块，不要求额外平台或通用插件系统。共享schema/validator/预算和合成fixture必须在T3/T4/T5动工前共同确认。

```ts
// 新增：安装状态持久化。sourceId/opfs内部路径仅后台使用。
type PackageSnapshotV1 = {
  schemaVersion: 1; dictionaryId: string; packageVersion: string;
  profile: { id: 'oxford10'; version: string; evidenceDigest: string } | null;
  status: 'ready' | 'resource-incomplete' | 'corrupt';
  mdx: { sourceVersion: string; indexVersion: string };
  // 文件级清单：两卷MDD各一项，外置文件各一项，不展开203285个资源key。
  sources: { sourceId: string; sourceKind: 'external' | 'mdd';
    sourceVersion: string; indexVersion?: string; fileSize: number;
    digest?: string }[];
  // 仅外置sidecar的小映射；MDD key继续依compact index按需定位。
  sidecars: { canonicalPath: string; sourceId: string;
    role: 'image'|'font'|'stylesheet'|'inert-script'; digest?: string }[];
};

// 新增：后台lookup边界，扩展当前一字典一richRecord结构；不直接发送AST。
type EntryBundleV1 = {
  schemaVersion: 1; requestId: string; dictionaryId: string;
  packageVersion: string; profileVersion: string | null;
  requestedKey: string; found: boolean; complete: boolean;
  articles: { articleId: string; matchedKeys: string[]; displayForm: string;
    span: { start: number; end: number }; aliasTrace: string[];
    rawRecord: string; format: 'HTML' | 'Text';
    styleSheetRules: { id: number; begin: string; end: string }[];
    virtualBasePath: string; safeTextFallback: string }[];
  diagnostics: { code: string; stage: string; articleId?: string }[];
};

// 新增：content内的compiler→viewer边界，原HTML不进入DOM。
type SafeArticleV1 = {
  schemaVersion: 1; dictionaryId: string; packageVersion: string;
  articleId: string; scopeId: string;
  nodes: SafeNode[]; // 实施时定义封闭tag/attr/style/node union与validator
  styles: { cssText: string; dependencies: string[];
    assetSlots: { start: number; end: number; resourceId: string }[] }[]; // 仅经过策略的CSS
  resourceRefs: { resourceId: string; kind: 'image'|'audio'|'font'|'stylesheet';
    canonicalPath: string; load: 'visible'|'gesture'|'required' }[];
  actions: SafeAction[]; // 仅第5A.6节固定union，绝不带脚本文本
  anchors: { targetId: string; sectionId: string; tabId?: string }[];
  diagnostics: { code: string; stage: string }[];
  complete: boolean;
};

// 新增字段扩展现有RICH_MDD_RESOURCE通道，或用版本化继任消息。
type AssetRequestV1 = {
  schemaVersion: 1; requestId: string; ownerToken: string;
  dictionaryId: string; packageVersion: string;
  resourceId: string; canonicalPath: string; // 只允许词典虚拟路径
};
type AssetResultV1 = {
  schemaVersion: 1; requestId: string; packageVersion: string;
  resourceId: string; found: boolean;
  mime?: string; kind?: string; size?: number; base64?: string;
  width?: number; height?: number; errorCode?: string;
};
```

必须约束：packageVersion钉住整次读取，articleId由包版本与record span确定，不由displayForm单独决定；resourceId可由packageVersion与canonicalPath确定，不能当作访问凭据；后台重新规范化canonicalPath并只在激活的文件级sources中查找。MDD资源沿用compact index按需定位，不把20万条资源展开进常驻manifest；content不能发任意系统路径/sourceId。响应必须匹配requestId/版本/资源；失配直接丢弃。所有DTO只携带必要数据，diagnostics不写商业正文。需要分页多articles时另冻结 continuation/complete 语义，不能悄悄截断数组。代码实现前把 SafeNode/SafeAction 的封闭union补齐到共同schema，以上草案本身不算接口已冻结。

#### 已激活包快照的版本分配

packageVersion 标识当前可读的组合快照，不能只复用 MDX 的文件版本。MDX、任一 MDD、sidecar、索引规范化语义或 profile 的已激活身份发生变化，都生成新的 packageVersion；即使 MDX 字节未变，附件成功替换也必须推进它。暂存、复制、校验、取消或失败不替换当前 packageVersion。沿用现有 MDX 已安装、附件可重试的产品状态：每次成功激活一个新的可读组合快照时统一更新版本，不要求重做全包原子事务。

查询、CSS 编译、资源读取和 viewer 会话共同固定该版本。版本切换后失效旧响应、动作和资源引用；旧文件的回收遵循已有事务与读取生命周期，不允许仅因开始导入就提前删除当前健康资源。T2 负责查询/索引合同，T5 负责激活点，T3/T4 只消费同一身份。可复验标准：保持 MDX 不变，仅替换附件，旧版本请求必须被拒绝或标为 stale；替换失败/取消时旧快照仍可查询和读取资源。此项仍为设计合同，浏览器验证 NOT_RUN。

#### 与已合入Reading记录链的兼容（main 19edb542 / #234）

当前Rich结果已带实际MDX的`packVersion`，卡片主体已从result-renderer拆到[rich-result-renderer](https://github.com/CoderLambert/translateflow-plugin/blob/19edb5426381b4cfa9e0cec354541170abb2114d/src/content/selection/rich-result-renderer.js#L157-L234)，在实际安全显示后通过onDisplay给出`{id,headword,packVersion,text}`；有效rich-details会话再交给原queryRecord的readingRich。新EntryBundle/SafeArticle、多article和按需挂载必须保留“当前有效查询→实际安全显示→有界纯文本摘要”的回调语义，不能因替换viewer丢掉保存能力。

T1冻结转换器时，保留实际packId/MDX packVersion来源，并明确它与组合packageVersion的映射。组合版本会因MDD/sidecar/profile变化推进，不能直接重命名成Reading provenance的MDX版本。显示回调与持久摘要是单独的最小投影，Reading不保存rawRecord、样式、资源描述、Blob/文件路径或整份DTO；拿不到可靠摘要时保留不保存降级。Oxford完整显示预算与Reading现有最多8条、每条240字符的摘要预算分离，不扩大摘要来解决长词条显示。

内部entry/fragment跳转、折叠展开、媒体与资源刷新不得改写原冻结网页source，不隐式新建Reading查询或重复计数；内部导航得到的其它词条不能冒充原始划词结果补存。沿用当前`rich:${dictionary.id}`的每查询去重语义，多article如何合成一次可靠摘要须在现有预算内明确，不能每次懒挂载追加一份。

可复验标准：首次实际显示产生一次合法回调；重复回调/折叠展开不重复lookup计数；快切/关闭/导航后迟到结果不写；原始source不变；摘要携带真实MDX来源版本且无RAW/CSS/路径；附件版本切换与Reading provenance不串用。保留现有Reading合同验收，不新增学习中心或读取历史时的隐式词典/Provider调用。以上是Oxford适配要求，浏览器仍NOT_RUN。#235真实React学习中心已由[#285](https://github.com/CoderLambert/translateflow-plugin/pull/285)合入main `b606cfd556792d9764d0b15461b7a142fcd99575`；[当前学习中心合同](https://github.com/CoderLambert/translateflow-plugin/blob/b606cfd556792d9764d0b15461b7a142fcd99575/docs/LEARNING_CENTER_V1.md)规定历史页面只读取冻结快照及provenance，不重新调用词典或Provider。Oxford仍须保留实际显示后的有界摘要与MDX packVersion语义；#235的16项定向Chromium验证不等于Oxford实包或Release A #236通过。

依据：[后台MDX版本](https://github.com/CoderLambert/translateflow-plugin/blob/19edb5426381b4cfa9e0cec354541170abb2114d/src/background/packs/rich-mdict-lookup-controller.js#L59-L70)、[session守卫](https://github.com/CoderLambert/translateflow-plugin/blob/19edb5426381b4cfa9e0cec354541170abb2114d/src/content/selection/rich-details.js#L130-L132)、[原查询去重](https://github.com/CoderLambert/translateflow-plugin/blob/19edb5426381b4cfa9e0cec354541170abb2114d/src/content/selection/controller.js#L337-L341)、[有界Reading投影](https://github.com/CoderLambert/translateflow-plugin/blob/19edb5426381b4cfa9e0cec354541170abb2114d/src/content/selection/result-model.js#L225-L234)。

#### CSS 固定处理消息（拟新增）

沿用现有 router 的 content sender/owner 校验和取消生命周期，不建立独立运行平台。后台从已安装资源读取 CSS，content 不提交任意 CSS 程序或系统路径：

```ts
type CompileStylesRequestV1 = {
  type: 'RICH_LOCAL_STYLES_COMPILE'; schemaVersion: 1;
  requestId: string; ownerToken: string; dictionaryId: string;
  packageVersion: string; articleId: string;
  stylesheetPaths: string[]; // 去重规范虚拟路径，数目/总字节受预算限制
  scope: { scopeId: string; idMap: [string,string][]; nameMap: [string,string][] };
};
type CompileStylesResultV1 = {
  schemaVersion: 1; requestId: string; dictionaryId: string;
  packageVersion: string; articleId: string; scopeId: string;
  styles: { cssText: string; dependencies: string[];
    assetSlots: { start: number; end: number; resourceId: string }[] }[];
  resourceRefs: { resourceId: string; canonicalPath: string; kind: 'image'|'font' }[];
  complete: boolean; diagnostics: { code: string; stage: string }[];
};
```

后台验证scopeId字符集、映射数量/字节、键值唯一性与一对一关系，并自行生成selector语法，绝不把scopeId当原始CSS拼接；stylesheetPaths必须在当前dictionary/version内可解析，每个CSS的相对路径以自己的虚拟目录为base。内部资源依赖继续通过同一AssetRequestV1通道按需读取。返回的是已过白名单的CSS和规范路径依赖，不含可执行脚本或未经控制的URL；content还需核对响应身份、输出字节与依赖预算，只向对应article根装载。局部CSS无效返回diagnostics，预算/版本失败返回显式错误，不静默把空样式当完整成功。涉及SVG本地url(#ref)的重写必须使用同一idMap且限定本article；不得误判成MDD文件资源。


#### 样式依赖落到浏览器的最后一步

后台不能把原始 url(fonts/...) 原样返回后直接插入页面。CSS生成器把每个资源URL输出为明确的替换槽，assetSlots记录生成文本中的有界区间和resourceId；原始URL不得混入普通文本片段。content先用受控资源通道获取必需字体/背景资源，验证后生成自身可用的Blob URL，再按已验证的槽位组装样式；不可用资源对应规则不激活并显示缺失诊断。所有槽位需有序、不重叠、位于对应CSS输出边界内且资源身份一致，不能用不受控正则替换任意CSS。只有完成本地URL绑定的样式才可挂入词条根，不将未解析路径交给浏览器自动请求。样式生命周期持有依赖引用，关闭或换包后释放。是否允许Blob字体/图像、默认包与WXT的实际CSP兼容必须以真实安装产物验证，不能靠开发页成功替代。

#### 已有索引的兼容迁移

Stripkey属性修正会改变部分词典的规范化语义，不能用新查询规则直接读取按旧规则产生的min/max索引。实现需要给索引格式或规范化策略绑定版本，检测不兼容时从已经保存在OPFS的原文件重建受影响索引；新索引验证成功才激活，失败保留原文件并提供明确恢复状态。无需清空所有词典或迁移无关数据库。原本正确读取StripKey的词典若索引语义未变应复用；旧会话在版本切换时失效，原始文件缺失时明确要求重新导入。该迁移及其回归属于T2共同合同，不能留到发布后由用户偶然发现。


### 5A.8 现有模块 → 拟变更与验收所有权

| 现有模块 | 必要变化 | 集成验收责任 |
|---|---|---|
| local-dictionary-import-ui / preflight-mdx / controllers / workers | 六文件manifest、明确部分安装、外置资源持久化、恢复入口 | T5，integration owner验证重启后可用 |
| rich-mdict / rich-mdd-resources / OPFS store | 保留compact index与范围IO；版本钉住、附件激活/旧版保留、资源定位 | T5与T2共同确认 |
| mdict-rich-metadata/index/lookup | header实际拼写、同键多span、逐路径alias与边界、统一预算 | T2加T1夹具；T3消费同一EntryBundle |
| rich-mdict-lookup-controller / packs/api / router | 新版本化结果、完整性标识、无静默clamp、版本验证、owner/cancel | integration owner负责两端同步 |
| rich-sanitizer/tokenizer/style | content安全结构/ID关系/资源与action抽取；CSS AST交后台固定入口 | T3；与T4共验radio和导航 |
| rich-resource-path/resolver + MDD policy + 后台固定styles入口 | 虚拟base解析、后台CSS AST白名单、字体/SVG策略、去重懒加载、消息限制 | T3与T5共同负责同一资源key |
| rich-viewer / rich-result-renderer / result-renderer / rich-details | 多article、完整阅读、固定adapter、历史/焦点/过期结果 | T4；直接使用T3共同SafeArticle |

不新增通用JavaScript运行时，不放宽CSP/权限，不整体更换MDX reader，不把所有阈值一律取消。

### 5A.9 最终交付门：必须提供可安装产物和真实操作证据

交付必须绑定同一个 commit：可安装扩展构建产物、构建命令/版本、实际测试报告、已知缺口，另有用户真实六文件包的操作演示（商业内容仅私有保存/展示，不提交公开仓库）。顺序如下：

1. 干净安装构建产物 → 选择1,533,010,812字节六文件组 → 全包ready；日志能解释复制/校验阶段而不是虚构百分比。
2. 网页真实选择arch → 现有查询入口 → Oxford10卡 → 完整阅读 → 词性/音标/插图/发音/entry与fragment/返回，录屏连续呈现同一条链。
3. go → 确认末尾/全部词性可达 → 点击远端例句发音；记录实际AST数量、读取字节、活跃Blob、音频请求数，不能预取526音频。
4. 切词/关闭/导航中取消，旧音频不播、旧DOM不覆盖、Blob回收；资源变更/卸载后旧版本失效。
5. 重启浏览器/扩展 → 不重新选文件再走arch/go；中断附件导入、配额失败、损坏资源后可恢复或准确要求重选，旧附件仍可读。
6. 合成边界夹具验证多records、同offset、跨block、别名环/分支、大小写/Stripkey、CSS路径与恶意输入；真实包和安全回归同时通过。

本次上述全部浏览器项目为 NOT_RUN。4GB数值边界fixture通过只证明数值处理，不证明真实4GB性能；arch局部截图、parser单测、导入元数据、构建成功均不能单独替代整包兼容的完成判定。


## 6 实施顺序与停止条件

实施先验证真实词条的布局和交互，然后验证完整包导入与生命周期。小样只用于尽早证明渲染路线，不能替代用户这份约 1.533 GB 的完整词典验收。以下均为额度重置后的计划，尚未执行。

| 阶段 | 最小交付 | 通过后再继续的条件 |
| --- | --- | --- |
| 1 | 冻结实际包与欧路参照；完整获取后记录文件摘要；审计容量、逻辑流与长记录预算；定义路径冲突策略 | 实际包版本可复现；区分容量、逻辑解压总量、单块和缓存预算；不再混用旧 OALDPE 的结论 |
| 2 | 以 arch 和少量复杂词条完成原 DOM、CSS、字体、图片、发音与有限适配器的小范围实现 | 词性、弹层、片段导航和资源对照成立；安全边界未改变。否则先定位损失，再决定是否做隔离 iframe 验证 |
| 3 | 贯通完整包导入、OPFS 持久化、分卷与外置资源、配额检查、进度和取消 | 完整实包可导入、重启后可查询；附件失败可重试，界面准确显示未完成资源；原有词典不回归 |
| 4 | 覆盖复杂词条、冷启动、快切词、资源清理与安全测试 | 第7节矩阵全部有可复核证据；记录实际时间、读取量和内存，再订性能回归基线 |
| 5 | 独立验证 4 GB 容量合同与高位偏移边界 | 分别提交边界 fixture 和真实大包浏览器证据。1.533 GB 通过只证明该包通过 |

### 保留事务语义并暴露真实进度

沿用 MDX 已安装、附件可重试，以及失败保留旧资源的语义，无需为本次兼容重做全包原子事务。MDD 当前提交阶段会再次建索引并遍历解压记录块；它不是全文件驻内存，但在大包上可能耗时，必须测取消响应、后台生命周期与重启恢复。诊断应区分预检、复制、校验、索引和资源未完成状态。 配额预检应计算新增暂存文件、索引开销及更新期新旧版本共存，而非只检查总配额是否达到4GB；storage estimate 不是写入成功保证。

### 容量合同和独立修复

建议将 4 GB 明确定义为全部源文件合计不超过 4,000,000,000 字节，统一界面、worker、后台提交和恢复校验。保留单块、单资源、解压比和驻留索引保护；源文件小于4GB不保证累计decoded也小于4GB。配额失败、取消和重启后的暂存清理复用现有生命周期，实际OPFS复制取消另行验证。

8aceb7c 的 parser 边界配对与预检诊断修复保持独立。该分支已推送并通过独立审查，但尚无 PR，也未合入 main；不能写成本方案已落地，或把容量和渲染升级塞进该修复。[独立提交](https://github.com/CoderLambert/translateflow-plugin/commit/8aceb7cda907eeecd1ebc756c46682342d046182)

## 7 实包验收矩阵

当前所有浏览器验收项均待实施后验证。以同一份完整 Oxford10、同一组词条和固定欧路参照检查；保存浏览器与扩展版本、包清单摘要、操作记录、截图和诊断。公开报告不附词典全文或整包内容。

| 范围 | 通过标准 | 证据 |
| --- | --- | --- |
| 完整导入 | 六文件关联正确；两卷 MDD 与外置资源均可定位；同名冲突可解释；重启后保持 | manifest 与导入/重启记录 |
| arch 与 go | arch 多词性、字体、SVG、插图可用；go 的长词条无静默截断，末尾和各词性可达 | 欧路对应截图 / 长词末尾与AST检查 |
| 有限交互 | radio 与 label 切换；音标组同步；提示、unbox、返回与 Escape；键盘和焦点状态一致 | 交互录屏与自动化断言 |
| 导航语义 | entry://arched、archly、同词与跨词片段可达；先激活所属词性；短语目标不截断 | 查询和片段导航用例 |
| 发音 | 实际单词与例句 sound:// 资源可播；确认英美按钮和 MIME；快切词不会播放旧词 | 音频请求与手势播放记录 |
| 资源边界 | 基础卷图片、字体和音频卷均命中；%20和反斜杠路径正确；区分标签次数与独立资源，526音频不预载 | 资源来源/字节日志 |
| 索引边界 | 首末 key block 条目、重复键、同 offset 别名、跨 record block 与重定向环行为正确 | 实包用例加边界 fixture |
| 生命周期 | 导入可取消和重试；配额失败可解释；快速查询取消；删除与替换后资源可回收 | 阶段进度及存储前后对照 |
| 安全 | 导入 JS、事件属性与外部 URL 不执行；CSS/SVG 恶意输入被拒绝；CSP 与权限不扩大 | 负向 fixture 与网络记录 |
| 性能回归 | 冷导入、冷重启、冷热查词、长词条与连续切换有实测；缓存和URL不持续增长 | 时间 读取量 内存/存储曲线 |
| 4 GB 独立项 | 4,000,000,000 接受、4,000,000,001 拒绝；高位偏移及真实大包性能单独验证 | 数值边界与浏览器证据分列 |

**完成定义**：完整实包、代表性复杂词条与安全回归同时通过，才可称为这份 Oxford10 已兼容。只渲染 arch、只读到元数据、只提高大小阈值或只通过合成边界测试，都不能替代完整包的浏览器验收。

## 8 实施任务拆分

各任务独立提交，先有测试再扩大范围。最终以真实整包验收收口，不以若干局部单测替代完成标准。

### T1 固定包身份和兼容性基线

- 输入：用户合法持有的六文件原包、欧路可观察行为、本文静态统计。首次完整获取后补齐 MDX/MDD 整文件摘要；现有范围读取不等于完整文件哈希已验证。
- 输出：不含商业内容的 manifest schema、Oxford10 profile 识别规则、私有验收清单和元数据测试 fixture；商业词典与提取正文不提交仓库。
- 至少覆盖 arch、go、come、get，以及首末 key block、重复键、同 offset aliases、跨 record block、整短语重定向与环。
- 已检查的 CSS/JS SHA-256 如下。外置 JS 仅定义本 profile 的预期行为版本，绝不执行。

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| 外置与内嵌 CSS | 61,996 | `5c7aa91257d09fec7801f1daa8ed33962960633e14ff3048883d55afafd06ae1` |
| 外置 JS | 14,852 | `c04e2fc513f458e1fc37f984fbaaf4b4fb46c657d5a4de1b89b89654153dffae` |
| 内嵌 JS | 10,551 | `f8d85a41b013b77b2af6df10c9bd9011532d8293e41021b66b2ae853eb9729a2` |

### T2 统一容量和记录预算

- 涉及 `src/background/packs/local-dictionary-preflight-contract.js`、`rich-mdict-contract.js`、`rich-mdd-contract.js`、`mdict-contract.js`、`mdict-rich-lookup.js`、`importers/mdd-validation.js`，以及 `src/background/packs/rich-mdict-lookup-controller.js` 中 rawRecord 消息与 sanitizer/viewer 的对应校验。
- 将源文件容量、逻辑地址空间、验证总工作量、原始记录、展开文本、节点、索引缓存和活跃媒体预算拆开命名；复用已有安全整数和区间检查。
- 移除“累计逻辑 decoded 长度等于内存占用”的假设；遍历全块的验证路径仍统计实际工作、保持块校验与中止点。
- 使用第3节候选值贯通各层，并保留现有驻留索引、单块、解压比限制。先测真实索引占用，再决定是否需要额外调整。
- 测试：精确上限与上限加一、溢出/非单调/越界元数据、go/come/get 记录、跨块拼接、取消与错误阶段。已有安全整数检查不是新发现的32位bug。

### T3 保留真实 DOM CSS 和资源映射

- 涉及 `src/content/selection/rich-sanitizer-tokenizer.js`、`rich-sanitizer-style.js`、`rich-sanitizer.js`、`rich-resource-resolver.js`、`rich-viewer.js`。
- 加入构建期打包的固定版本 css-tree；以 AST 白名单处理 selector/property/value，不继续扩写整份拒绝的正则。记录 bundle 变化和依赖许可。
- radio、label、details/summary、静态 SVG 和所需结构标签通过受控 AST 重建；所有 CSS/SVG/HTML 资源 URL 走同一解析器。
- 将资源描述数量与活跃加载预算分开。字体与可见图片按需加载，音频在点击时解析，不批量预载全部引用。
- 测试：注释、@font-face、媒体规则、:checked兄弟选择器、伪元素、URL转义、反斜杠/空格、ID关联、同根冲突、不安全规则局部拒绝及诊断。
- 先让 arch 原貌和资源可对照，再验 go 无静默截断；小样用到的词典内容保持本地。

### T4 受控交互和可展开阅读

- 在现有 viewer/resource 链中加入固定 Oxford10 adapter，按 profile 身份启用；无需引入通用插件执行系统。
- 实现 entry/sound/fragment 动作、词性组同步、提示与 unbox、键盘/Escape/焦点状态，以及活动词条与长段落按需挂载。
- 测试：跨词片段先切目标词性、深链接打开正确内容、多词条 radio 状态、快切词过期响应、音频手势和 URL 回收。
- 保持不执行词典 JS、不保留 inline handlers、不新增权限和不放宽 CSP。只有已有路径经实测存在不可消除的具体布局阻塞，才独立做 iframe 技术验证。

### T5 完整资源包导入和恢复

- 涉及 `src/background/packs/local-dictionary-preflight-mdx.js`、`rich-mdict-install-preflight.js`、`rich-mdd-resources.js`、`opfs-store.js`；`src/options/local-dictionary-import-ui.js`、`rich-mdict-import-controller.js`、`mdd-resource-import-controller.js`；`src/options/workers/rich-mdict-import-worker-core.js` 与 `mdd-resource-import-worker-core.js`。同组省略目录的文件均沿用该组首项路径。
- 统一 MDX、多 MDD、外置 CSS/图像的 manifest 与持久化。JS 识别和诊断，不执行。外置覆盖内嵌资源必须有固定优先级和差异提示；保持现有 MDD 重复路径检测。
- 贯通各层容量策略，提供真实复制/验证/索引进度；复用 MDX 已安装和附件可重试语义。
- 配额检查覆盖新增暂存、索引与新旧共存；写入仍可能失败，须准确报错并可清理或恢复。
- 测试：完整1,533,010,812字节实包、扩展重启、两卷各自命中、资源未完成提示、取消/重试/配额失败、旧资源保留、OPFS复制取消。

### T6 全流程回归和容量边界

- 完成第7节矩阵，保存浏览器/扩展版本、脱敏manifest、截图与性能诊断；状态逐项由 `NOT_RUN` 转为 PASS 或 FAIL，并附证据。
- 先得到本实包的冷导入、冷重启、冷热查询、go 首次展示与连续查询指标，再为后续回归设阈值。
- 4,000,000,000字节边界、高位偏移与更大累计decoded用合成fixture测数值；真实4GB包的端到端时间/内存必须另外实测，不把fixture通过写成产品4GB已支持。

### 复用现有测试入口

以下文件与命令已在当前仓库确认，本次均未运行。实现时按变更补充用例，并记录实际结果。

**浏览器验收产物选择（2026-10-03 增量复核，main `d5246cae6469e4a876fc122b229a2e0ddf115709` / #284）：** 默认生产构建已切换为WXT。`npm run build:extension`和`npm run build:extension:release`使用同一WXT构建与审计链，保持`dist/extension`为稳定安装目录；`npm run build:extension:wxt`使用同一引擎输出`.output/chrome-mv3`。`npm run test:e2e`与`npm run test:e2e:rich-mdict`默认仍选择`.output/chrome-mv3`，运行前须由待测commit执行`npm run build:extension:wxt`；测试稳定安装目录时先执行`npm run build:extension`，再显式设置`TF_E2E_ARTIFACT=dist/extension`。`npm run validate`现在包含默认WXT构建，但只生成`dist/extension`，不能据此认定E2E默认目录已更新。fixture只复制已选择的生产产物，不自行构建或回退。

每次浏览器运行记录实际构建commit，并将`TF_E2E_ARTIFACT_SOURCE_HEAD`设为该commit；此字段是调用者声明，仍须关联实际构建记录和产物摘要。保留`[E2E_PRODUCTION_ARTIFACT]`中的artifact、sourceHead、treeSha256与testChanges，区分原产物和测试副本，避免消费旧目录。需要严格生成词典门槛时调用`build:extension:release`或显式`--require-lexicon`，不要仅依赖继承的环境变量。

当前MDict/MDD/取消专项Actions仍为`workflow_dispatch`手动备用，显式构建并消费`dist/extension`，其当前生产引擎已是WXT。历史legacy、WXT与当前构建的通过记录分别绑定原commit、产物及用例；默认切换不提供Oxford10六文件包的通过证据，全部Oxford浏览器验收仍NOT_RUN。构建target=chrome102不等于最低浏览器实测。

**执行与证据来源（2026-10-03 增量复核，main `d5246cae6469e4a876fc122b229a2e0ddf115709`，#280本地流程及#283取消强制模型审核）：** 仓库执行流程以 [docs/tasks/LOCAL_WORKFLOW.md](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/docs/tasks/LOCAL_WORKFLOW.md) 为准；进入经明确授权的实施阶段后，任务合同、状态和验收使用本地任务文件；验收后由主Agent对照准确候选和实际diff自查，不自动启动第二轮模型审核，自查不称独立审核，Issue仅保留历史引用，不作为日常执行状态来源。11个Actions均为手动备用，没有自动运行不代表验收失败或通过；未运行的必需检查仍记NOT RUN，失败记FAIL，实际分支保护要求远端检查而尚未满足时仍为BLOCKED，不得绕过。

验收与主Agent自查记录须绑定准确candidateHead；实际外部必需审查、分支保护和人工验收仍保留。真实安装包及构建记录、浏览器产物来源和第7节逐项实包证据仍须保留。本地gate通过不替代Oxford10整包、交互、性能、安全与人工验收。local-task产物fingerprint与E2E的treeSha256串行化不同，分别保留来源与版本，不要求两个摘要直接相等或互相替代。本次仅更新方案，不创建Oxford本地任务或启动实施，全部Oxford浏览器验收继续NOT_RUN；私有词典和原始证据保持本地，公开只留脱敏摘要，隐私、CSP、权限与产品门槛不变。参见[当前贡献流程](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/CONTRIBUTING.md)、[本地gate实现](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/local-task.mjs)。

依据：[当前构建命令](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/package.json)、[WXT构建wrapper](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/build-extension.mjs)、[E2E默认入口](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/scripts/run-e2e.mjs)、[产物复制与身份](https://github.com/CoderLambert/translateflow-plugin/blob/d5246cae6469e4a876fc122b229a2e0ddf115709/e2e/support/production-artifact.mjs)。

- 单元/集成：`tests/rich-mdict-storage.test.mjs`、`tests/rich-mdict-format.test.mjs`、`tests/rich-mdict-product.test.mjs`、`tests/rich-mdict-security.test.mjs`、`tests/rich-viewer-contract.test.mjs`、`tests/rich-resource-resolver.test.mjs`、`tests/rich-dictionary-sanitizer.test.mjs`、`tests/mdd-format.test.mjs`、`tests/mdd-security.test.mjs`、`tests/local-dictionary-preflight.test.mjs`。
- 浏览器：`e2e/rich-mdict-product.spec.mjs`、`e2e/rich-mdict-real-corpus.spec.mjs`、`e2e/mdd-resources.spec.mjs`、`e2e/rich-viewer-security.spec.mjs`、`e2e/local-dictionary-import-v2-product.spec.mjs`。
- 仓库现成命令：`npm run validate`、`npm run test:rich-mdict-security`、`npm run test:rich-lookup-cancellation`、`npm run test:e2e:rich-mdict`、`npm run build:extension:wxt`、`npm run test:wxt:smoke`。
- 私有实包fixture使用本地输入，公开仓库只保留合法可分发的合成边界fixture、测试配置和脱敏结果。

### 依赖顺序

- T1 → T2。
- T1 + T2 → T3 与 T5，和对应 Issue #271、#273 的依赖一致。T3 的源码阅读或样式样本分析可以提前进行，但消费共同 EntryBundle/预算合同的实现不得越过 T2。
- T3 → T4；T2 + T3 + T4 先完成 arch 纵向切片，T5 完整包验证后，T4 交互也必须在完整包下复验。
- T2 + T3 + T4 + T5 → T6。
- 现有独立 parser 修复 `8aceb7c` 单独审查和合入；本方案基于更新后的 main 开发，不把范围混在同一修复中。

## 9 明确不做的范围

- 不在额度重置前实现代码。
- 不替换整套MDX reader，不做Qt/WASM移植，不新增通用词典编译平台。
- 不执行导入JavaScript，不开发任意脚本双模式，不放宽CSP或扩展权限。
- 不复制欧路应用外壳，不承诺任意MDX/任意脚本兼容。
- 不以提高全部上限换兼容，不取消内存/索引/单块保护，不新增与证据无关的缓存或worker框架。
- 不发布商业词典文件、链接、提取正文、媒体内容或未经授权的完整fixture。
- 不复活已关闭的宏大生态项目；本次只作为Oxford10交付范围的小型epic与上述分任务。
