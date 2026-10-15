# 浏览器基础翻译 / Browser basic translation

浏览器基础翻译只用于划选单词的基础释义，默认开启。整页、字幕和较长划词内容使用已配置的 AI 服务，不会初始化或下载浏览器翻译模型。词典命中时仍优先展示词典结果；词典未命中且没有可用 AI 时，单词型划词才进入浏览器释义流程。

## 自动识别与首次使用

源语言选择“自动识别”后，优先使用 Chrome LanguageDetector 判断实际语言，而不是沿用网站界面语言。划词时若现有阅读投影已捕获非敏感上下文，使用选词附近的句子辅助检测；真正翻译、收藏和缓存的仍是所选单词。敏感或无法定位的上下文不用于检测。用户明确设置或手动纠正的源语言优先于自动识别结果。

如果识别模型尚需准备，点击“启用识别并继续”。准备完成后自动识别并进入翻译，不再要求额外确认识别结果。仅当置信度不足、候选接近或中文简繁无法可靠区分时，展开手动选择。手动纠正按当前文本保存在页面内存，不把某个单词的语言应用到后续所有划词。

新语言对仍可能需要点击“准备并翻译”以允许 Chrome 下载/激活资源。已有可用语言对自动创建或复用实例，不逐条询问。实例全部忙碌时会按队列等待（总等待预算 30 秒），而不是立刻提示繁忙。首次准备还会使用选词做一次真实的非空译文自检；失败允许重试。准备面板显示下载和自检状态；纠正源语言放在次要展开项中。取消、超时或导航后的迟到结果不会继续显示或进入缓存。

## 模型与结果

每个页面复用一个检测器和最多两个语言对实例，同实例任务串行。闲置约两分钟后释放实例；释放实例不删除 Chrome 管理的语言包。已确定为目标语言的段落直接保留，划词显示“原文已是目标语言”，不产生重复译文记录。

基础引擎不执行 AI Prompt、术语表指令和风格 Preset，也不参与整页结构化段落或字幕队列。划词结果显示为紧凑的“浏览器释义”卡片，可复制和收藏；AI 详解仍需要单独配置 AI 服务。

现有 IndexedDB、AI 缓存指纹、词典、收藏及 Reading 数据保持不变。浏览器结果使用明确语言对的独立配置快照；模型准备期间后台重启导致快照丢失时，仅按同一语言对恢复一次，不自动改用云端。

浏览器版本、设备、安全上下文和网站 Permissions Policy 仍可能限制可用性。Chrome 还可能对新的站点再次要求用户激活，即使磁盘上已有共享语言包。界面会明确提示，不绕过浏览器限制。真实离线效果和翻译质量由用户在本机完成产品验收；单元测试使用 mock，不冒充真实模型验证。

## English

Browser translation is limited to basic definitions for selected words. Webpages, subtitles, and longer selected text require a configured AI service and never initialize or download browser translation models.

Automatic mode uses Chrome LanguageDetector and, when the existing source projection provides safe non-sensitive context, a bounded nearby sentence to identify selected words. Only the word itself is translated and cached. Explicit source settings and manual corrections take precedence; ambiguous results are never forced.

For first use, choose **Enable detection and continue**. Successful detection proceeds automatically. Manual source selection is secondary for ambiguous results. A new pair may require **Prepare and translate**; preparation confirms a non-empty real test translation before reporting success. Busy model slots wait up to 30 seconds for capacity instead of failing immediately. Ready models are reused automatically; Chrome may still require activation for a new origin.

Each page retains one detector and at most two translator pairs for selection tasks, with serial model use and a two-minute idle lifetime. Releasing an instance does not uninstall language packs. Known target-language content is kept without generating or saving a duplicate definition. Cancellation is isolated per request; late output cannot overwrite the new task.

Existing AI, cache, dictionary and reading-history boundaries remain unchanged. Secure contexts, website policy and device support still apply. Unit tests use mock models; real translation and offline acceptance remain user-run checks.
