# 浏览器基础翻译 / Browser definitions

## 范围

Chrome 内置本地模型只用于获准的单词划词释义。词典命中仍优先显示词典，已配置的 AI 仍按原设置优先；AI 失败不会静默切换。整页、字幕、短语和长选区继续使用 AI，不因本轮修改开放本地翻译。

## 设置页一次准备

设置 → 常规 → **Chrome 本地模型**。选择校验语言对后点击“准备并校验两个模型”。两个 `create()` 在点击调用栈中同时启动，分别显示识别器和翻译器的下载/初始化进度；随后用合成完整句验证检测语言、执行真实翻译并检查非空输出。只有两项都成功才显示自检通过。可取消、重试；迟到结果不会覆盖新状态。相同源/目标自动选择另一测试源语言，不修改保存的翻译偏好。

校验不是语义质量评分，也不是磁盘模型清单。界面显示的是本次实际 API 调用结果。Chrome 的设备限制、模型下载、用户激活及资源清理仍适用。释放 JS 实例不会删除 Chrome 语言包。

## 阅读时的交互

已有可用模型自动创建/复用，不要求逐词确认。需要资源时可在划词浮层点击准备，或者打开设置页统一准备。进入设置页前只把语言对写入 `storage.session`，不保存正文、上下文或凭据；最多保留32条、一天有效的临时记录，设置页可重新选择该语言对。历史“曾检查通过”不等于永久可用。

短词以实际文本检测为基础，附近句子仅作为辅助证据：来自现有非敏感 SourceSnapshot，截取有界局部句子。多个相同词无法定位到具体出现位置时不猜测。强烈冲突、简繁不确定、中文语境里的外语词等不会自动变成确定结果，也不能误当成“已是目标语言”而跳过。人工纠正按文本及上下文区分，不污染后续其他选词。检测上下文不发送给 AI Provider、不进入译文缓存；Translator 翻译的仍是单词本身，不承诺解决同语言的一词多义。

## 执行环境和资源共享

Content 和 Options 使用同一个运行时实现：一个检测器、最多两个语言对，共享创建、串行实例使用、独立请求取消、忙碌容量队列、有界等待及空闲回收。创建预算180秒，推理/队列预算30秒，取消后最多等待1.5秒排空卡住的推理；低内存设备实例空闲60秒、其余120秒释放。接口支持普通译文与仅流式返回的模型实现，最终仍返回完整字符串。

**共享环境是用户主动打开的设置页，不是 Offscreen。** 保持设置页打开时，多个阅读标签页可通过带来源校验的扩展 Port 共享已就绪模型；关闭后回到页面执行，必要时明确提示重新准备。不存在的共享页不会自动打开。来自网页的消息不能在设置页发起语言包下载。正常/隐身上下文不共享模型主机。当前没有新增权限、隐藏窗口、MAIN-world桥接或其它推理引擎。

因此，这与 FluentRead 的常驻 Offscreen 实现不是完全相同的生命周期：关闭设置页后不保留跨标签共享；页面执行仍可能受 HTTPS/Permissions Policy 影响。这是明确保留的架构边界，不应在发布说明中宣称已完全消除。

## 数据与验收

原 Provider、缓存 schema、词典、收藏和 ReadingRecord 不变；浏览器译文仍以源/目标语言及同一有效配置快照隔离。模型错误分为准备、下载/策略、等待、推理超时、语言自检不匹配及无效结果。取消、关闭或导航后的旧请求不能覆盖新的结果。

当前单元测试使用实际源码和模拟 Chrome API；真实模型下载、断网翻译和语义质量由用户在 Chrome 本机验收。不要把模拟测试、自检非空结果或在线免费翻译服务的报告当成离线语义质量证明。

## English

Chrome native models remain restricted to authorized selected-word definitions; pages, subtitles and longer selections retain the existing AI path. Settings → General → Chrome local models prepares detector and translator together from a user click, reports progress separately, and verifies the language of a synthetic sentence plus nonempty actual translation output. This is execution verification, not a semantic quality certificate.

A non-sensitive bounded source sentence can supplement short-word language evidence. Conflicts and incompatible scripts remain uncertain; only the selected word is translated/cached. Context is not sent to an AI provider. Local corrections are scoped to the word and its context.

While the user-opened Settings page stays open, a validated extension Port broker shares its ready models across tabs. Closing Settings restores page-local execution. No hidden document, Offscreen reason, new permission or alternative local model is added; cross-tab sharing is intentionally not persistent after Settings closes. Remote messages cannot authorize model downloads. Pending preparation stores only language pairs/timestamps in session storage (bounded and expiring).

The shared runtime includes independent cancellation, bounded resource waiting, inference timeouts, idle eviction, streaming-result compatibility and late-result cleanup. Existing AI/dictionary/reading/cache contracts remain unchanged. Real model download, offline behavior and translation quality still require the user's Chrome acceptance.
