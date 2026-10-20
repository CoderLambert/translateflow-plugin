# 浏览器基础翻译 / Browser definitions

## 范围

Chrome 本地是单词查词与句段／全文各自可选的唯一方式之一，支持单词、短语、句子、段落和全文。选择与资源状态分开：安装词典、配置 AI 或准备本地模型不改变已保存选择。失败保留当前方式；划选面板允许只对当前操作临时切换。词典只有在明确选中时查询；不存在词典优先或 AI 失败后自动跨方式备用。字幕保留既有独立路径。配置与迁移规则见 [翻译偏好](PROVIDERS.md#翻译偏好与执行方式)。

## 设置页一次准备

设置 → 常规 → **Chrome 本地模型**。选择校验语言对后点击“准备并校验两个模型”。两个 `create()` 在点击调用栈中同时启动，分别显示识别器和翻译器的下载/初始化进度；随后用合成完整句验证检测语言、执行真实翻译并检查非空输出。只有两项都成功才显示自检通过。可取消、重试；迟到结果不会覆盖新状态。相同源/目标自动选择另一测试源语言，不修改保存的翻译偏好。

校验不是语义质量评分，也不是磁盘模型清单。界面显示的是本次实际 API 调用结果。Chrome 的设备限制、模型下载、用户激活及资源清理仍适用。释放 JS 实例不会删除 Chrome 语言包。

准备失败时，每个模型会结束初始化/下载状态，区分失败模型与因整轮停止而取消的模型；点击“重试准备”可以重新开始。展开“Chrome 诊断信息”可查看失败模型、扩展错误代码和浏览器异常名称，不展示原始异常消息或选词内容。更换校验语言对会清除上一轮结果；切换已保存偏好会取消旧任务，模型准备操作不会修改偏好。

## 阅读时的交互

已有可用模型自动创建/复用，不要求逐词确认。需要资源时可在页面、划词或字幕翻译提示中点击准备，也可打开设置页统一准备。进入设置页前只把语言对写入 `storage.session`，不保存正文、上下文或凭据；最多保留32条、一天有效的临时记录，设置页可重新选择该语言对。历史“曾检查通过”不等于永久可用。

短词以实际文本检测为基础，附近句子仅作为辅助证据：来自现有非敏感 SourceSnapshot，截取有界局部句子。多个相同词无法定位到具体出现位置时不猜测。强烈冲突、简繁不确定、中文语境里的外语词等不会自动变成确定结果，也不能误当成“已是目标语言”而跳过。人工纠正按文本及上下文区分，不污染后续其他选词。检测上下文不发送给 AI Provider、不进入译文缓存；Translator 翻译的仍是单词本身，不承诺解决同语言的一词多义。

## 执行环境和资源共享

Content 和 Options 使用同一个运行时实现：一个检测器、最多两个语言对，共享创建、串行实例使用、独立请求取消、忙碌容量队列、有界等待及空闲回收。创建预算180秒，推理/队列预算30秒，取消后最多等待1.5秒排空卡住的推理；低内存设备实例空闲60秒、其余120秒释放。接口支持普通译文与仅流式返回的模型实现，最终仍返回完整字符串。

**共享环境是用户主动打开的设置页，不是 Offscreen。** 保持设置页打开时，多个阅读标签页的单词查询可通过带来源校验的扩展 Port 共享已就绪模型；关闭后回到页面执行，必要时明确提示重新准备。不存在的共享页不会自动打开。来自网页的消息不能在设置页发起语言包下载。正常/隐身上下文不共享模型主机。当前没有新增权限、隐藏窗口、MAIN-world桥接或其它推理引擎。

短语、句子、段落及全文使用 Content 自己的同一运行时，不走仅接受单词的共享 Port；不通过放宽 Port 合同或隐藏页面复用模型。

因此，这与 FluentRead 的常驻 Offscreen 实现不是完全相同的生命周期：关闭设置页后不保留跨标签共享；页面执行仍可能受 HTTPS/Permissions Policy 影响。这是明确保留的架构边界，不应在发布说明中宣称已完全消除。

## 数据与验收

原 Provider、缓存 schema、词典、收藏和 ReadingRecord 不变；浏览器译文仍以源/目标语言及同一有效配置快照隔离。模型错误分为准备、下载/策略、等待、推理超时、语言自检不匹配及无效结果。取消、关闭或导航后的旧请求不能覆盖新的结果。

当前单元测试使用实际源码和模拟 Chrome API；真实模型下载、断网翻译和语义质量由用户在 Chrome 本机验收。不要把模拟测试、自检非空结果或在线免费翻译服务的报告当成离线语义质量证明。

## English

Chrome native translation is an explicit choice for words, phrases, sentences, paragraphs and pages. Saved word and text choices are independent and are not changed by resource preparation. Failures retain the selected method; selection controls can switch for one operation. Subtitles keep their independent route. Settings prepares detector and translator together from a real click and verifies a synthetic sentence, without changing either preference.

For word selections, a non-sensitive bounded source sentence can supplement language evidence. Conflicts and incompatible scripts remain uncertain; only the selected word is translated/cached. Context is not sent to an AI provider. Local corrections are scoped to the word and its context.

Failed preparation ends each model's active status and identifies the failed model separately from its cancelled peer. Retry starts a new attempt. The expandable Chrome diagnostic shows only the model, error code and safe browser exception name. Changing the test pair clears the previous result; disabling browser definitions releases the models and clears stale readiness.

While the user-opened Settings page stays open, a validated extension Port broker shares its ready models for single-word lookups. Text selections and pages execute locally in Content with the same runtime and never widen that Port contract. Closing Settings restores page-local execution. No hidden document, Offscreen reason, new permission or alternative local model is added; cross-tab sharing is intentionally not persistent after Settings closes. Remote messages cannot authorize model downloads. Pending preparation stores only language pairs/timestamps in session storage (bounded and expiring).

The shared runtime includes independent cancellation, bounded resource waiting, inference timeouts, idle eviction, streaming-result compatibility and late-result cleanup. Existing AI/dictionary/reading/cache contracts remain unchanged. Real model download, offline behavior and translation quality still require the user's Chrome acceptance.
