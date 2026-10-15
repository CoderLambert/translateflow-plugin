# 浏览器基础翻译 / browser basic translation

无需 AI Key 或词典即可尝试划词、页面和字幕翻译。设置 → 常规中的“启用浏览器基础翻译”默认开启；已配置 AI 时仍优先使用选定 AI 及站点覆盖。AI 配置按保存的连接判断，不发送自动测试请求。连接失效会显示配置错误。

源语言默认为自动，字幕优先采用轨道语言，网页/划词结合浏览器识别与页面语言。短词不一定能可靠识别，请在准备面板纠正源语言，或在设置中保存源语言偏好。目标语言沿用全局/站点设置，默认简体中文；标准语言名称和代码映射到浏览器语言代码。AI 自定义目标文案保留，基础引擎无法识别时需要改为标准语言。

第一次翻译可能出现“准备基础翻译”。只有点击该按钮才创建翻译实例并允许浏览器下载语言包；进度条显示浏览器报告的进度，失败后可重试或取消。语言识别模型缺失时，可以直接手选源语言，也可以明确点击“识别语言”准备识别模型。关闭基础翻译后停止基础任务、释放实例；Chrome 已下载的共享语言包由浏览器管理，扩展不删除它们。

AI 请求失败后可取消并重试原任务，或点击“使用基础翻译”开始新任务。此选择仅对当前页面生效，页面导航或变更 AI 连接后重新采用默认选择。基础结果标明来源，可复制和收藏；“AI 解释”仍需配置 AI。基础引擎不执行 AI Prompt、术语表指令或 Preset。富文本按受保护的格式片段翻译，保留链接和代码，但片段间语义连贯性可能受影响。

浏览器、操作系统、语言对、安全上下文和网站 Permissions Policy 都可能限制能力。普通 HTTP 页面不提供基础翻译时，可使用 HTTPS 或配置 AI。API 可探测、`downloadable`、模型准备完成和真实翻译是不同状态，不能互相代替。离线可用性需要先完成语言包准备，再在本机断网实测。

词典是高级设置中的可选功能，新安装默认关闭，基础安装包不附带词典。升级会保留已安装且启用的词典；显式关闭也会保留。启用后先查询本地结构化/富文本词典，未命中或资源不可用时继续翻译。词典、收藏及阅读记录不会被清空。

## English

Basic translation can translate selections, pages and subtitles without an AI key or dictionary. Enable browser basic translation is on by default. A configured AI service and its site overrides take priority; a broken AI connection remains a configuration error. No connection test is sent automatically.

The source language defaults to automatic detection. Subtitle tracks take priority; page language is a hint when detection is unavailable. Correct ambiguous words in the preparation panel, or save a source preference in Settings. The target is remembered globally and per site, with Simplified Chinese as the default. Custom AI target descriptions remain supported by AI; basic translation requires a recognized standard language.

Click Prepare basic translation on the page to create the translator and allow language-pack downloads. Installing the extension, opening a page or displaying a selection chip does not download models. Progress, cancellation and retry are available. If detection needs a model, choose a source manually or explicitly prepare language detection. Turning basic translation off stops basic tasks and releases instances. Chrome manages its shared downloaded language packs.

After an AI failure, explicitly choose Use basic translation to start a new task. This choice lasts for the current page and resets after navigation or AI connection changes. Basic results identify their source and support copying/saving. AI explanations require an AI service. AI prompts, glossary instructions and style presets do not apply to the basic engine. Translating protected formatting runs independently can reduce context across runs.

Browser support, language pairs, secure contexts and site permissions can limit availability. Use HTTPS or configure AI when basic translation is unavailable. A detectable API or downloadable state does not prove successful translation or offline operation. Prepare the language packs, then test offline on the actual device.

Dictionaries are optional advanced settings and are excluded from the base package. New installs leave dictionaries off; upgrades retain enabled imported dictionaries and explicit disabled preferences. Dictionary misses or unavailable resources continue to translation. Existing dictionaries, saved vocabulary and reading records remain intact.
