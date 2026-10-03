# 本地 MDX/MDD：从导入到安全展示

导航：[阅读入口](../README.md) · [架构总览](../architecture.md) · [仓库地图](../repository-map.md) · [15 个文件详解](../modules/dictionary-import-render.md) · [前篇：划词与词典查询](selection-and-dictionary.md)

> 源码基线：main `d5e308a709c008acf6b277d466d020f13025bdca`，复核日期 2026-10-02。源码与测试静态走读；项目运行、构建、浏览器、真实词典与测试执行均 **NOT_RUN**。本文描述该 commit 的实际能力，不包含后续 Oxford10 开发方案，不将格式解析成功等同于完整产品兼容。


> 2026-10-03 增量说明：本章运行时固定源码在main 86ed596中的blob未变。共享浏览器测试基础设施已切为复制预构建的明确产物，不再隐式构建；默认构建与默认本地E2E选择不同，实际运行请先读[构建与测试链](build-test-release.md)。旧测试链接只说明固定版本断言，不作为当前产物PASS；本轮运行NOT_RUN。

## 用户现在走哪条入口

Options 的“本地词典”统一选择器支持一次选择 MDX 与同名 MDD/编号 MDD，先展示本机兼容性报告、文件关联和需要确认的限制，再允许安装。当前 HTML 没有旧 richMdictFile 控件；rich-mdict-import-ui.js 在这里负责已安装富文本列表、偏好、附件添加/替换和删除。两种 UI 都复用既有控制器，不能把旧单文件头部预览说成当前统一 preflight。

最终结果有两条不同的数据路径：
- 结构化词典进入本地主卡候选；严格纯文本 MDX 只有用户确认英→简中含义、格式条件也通过时才走该导入器。
- 默认富文本 MDX 保留原始源文件及紧凑索引，在划词主结果旁作为独立词典详情展示。MDD 提供有界本地图片、按需音频和受限 CSS；不会执行词典 JavaScript，也不会自动加载词典内远程资源。

入口与 DOM 证据见[Options 局部边界](../modules/dictionary-import-render.md#partial-options)。

## 1. 选文件后：本机检查，而不是安装

[local-dictionary-import-ui.js](../modules/dictionary-import-render.md#file-local-ui) 持有 selectedFiles、report、AbortController 和检查序号。重新选择会中止旧检查并清旧确认；异步结果还需匹配当前序号，避免较慢的前一组文件盖掉新组。检查直接在 Options 上下文调用 [preflightLocalDictionaryFiles](../modules/dictionary-import-render.md#file-preflight)，不是已经启动导入 Worker。

[contract](../modules/dictionary-import-render.md#file-preflight-contract) 限定 1–32 个命名 File/Blob、文件组总计 640 MiB、重复名规范化及报告结构。报告分为：
- identity：格式 family、显示标题、文件大小及有限身份提示
- compatibility：supported / partial / unsupported / invalid，能力、原因和警告
- route：要调用的 importer
- resources：关联 MDD、无关文件、缺失提示
- estimates：源大小；当前 expectedLocalBytes 为 null

[MDX 分支](../modules/dictionary-import-render.md#file-preflight-mdx) 要求恰好一本 MDX，并按 basename 匹配 base .mdd + .1.mdd、.2.mdd…连续附件。无关文件不静默附加；缺 base、重复/跳号拒绝。它读取头部、key blocks、record descriptors 建紧凑索引，也检查已关联 MDD 索引；不会在这里展开全部正文和媒体。格式 unsupported 与损坏 invalid 有不同原因。

默认 route 是 rich-mdict。structured-mdict 还要求：用户明确确认语义、en→zh-cn、Text、未加密、无 StyleSheet/Compact/Compat、无已关联 MDD。语言不符、样式或附件存在不会因用户勾选就被忽略。

[身份抽样](../modules/dictionary-import-render.md#file-preflight-identity) 只哈希有界字节与范围描述，明确 unverified，不是全文件哈希。重复候选的名称/声明提示也不是强身份：普通 MDX 经确认是另存一份独立词典，不覆盖原本。

UI 的 import enabled 还检查 partial 确认、语义确认、重复确认、关联完整性、已安装状态查询成功等。故 partial 报告有 importer 也可能仍禁止安装，不能把 supported/partial 标签当可直接跳过安装校验的授权。

## 2. 点击安装：MDX 预留 → Worker 暂存 → 后台激活

顺序如下；各阶段结果的意义不同：

1. [MDX controller](../modules/dictionary-import-render.md#file-mdx-controller) 验证 File（正大小、.mdx、≤128 MiB），生成 UUID packId 和新 import version；单实例只允许一个任务。
2. 发 RICH_MDICT_IMPORT_PREFLIGHT。[后台配额预留](../modules/dictionary-import-render.md#file-install-preflight) 检查大小，可用估算时要求剩余空间≥源大小+32 MiB；按包串行核对版本/预留/替换目标，将 reservations[requestId] 写入本地状态。
3. controller 创建静态扩展 URL 指向的 module Worker，START 传 File 与身份。文件本体不走 runtime 消息，也不上传 Provider。
4. [MDX worker core](../modules/dictionary-import-render.md#file-mdx-worker) 通过 File.slice 有界读取建立 index，索引 JSON≤8 MiB并计算 SHA-256；写 source.mdx/index.json 到独立 OPFS 版本，核对保存大小，回 READY。
5. controller 终止 Worker，发 RICH_MDICT_IMPORT_COMMIT。[后台 manager](../modules/dictionary-import-render.md#partial-storage) 不信任 READY：复查预留、大小、索引摘要与 metadata，从 OPFS 原始范围重新 build index，严格比较重建与暂存描述符。
6. 全部通过才进入 commitpoint；状态更新再次核对目标和预留，再写 healthy/active snapshot，删除预留，返回 installed。Options 刷新列表及偏好。

READY 仅表示 Worker 暂存完成。索引重建验证的是源与索引一致性，不代表每条词典正文、复杂样式和全部媒体都已能正确显示。更深的 parser/字节算法仍为[局部解释](../modules/dictionary-import-render.md#partial-parser)。

## 3. MDD 附件：是第二次提交，失败不撤销已安装 MDX

统一 UI 取得 MDX commit 返回的 dictionaryId 后，才调用 [MDD controller](../modules/dictionary-import-render.md#file-mdd-controller)。已安装列表的“添加/替换 MDD 资源”也走同一链：

1. 校验与已安装 MDX 同名的 base+连续编号；最多16个，单文件≤128 MiB、总源≤512 MiB。
2. RICH_MDD_RESOURCE_PREFLIGHT 核对 installed MDX、文件名、配额和无冲突资源预留，创建独立 resourceVersion。
3. [MDD worker](../modules/dictionary-import-render.md#file-mdd-worker) 按序 build/validate index，单索引≤16 MiB、总索引≤32 MiB；固定编号槽位保存 source/index，重读大小，回 metadata。
4. [MDD manager](../modules/dictionary-import-render.md#partial-mdd-manager) 再核验摘要、重建索引并逐个验证所有 staged record blocks。最后一次 state update 确认 MDX 版本未变，把 active.resources 一次替换成新资源集合。
5. 成功后才尽力清旧附件版本，并通知页面现有 viewer 关闭该词典资源 session。

MDX 与 MDD **不是一个跨两组文件的原子事务**。原子边界是“整组新 MDD 指针替换旧 MDD 指针”。初次附加失败/取消时，MDX 已可查询文本，旧附件（如果有）不变；UI 显示具体状态并提供“重试添加 MDD”，重试不重复导入 MDX。不能把这一结果写成“词典从未安装”。

## 4. 从 active 数据回到划词 rawRecord

选择文本、点击查询、主卡本地优先、富文本列表与逐本懒加载已经在[前篇功能链](selection-and-dictionary.md)解释；本章接续它的 rawRecord 边界，不重写查词算法。

rich-details 对每本词典发送 RICH_MDICT_LOOKUP，后台单词典 lookup 绑定 requestId 与 Content ownerKey。source/index 从已激活版本读，索引缓存可失效后重新加载；真实 record 依需求范围读取/解压，返回 rawRecord、format、StyleSheet 规则及有界纯文本 fallback。

这里仍是“不可信词典数据”。后台没有把原 HTML 宣布成 safe HTML，词典事实也不经 AI 改写成权威内容。主结果和富文本详情分别处理错误；选择变更/关闭后的响应由原 session/task 版本检查丢弃。详见[已解释 lookup controller](../modules/selection.md#file-rich-lookup-controller)和[rich-details](../modules/selection.md#file-rich-details)。

## 5. rawRecord → AST → Shadow DOM：安全预览的真实能力

[result-renderer 的既有接口](../modules/selection.md#file-result-renderer) 调用 [sanitizer](../modules/dictionary-import-render.md#file-sanitizer)：
- rawRecord 与 Compact 展开各≤512 KiB；最多8192节点、32深度、8资源引用。
- Text 记录按字面显示；HTML 中合法 Compact marker 先用本词典规则包裹，再经过同一个 tokenizer，不直接插入规则 HTML。
- [tokenizer](../modules/dictionary-import-render.md#partial-tokenizer) 只产生有限元素/文本/resource AST，丢危险子树、事件/导航等；不使用浏览器 HTML parser，也不执行脚本。无效/超限退为有界纯文本。
- [style 清洗](../modules/dictionary-import-render.md#file-sanitizer-style) 只留下允许的颜色、排版、边框和间距值；拒绝 URL、表达式、@import、CSS变量/动态计算等，不承诺完整词典 CSS。

[viewer](../modules/dictionary-import-render.md#file-viewer) 再以 createElement/createTextNode 重建 AST，在扩展自有 open ShadowRoot 内展示。它有第二套标签/属性/样式限制和节点预算，字号独立 clamp，表格可横向滚动，内容区可聚焦且有高度边界。Shadow DOM 隔离样式，并不允许不可信脚本执行；安全来自多层白名单与数据构建。

图片/音频不是原始 src；先变占位/resource 描述，交下面的 resolver。缺少 ShadowRoot/sanitizer 能力或渲染失败由已有 renderer 走纯文本；不能为视觉接近原词典放宽 CSP。

## 6. MDD 资源：路径 → 后台字节 → Blob / 受限 CSS

[resource-path](../modules/dictionary-import-render.md#file-resource-path) 只接受规范化 MDD 相对键，拒绝协议、远程/双斜线、盘符、目录穿越、控制字符、双重编码与 query/fragment；保留大小写。前后端各自验证，不把网页当前 URL 作为资源 base。

[resolver](../modules/dictionary-import-render.md#file-resource-resolver) 每个 viewer 最多8引用，全局最多2并发：
- 图片与本地 stylesheet 在展开详情后读取；音频必须用户点加载按钮才读取，控件不自动播放。
- RICH_MDD_RESOURCE 携 dictionaryId/path/requestId/ownerToken，后台用 Chrome sender 构建 ownerKey；不是任意网络取资源接口。
- [MDD manager](../modules/dictionary-import-render.md#partial-mdd-manager) 跨 companions 共享读取预算，多个同键命中报歧义；取出二进制后检查格式/MIME/尺寸，仅返回有界 base64。
- 当前实际媒体分类是 PNG/JPEG/GIF/WebP 和 MP3/OGG/WAV；SVG/HTML/JS/不明媒体被拒绝。单资源≤8 MiB，图片有像素/边长限制。
- 前端再核 MIME/base64尺寸，Blob URL 累计≤32 MiB、图片像素累计≤16 Mi。失败保留占位。
- 外部本地 CSS≤64 KiB，用严格 UTF-8解析与有限声明重建；仅 tag、.class、tag.class，添加 .tf-rich-viewer 前缀。复杂选择器、@规则、注释/转义、URL等不支持；不是把 MDD CSS 原样塞入 style。

所有字节来自已安装本地资源，不自动网络加载。词典中的 entry链接、sound scheme、折叠脚本等超出这条有限 AST/资源语义的内容，不因 MDX 成功导入就自动获得原产品交互。

## 7. 取消、失败、替换与重启

### 不同阶段的取消

- 检查阶段：AbortController+检查序号使旧结果失效；尚未安装。
- Worker 阶段：CANCEL 触发内部 AbortSignal，range/索引检查点退出；Worker/controller 尽力清对应 staging。页面关闭 dispose 拒绝待完成任务并终止 Worker。
- 后台 verify：受理取消才返回 cancelled=true，未发布 active 的暂存随后清理。
- commitpoint：返回 cancelled=false；Options 明示正在最终保存，之后成功仍是成功，不能假称回滚。
- Viewer 关闭/换词：清排队资源、向在途请求发 owner-scoped cancel，撤销所有 Blob URL、删除注入样式；迟到响应再通过 isCurrent 拒绝写DOM。发取消和实际IO停止是两层，不能只做其中之一。

### 失败与替换

配额不足、版本/预留冲突、索引/源校验失败、MDD损坏都在 active 指针前拒绝；清理是尽力而为，IO异常或进程崩溃不能被描述成“绝不会有残留”。

普通本地 MDX 每次使用新 UUID；同名确认后另一份共存。当前[精选替换合同](../modules/dictionary-import-render.md#partial-replacement) 则只允许同声明 recipe+expectedActiveVersion，一旦当前版本变化拒绝覆盖；在新MDX内容摘要/文件名符合保留条件时可留旧MDD。MDD添加/替换独立维护 active.resources。不要把三种语义合成“任意词典原位替换”。

卸载先删字节再删状态，失败保留可见可重试行；成功再清偏好与缓存并通知资源会话。

### 重启能恢复什么

成功 active 快照在 chrome.storage.local，原文件与索引在 OPFS。后台重新创建 manager 后按快照读取，重新检查源大小、index大小/哈希及schema，再查询；缓存不是唯一数据源。

未完 controller/Worker/AbortController/URL 是内存状态，重启不续跑。当前 rich manager 不提供自动续传或全量 orphan/reservation 回收流程；createdAt 不是自动清理证据。正常reload后已安装词典可查询，不能推导成任意强制退出时导入也完整恢复。

## 8. 如何验证，哪些仍未知

[测试边界和固定源码链接](../modules/dictionary-import-render.md#test-boundaries)集中说明：
- Node/VM/memory store：preflight分流、重复/关联、File到Worker、取消提交、重建索引、受限AST/CSS、资源队列清理
- Chromium E2E：统一入口、MDD附加与重试相关路径、小型独立MDX/MDD的reload/图片/按需音频/CSS、安全DOM与资源清理
- 本轮这些测试全部 NOT_RUN；实机 Worker/OPFS、视觉/可访问性、强制崩溃恢复、任意真实Oxford10词典均未验证

后续改 UI 提示看 local UI/presentation；改格式能力看 preflight/parser/worker/后台重建；改排版看 sanitizer-style/viewer/resolver；改替换或取消必须核 reservation/commitpoint/ownerKey。不要用取消测试通过代替真实兼容，不要用解析结果或词条命中率代替富文本安全与可用性。

本章15个完整文件与其余局部依赖均列于[模块正文](../modules/dictionary-import-render.md)。结构化MDX/StarDict/TFLex内部、codec与parser全算法、catalog全流程、构建资源闭包及完整测试文件仍待后续专题。

