# 运行时总览与阅读地图

[返回导读首页](README.md) · [完整文件清单](repository-map.md) · [启动调用链](features/extension-startup.md) · [启动逐文件说明](modules/startup.md)

源码基线：`d5e308a709c008acf6b277d466d020f13025bdca`。本页为固定版本静态分析；运行验证 **NOT_RUN**。本轮完成启动切片，后续功能内部仍待展开。

## 先区分五种运行环境

1. **扩展后台 service worker**：默认 [background.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/background.js) 调用 [initializeBackground](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/src/background/index.js)；WXT [entrypoints/background.ts](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/entrypoints/background.ts) 复用同一函数。注册消息、快捷键、Reading端口/标签页/权限和安装启动事件。不能把浏览器启动事件当成每次 service worker 唤醒。
2. **扩展页面**：Popup/Options 是原生 HTML/CSS/JS；WXT 编译这些唯一源码。Popup负责用户入口；Options负责配置和导入。页面生命周期不同于后台，关闭Popup并不等于自动取消所有后台请求。
3. **网页 ISOLATED Content**：classic脚本按清单顺序装配到 `globalThis.__TRANSLATE_FLOW_CONTENT__`；[content.js](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/content.js) 最后注册监听并启动界面功能。不能直接加入ESM import。
4. **YouTube MAIN**：受限网页桥接，仅观察播放器自己的字幕响应；不承载任意后台能力。本轮只说明边界，字幕算法另行导读。
5. **导入 Workers**：Options按固定路径启动的独立处理环境；不是后台 service worker 的别名，也不是每次扩展启动都会创建。具体导入协议仍待说明。

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

后三项内部算法尚未逐文件讲解，在[覆盖清单](coverage.json)中仍为待解释。本页的数据所有权依据[现有架构约束](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/docs/ARCHITECTURE.md)与[AGENTS](https://github.com/CoderLambert/translateflow-plugin/blob/d5e308a709c008acf6b277d466d020f13025bdca/AGENTS.md)，不宣称所有实现已完成独立安全审核。

## 如何定位修改

- “打开Popup或快捷键没有作用”：先读[启动功能章](features/extension-startup.md)，再检查注入、页面协议、受限URL和消息返回。
- “新增Content模块”：按启动逐文件说明检查有序清单、bootstrap依赖与双构建产物；不要只创建文件。
- “改某个业务功能”：先从本页边界找到后台/Content/Worker归属，再进入对应功能章；尚未创建章节见首页待完成列表。
- “源码更新了”：先用coverage中的固定blob比较；受影响文件标记待复核，连带复核调用方和返回UI，而非只改一个文件摘要。

## 当前缺口

完整启动切片之外，划词词典、导入/富文本、网页翻译与缓存、字幕、设置、Reading和构建测试尚未完成逐文件导读。此总览不是全产品源码审计，也不证明Oxford10真实包已经能解析展示。
