# 运行时总览与阅读地图

[返回导读首页](README.md) · [完整文件清单](repository-map.md) · [启动调用链](features/extension-startup.md) · [启动逐文件说明](modules/startup.md) · [划词查询链](features/selection-and-dictionary.md)

当前清单及构建验收基线：`86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d`。以下运行时固定链接保留`d5e308a709c008acf6b277d466d020f13025bdca`，已说明运行时源码blob未变；浏览器测试基础设施变化以[构建章](features/build-test-release.md)为准。本页为固定版本静态分析；运行验证 **NOT_RUN**。已完成启动、划词查询、MDX/MDD导入展示、网页翻译/缓存、YouTube字幕、Provider/设置与Reading已实现后台链；大型依赖的内部覆盖以清单为准。

## 先区分五种运行环境

1. **扩展后台 service worker**：默认 [background.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/background.js) 调用 [initializeBackground](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/index.js)；WXT [entrypoints/background.ts](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/entrypoints/background.ts) 复用同一函数。注册消息、快捷键、Reading端口/标签页/权限和安装启动事件。不能把浏览器启动事件当成每次 service worker 唤醒。
2. **扩展页面**：Popup/Options 是原生 HTML/CSS/JS；WXT 编译这些唯一源码。Popup负责用户入口；Options负责配置和导入。页面生命周期不同于后台，关闭Popup并不等于自动取消所有后台请求。
3. **网页 ISOLATED Content**：classic脚本按清单顺序装配到 `globalThis.__TRANSLATE_FLOW_CONTENT__`；[content.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/content.js) 最后注册监听并启动界面功能。不能直接加入ESM import。
4. **YouTube MAIN**：受限网页桥接，仅观察播放器自己的字幕响应；不承载任意后台能力。获取、仲裁、批处理和UI生命周期见[字幕功能章](features/youtube-subtitles.md)。
5. **导入 Workers**：Options按固定路径启动的独立处理环境；不是后台 service worker 的别名，也不是每次扩展启动都会创建。实际导入协议见[词典导入章](features/local-dictionary-import.md)，底层大型依赖完整程度以覆盖清单为准。

固定资源路径由 [runtime-assets.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/shared/runtime-assets.js) 定义；Content脚本清单与注入规则见启动导读。构建允许清单控制真正进入安装包的文件，仓库存在的文件不等于可在扩展运行时访问。

## 入口如何连接成用户流程

用户打开Popup或使用快捷键 → 对当前页面检查/注入Content → Content注册消息并启动外观、快捷控制、划词、持久站点模式和字幕控制器 → UI动作经扩展消息到后台router → 后台调用对应业务边界 → 返回受控响应 → 原动作的UI更新。

[router.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/router.js) 中普通消息以 `{ok:true,...result}` 或 `{ok:false,error,errorCode}` 返回；Reading消息走独立v2处理入口，不经旧包装。具体权限校验随消息族不同，不能把“来自扩展”当作所有动作通行证。例如词典生命周期动作校验Settings发送者，富文本资源读取校验Content身份。

启动本身不等于调用翻译Provider。用户已开启的自动模式、适用字幕模式会进入自己的后续任务链；仅恢复缓存模式不得在miss时隐式调用Provider。完整功能链分章继续补充，不以本页摘要替代正文。

## 状态与数据归谁

| 状态/数据 | 所有者与生命周期 | 修改时必须同时考虑 |
| --- | --- | --- |
| 配置、站点偏好 | chrome.storage.local，由相应配置/注册模块协调 | Effective Config、权限、Content storage监听 |
| 页面加载标记、任务/自动观察状态 | Content所在文档的内存；runtime保存state，content负责装配 | 重复注入、导航、取消、旧响应 |
| 翻译缓存 | 后台cache-db.js是直接IndexedDB边界 | Provider和缓存必须使用相同有效配置 |
| Reading历史/授权 | reading-record/idb.js是独立数据库边界，UI经v2消息 | 端口/页面会话、权限撤回；不混入翻译缓存 |
| 本地词典 | 独立OPFS与对应目录/索引 | 导入事务、版本/资源关联、恢复 |
| Provider HTTP | background/providers/ | AbortSignal、timeout/retry、显式用户动作和费用 |

共享请求/缓存已在网页翻译章解释；Reading部分共享合同与普通pack/TFLex存储仍有未覆盖部分，见[覆盖清单](coverage.json)。本页的数据所有权依据[现有架构约束](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/ARCHITECTURE.md)与[AGENTS](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/AGENTS.md)，不宣称所有实现已完成独立安全审核。

## 如何定位修改

- “打开Popup或快捷键没有作用”：先读[启动功能章](features/extension-startup.md)，再检查注入、页面协议、受限URL和消息返回。
- “新增Content模块”：按启动逐文件说明检查有序清单、bootstrap依赖与双构建产物；不要只创建文件。
- “改某个业务功能”：先从本页边界找到后台/Content/Worker归属，再进入对应功能章；尚未创建章节见首页待完成列表。
- “源码更新了”：先用coverage中的固定blob比较；受影响文件标记待复核，连带复核调用方和返回UI，而非只改一个文件摘要。

## 当前缺口

启动与划词/本地词典/显式AI的功能调用链已补齐；MDX/MDD导入与安全展示已新增功能章和15个文件详解；词典parser/存储、设置大入口和Reading共享合同局部依赖，以及构建测试仍待继续；Reading后台已有专章，但产品保存与学习中心入口仍缺。文件级完整程度以coverage为准，边界引用不算整文件完成。此总览不是全产品源码审计，也不证明Oxford10真实包已经能解析展示。

## 划词查询接上启动之后

[完整功能章](features/selection-and-dictionary.md) · [逐文件正文](modules/selection.md)

启动注册Selection监听后，用户有效选择先出现入口，点击才冻结snapshot并发送SELECTION_RESOLVE。适合本地英中词汇检索的分支走lexical gateway与结构化候选；句子/不支持语言以及无命中的多词短语可走普通翻译。单词无命中保留中性空态，AI详解另需显式点击。“本地优先”不能概括成所有选段永不调用Provider。

Rich词典详情是独立支路：获取词典卡→按展开状态懒查询→后台校验owner并读取→Content清洗→viewer；不阻塞或替换结构化主卡。换词/关闭先使本地session失效，再尝试后台取消；不能将取消消息已发送或allSettled结束当成全部底层读取确认停止。

SourceSnapshot只是本次查询的内存证据，尚不等于Reading记录保存。拟议Oxford10新消息/样式/快照合同不属于本页固定main的已实现能力。

## 词典从文件到展示的实际提交边界

[完整导入与展示链](features/local-dictionary-import.md) · [逐文件正文](modules/dictionary-import-render.md)

当前统一入口先在Options做可取消预检，随后MDX worker暂存、后台重建核验并激活，再单独安装MDD附件。附件失败保留已安装MDX，界面允许重试；不能解释成整包回滚。MDD整组资源在验证后切换active.resources，旧附件在成功后才尽力清理。

查询返回的不可信rawRecord还需有限AST、样式白名单和viewer重建；MDD字节走owner-scoped消息，音频点击时加载，关闭时回收Blob。现有容量与CSS/资源限制仍是当前行为，Oxford10规划并未落地。重启后可读取已激活OPFS数据，不代表未完成导入自动续传或所有孤立暂存已回收。

## 网页翻译与缓存重访

[完整流程](features/page-translation.md) · [逐文件正文](modules/page-translation-cache.md)

DOM候选→有限行内marker→去重分批→缓存查询→缺失时Provider→当前页面/原文核对→受控DOM与缓存。cache-only在网络分支前返回，独立自动恢复的miss不会触发Provider。隐藏译文、清DOM、清持久缓存是不同操作。

有效配置由同一解析规则得到，但lookup、translate、store各消息重新读取，尚非一次点击固定配置快照；网络期间变配置的缓存归属风险为静态分析，未复现。取消不撤销已发送的CACHE_STORE，关闭auto也不等于abort在途。本文边界不更改业务或宣称测试失败，详见功能章的可验证限制。


## YouTube字幕接上共享请求与缓存

[完整流程](features/youtube-subtitles.md) · [11个逐文件说明](modules/youtube-subtitles.md)

播放器请求经MAIN旁路观察和有限协议进入ISOLATED，依次选择当前代MAIN timedtext、真实active TextTrack、DOM文本，再稳定化、去重、限队列分批。后台单批只解析一次有效配置，查缓存、调用Provider并写回；renderer使用textContent显示。签名字幕URL不重放。

视频切换有媒体代与本地任务过期保护，但这不等于同视频所有cue/切轨时序均正确，也不等于后台缓存阶段可撤销。original模式仍进入翻译；off仅阻止新ingest，不能称队列及在途调用已取消。这些静态边界与现有合成测试范围均在功能章明确，实际网站与竞态验证NOT_RUN。


## Provider与设置如何决定实际请求

[完整流程](features/providers-and-settings.md) · [11个逐文件说明](modules/providers-and-settings.md)

Options全局/站点保存、Popup临时/本站Preset是不同持久化路径；后台按字段组合站点覆盖、临时Preset和Glossary，再交Provider适配。临时Preset按规范化站点会话共享，不是单tab私有；Effective Context不返回凭据。

测试连接先保存表单，失败不回滚；测试成功不证明站点配置、翻译id完整性、流式和DOM可用。普通HTTP、SSE及本地模型分支的重试、格式检查和取消覆盖范围不同，不能用单一“自动重试/取消”概括。网页配置快照风险仍未修复；细节及测试缺口均为静态分析，NOT_RUN。


## Reading后台合同与用户入口断点

[完整后台链与UI断点](features/reading-records.md) · [19个逐文件说明](modules/reading-records.md)

已冻结SourceSnapshot并不自动写历史。main已实现Reading v2原生身份授权、操作登记、独立IDB短事务、列表/管理/分块导出与失效Port；SAVE仅在真正commit后返回saved，取消ACK区分尚未保存与已提交事实。

生产readingAccessCollector及完整begin/save点击链尚缺，learningCenterAvailable默认false，固定学习中心打开仍NOT_READY；handoff合同不等于已实现回原文。测试注入的collector/页面与真实产品入口分开，不能把后台及合成测试当用户可用闭环。旧规范开头repository absent已落后于main，导读按固定源码说明。此轮未运行测试，不修改业务。


## 构建与验收消费的是哪份产物

[完整链](features/build-test-release.md) · [逐文件正文](modules/build-test-release.md)

main 86ed596仍以legacy作为默认构建/发行；本地test:e2e默认选已有WXT，两者不能混同。fixture不再自行build或fallback，先精确复制并记录原tree摘要，再允许列明的测试副本改动。sourceHead是声明而非构建证明；新包UI出现也不证明旧缓存Worker已替换，同ID升级需要实际激活及存储快照验证。

共享fixture和CI变化已复核，前七章运行时固定源码仍一致；旧测试链接只说明当时断言，不代表当前包通过。构建输出包含递归清理，已知路径安全后续见本章，禁止将当前guard说成全面可靠。所有本轮运行、浏览器与发布均NOT_RUN。


## Rich MDX/MDD持久读取内部链

[二进制到重载查询](features/mdict-storage-internals.md) · [35个逐文件说明](modules/mdict-storage-internals.md)

File范围源→header与压缩块→compact index→OPFS staging→后台重建核验→active snapshot→按需key/record块查询→alias/rawRecord或MDD媒体→既有受控展示。MDX提交核验索引描述符但不遍历每条record payload，MDD提交额外验证全部record块；不能将两者的提交证据混同。

MDX index Map无MDD式容量驱逐，MDD为序列化index字节LRU；不同层的取消粒度和原生对象开销在正文单列。main key边界规范化不对称仍是现状，未合入parser分支和Oxford方案均不算当前支持。普通pack/TFLex索引与旧文本导入是其它路径，仍按coverage保留缺口。
