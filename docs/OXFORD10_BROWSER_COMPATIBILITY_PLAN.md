# TranslateFlow Oxford10 兼容性设计

日期：2026-10-02

> 状态：设计方案。实际 Oxford10 元数据与当前源码已做只读检查；浏览器导入、展示、交互、性能及安全验收全部为 `NOT_RUN`。本次不实施代码，待额度重置后再开始。

> 公开范围：仅包含结构元数据、词条标识、摘要和开源源码链接；不提供词典下载地址、原始 HTML、释义、例句或媒体内容。

## 1 结论与实际验收对象

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

以下代码结论固定在 main 的 d5e308a709c008acf6b277d466d020f13025bdca。现有链路已经用 File.slice 和 OPFS 范围读取，查询时定位相关块，并通过受控 AST 在闭合 Shadow DOM 内重建词条。应保留块校验、取消、资源并发限制、Blob URL 释放和附件替换失败保留旧版等能力。

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

[正文与索引合同](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/rich-mdict-contract.js#L16-L20) [安全偏移和跨块读取](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/packs/mdict-rich-lookup.js#L270-L325)

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

- 单元/集成：`tests/rich-mdict-storage.test.mjs`、`tests/rich-mdict-format.test.mjs`、`tests/rich-mdict-product.test.mjs`、`tests/rich-mdict-security.test.mjs`、`tests/rich-viewer-contract.test.mjs`、`tests/rich-resource-resolver.test.mjs`、`tests/rich-dictionary-sanitizer.test.mjs`、`tests/mdd-format.test.mjs`、`tests/mdd-security.test.mjs`、`tests/local-dictionary-preflight.test.mjs`。
- 浏览器：`e2e/rich-mdict-product.spec.mjs`、`e2e/rich-mdict-real-corpus.spec.mjs`、`e2e/mdd-resources.spec.mjs`、`e2e/rich-viewer-security.spec.mjs`、`e2e/local-dictionary-import-v2-product.spec.mjs`。
- 仓库现成命令：`npm run validate`、`npm run test:rich-mdict-security`、`npm run test:rich-lookup-cancellation`、`npm run test:e2e:rich-mdict`、`npm run build:extension:wxt`、`npm run test:wxt:smoke`。
- 私有实包fixture使用本地输入，公开仓库只保留合法可分发的合成边界fixture、测试配置和脱敏结果。

### 依赖顺序

- T1 → T2 与 T3。
- T3 → T4；T2 + T3 + T4 先完成真实词条小范围验证。
- T1 + T2 → T5；T5 完整包验证后，T4 交互也必须在完整包下复验。
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
