# FluentRead 复用映射（已有字幕翻译）

TF 基线：`ee8b08dfd08ced762ffcb275304da6249615b718`。上游固定为 FluentRead `5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f`。

Slack 已记录完整函数分析和任务拆分：
https://agent-labco.slack.com/archives/C0C7L7996E9/p1792515429375759

分类：A 原源码独立提取；B 带依赖闭包适配；C 保留 TF 所有者，参照上游行为修正。C 不是源码移植。上游测试存在、独立提取测试通过、TF 集成通过和真实 YouTube 验收是四种不同证据。

## 固定文件、函数及调用方式

### A1 调度核心

[translationScheduler.ts:1–86](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/translationScheduler.ts#L1-L86)

Git blob `c7f0871d4db5499a29ec61793d6822d825aa7bbb`。无外部 import，可单独保存原文件。

`VideoTranslationScheduler.request(source,prefetch)` 合并 Promise、提升当前句；`retainPrefetches` 仅淘汰未开始的过期预取；`clear` 拒绝旧消费者但不重置在途计数；`pump` 保留当前句容量（上游总3/预取2）。

TF 使用方式：把稳定 resultKey 映射到 unit/requestId，注入现有 translation-client；不能直接 fetch。相同 unit 从预取转当前句必须保持同一任务。适配器的完成信号必须对应实际执行释放；TF 消费者提前取消不证明底层释放。未解决此边界前不启用生产预取。

上游测试：[videoTranslationScheduler.test.ts](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/tests/videoTranslationScheduler.test.ts)，含同 Promise、优先级、窗口淘汰、忽略 abort 的真实占用、旧 finally 不删同 key 新任务。

### A2 选句与窗口函数闭包

[subtitleLogic.ts:101–181](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/subtitleLogic.ts#L101-L181)

Git blob `f3c6f881e4fe7aedaf0814c416e2cfe3c422a9ba`。提取 `selectVideoSubtitleCueAtOffset`、`selectVideoSubtitlePretranslationCues`、`selectYoutubeCaptionCue`，同时保留 `hasRollingCaptionPrefix`、`normalizeVideoCaptionText` 和 cue 类型。不要整文件导入 FR Config/glossary/服务目录。

作用：严格时间区间、当前句优先、最多8条不同未来文本、倍率前看、原文和播放时间共同匹配，识别滚动旧句残留。

TF 使用方式：边界集中将秒转换为整数毫秒；用 side-table 保留 TF cue ID/文本修订及原 cue 映射；结果不自动授予 Provider 调用权限。上游单活动 cue 不替代 TF 合法重叠集合。

上游测试：[videoSubtitleLogic.test.ts](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/tests/videoSubtitleLogic.test.ts)。

### B/C3 内存结果及当前显示资格

[translationCache.ts:11–119](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/translationCache.ts#L11-L119)，blob `d6d22ce4fd37684df4ab90c667b2752962d880bb`。

`peek` 同步恢复；`cancelPending` 保留成功结果；requestVersion 隔离迟到写入；160条 FIFO（不是 LRU）；失败退避2/5/15/30秒。

[runtime.ts:446–500](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/runtime.ts#L446-L500)，blob `0b10d07b187c39488e5add696612977782d2ae2b`：换句清旧译文，先 peek，回调重新检查 generation/cueKey/trackVersion/seeking 和当前时钟。

本批在 TF `controller.js`、`pipeline.js` 内修正：完成 Set 改为有界结果 Map，当前快照匹配，换句/空档清空，原序组合重叠字幕，mode取消保留可复用结果。属于 C 类，不是复制 runtime/cache。DB4、Provider 和真实有效配置仍由原有后台负责；跨配置快照及后台准备阶段取消属于 YT-02 未完成部分。

### B4 原生控制栏绑定

[videoPlayerBinding.ts:51–100](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/videoPlayerBinding.ts#L51-L100)；[214–370](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/videoPlayerBinding.ts#L214-L370)。Blob `a592f258e463400c3d3fd4cbff42350565cd3f4b`。

`nativeControls` 找真实栏；`insertionAnchor` 沿直接子节点保留全屏 tooltip 包装；binding 的 place/sync/observer 复用带监听的活按钮，按 owner 删除深复制副本，过滤字幕/tooltip 更新并清理旧宿主。

TF 使用方式：给现有 source 提供薄 locator adapter，带上 ui 标记/locator 契约，只提取 YouTube 分支。按钮 light DOM，面板位于播放器子树，内部沿用 TF Shadow/i18n。不能引入第二套全页轮询。TF 的 off 保留入口，与 FR enabled=false 清掉入口不同，需要明确适配。

上游测试：[videoPlayerBinding.test.ts](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/tests/videoPlayerBinding.test.ts)。

### B5 菜单构造

[playerMenu.ts:16–134](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/playerMenu.ts#L16-L134)，blob `4af1530abb8db0ea29a0ce007dc52d9c72e3417f`。

只取四模式、`createIcon/createHeader/createModeGroup` 及无副作用动作派发方式；逐节点创建 SVG，不写 innerHTML。替换 TF 品牌/i18n/设置命令，模式映射同步 Options、PUBLIC_SETTINGS 校验、source/bridge/renderer。剔除学习、导出及识别依赖。服务摘要必须来自 subtitle 实际配置；AI 风格不是 Provider。Shadow 焦点、composedPath、Escape及全屏需在 TF 独立验收。

### B6 字幕归并，不全换解析器

[youtubeSubtitleData.ts:193–413](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/youtubeSubtitleData.ts#L193-L413)；[481–500](https://github.com/FluentRead/FluentRead/blob/5a362c67194e6ba56b0ce66e2b03ba00e1abbd3f/src/features/video-subtitle/content/youtubeSubtitleData.ts#L481-L500)。Blob `176376301cf219c33cb6ad8b27899b1b44d9ec7a`。

带上 `collapseIncrementalCues`、`mergeWordStreamCues`、`finalizeVideoSubtitleCues` 和引用/缩写/间隔 helper 闭包。保留700ms间隔、8秒跨度、14词等原阈值及对应边界样本；在 TF 已解析 cue 后适配并保留原cue关联。只对确认的自动滚动轨道启用，不能破坏人工轨道的时序及重叠。

上游 `parseJson3Events` 主要拼接 utf8，不是所有 aAppend/tOffsetMs 语义的已验证实现；XML 回退中的 VTT 注释也不是 VTT parser。保留 TF 当前获取桥、输入预算、格式支持，禁止用整文件替换掩盖退化。

## 提取、许可与集成状态

A1 已按原 Git blob 独立提取；A2 已提取上述纯函数依赖闭包，保留函数体并用 TypeScript 类型擦除执行。两者位于独立参考验证包，附 GPL 原文/来源/摘要/探针，不在生产模块图，也不冒充 TF 安装包。

10项独立探针验证了身份、去重/晋级、占用、窗口淘汰、8条限制、非变异、倍率、时间空档、重复文本时段及滚动前缀。不是上游全套 Vitest，不证明实际 DOM、Provider 或浏览器性能。

FluentRead 使用 GPL-3.0；TF 当前未明确整体分发许可。直接生产接入需先确定兼容的分发许可，不能擅自替整个仓库改许可证。当前 C 类自有代码修复独立推进；B 类仍待裁剪和集成测试。

版本维护必须记录 upstreamCommit/path/blobSHA、函数闭包、许可证、适配 diff 和验证样本。不在构建时下载 main，不远程执行上游代码。优先沿用已验证算法，必要差异通过 adapter 和对照测试显式表达。
