# 253 — 当前完整 UI 的 en/zh_CN 收口

Parent：任务 191。硬依赖：249、252、244。本任务让当前已交付的 Popup、Options、Learning Center 与网页内 TranslateFlow 控件完整消费同一 `src/i18n/` en/zh_CN catalog；不改变翻译目标语言、词典语言、Provider、Prompt、缓存、ReadingRecord 或词典数据合同。

## 用户结果

- `uiLocale = auto | en | zh_CN` 对当前 TranslateFlow 自有 UI 一致生效：Popup、Options（含 Glossary/词典库）、Learning Center、Quick Control、划词/本地词典/AI 解释和字幕控件不再混用硬编码中英文。
- 切换语言后，已打开的扩展页面与已挂载的网页内控件在现有 storage/runtime 边界内安全刷新；首次读取未完成时不闪出错误语言。关闭重开仍保持选择。
- loading、empty、error、success、取消、重试、权限、安装/修复/删除与确认路径使用同一语言；动态来源名称、模型名、站点、词条和用户文本只作为文本参数，不当作 HTML。
- Manifest 语言继续由浏览器决定；用户 UI 语言不改变浏览器 action 名称、翻译配置、请求体、缓存 identity、历史 Artifact 或词典检索语言。

## 实现与安全边界

1. 扩展现有 typed `createI18n()` catalog，不引入第二套翻译表、运行时网络翻译、HTML 插值、全局状态库或新权限；消息 key 与 placeholder 继续由英文 literal 推导并由一致性检查验证。
2. React surface 通过小型 locale hook/context 消费纯 i18n API；网页内 classic/IIFE UI 通过不访问存储的 renderer 接收已解析 locale 或 translator。`src/i18n/` 保持纯函数，storage/browser listener 由各 surface 现有 owner 管理并对称清理。
3. 保留既有 DOM id、消息值、用户手势、focus/Escape、Shadow DOM、取消/generation、Worker/Blob/listener cleanup、sanitizer 与 permission request 边界；本任务只改变展示文案及必要的 locale 传递。
4. Provider/浏览器/词典原生名称和用户数据不强行翻译。诊断日志不得包含插值后的私人文本；缺 key 显示开发诊断并在检查中失败。
5. 更新 `docs/UI_LOCALE.md` 与架构说明，删除“仍在迁移”的过渡声明；不宣称繁体中文、其它语言、其它浏览器或商店页面已完成。
6. Reading 页内历史列表只显示通用序号、定位状态和历史入口。未定位 quote、上下文及回答不得进入网页 DOM、属性或 ARIA。回访 quote 仅在 Range 仍连接且再次精确匹配后显示。
7. Reading 刷新在首个 await 前同步清除旧 Range、marker 与回访 quote，并把条目降为通用未定位状态；保留历史入口、手动重试、generation/dismissed 取消语义。一个共享长页扫描消费者取消时，不能中断仍在使用该扫描的其它消费者。
8. 四轮自动扫描重试耗尽后保留通用历史列表与手动重试。内容可见性/投影变化必须使缓存结果失效；不回退来源可信身份路由、真实保存终态或 IDB 错误首因。
9. 冻结的历史 Content 加载清单属于升级测试夹具。生产 Content 继续由 WXT 唯一模块图装配 `contentI18n`；仅为过时夹具提供测试 owner，不在生产端兼容性绕过 locale 依赖。

## 完成标准

- catalog en/zh_CN key、placeholder 和受控 Manifest 投影一致；单元测试覆盖各 surface 的代表性文案、动态参数、locale 切换/cleanup，以及 `uiLocale` 与翻译/词典配置独立性。
- `npm run validate`、`npm run build:extension:wxt`、`npm run test:wxt:smoke` PASS。
- Chromium 覆盖 UI locale 双页同步/失败恢复、Popup/Options/暗色与窄屏、Glossary 与本地词典预检/重复确认/错误恢复、Learning Center、Quick Control/Selection、字幕控件、Reading 长页历史/回访/取消的相关确定性场景；无外部 HTTP、页面异常或 Provider 隐式调用。
- 不重复未变化的外部词典下载、私有语料、真实 Provider、发布认证或其它浏览器测试。
