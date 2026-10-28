# Popup 本地预览与验证

基线：main `d5b0e411dbe0195fb6dd179a2c17af196a211f83`。工作分支：`feat/popup-polish`。本轮为未提交的本地 UI 预览，包版本仍为 0.8.50，不宣称已合入或发布。

## 用户可见变化

- 页面摘要合并为紧凑卡片；相同服务名/模型名只显示一次，长名称省略并提供完整 tooltip；默认/自定义模式本地化。
- 翻译方式保留原生可访问表单，去除重复标题与当前方式描述；用状态标签区分默认继承、本站覆盖和待应用。联网同意、权限与草稿保存语义不变。
- 使用统一内嵌线条图标、圆角、边框、字号和清晰的键盘焦点；保留暖米色/鼠尾草绿，支持暗色和减少动画。
- 翻译、取消及错误提示集中在不随内容滚动的底部操作区。运行时显示实际进度与加载状态；确认取消后才显示已取消。
- 学习中心保留文字入口并上移到高级设置之前；自动翻译/外观文案更简洁；读取、权限或保存失败时保留可恢复入口。去除初始错误语言的 Ready 重复状态。

关键文件：`src/popup/App.tsx`、`MachineTranslationControl.tsx`、`PopupIcon.tsx`、`usePopup.ts`、`popup.css` 和 `src/i18n/catalog-base.js`。Provider、缓存、权限和翻译解析没有改动；用户已跳过的译文残片问题不在本次范围。

## 实际验证

- `npm run check`：PASS，静态/i18n。
- `npm run test:unit -- tests/unit/popup-react.test.tsx`：9/9 PASS，含真实取消状态、草稿、拒绝授权/保存失败、关闭时隔离。
- `npm run typecheck`：PASS。缩短文案后曾有旧占位参数的类型错误，已修正；原失败保留在 `types-first-failure.log`。
- `node --test tests/popup-ux.test.mjs`：5/5 PASS。
- `npm run build:extension`：PASS，本地包位于 `dist/extension/`。
- 相关 Chromium 场景共 11 个通过：常规 10 个有效结果复用，原生 Popup 用例单独修正测试适配后通过；随后仅补验新增自动翻译开/关和键盘取消交互，PASS。没有重复全仓测试。

浏览器覆盖中文/英文、明暗色、360×580 与 360×420、长名称、键盘焦点/披露/取消、减少动画、操作按钮可点击、授权与保存失败反馈、翻译/显示隐藏/移除/零请求缓存恢复、学习中心和设置入口。开启自动翻译后实际出现译文，关闭后开关状态正确。

原生工具栏 Popup 使用 `chrome.action.openPopup()` 打开，通过扩展自身的 popup view 核实实际布局。测试最初错误地等待普通 page 事件，后又把 Chrome 外层视口等同于文档宽度；这两次失败保留。最终断言内容宽 360px、无内部横向溢出、底部操作可点击。Chrome 在当前 headless 屏幕高度限制下为外层预留滚动条空间，实际外层视口 375×510，按钮底部仍在 510 内；不是通过放宽内容尺寸要求掩盖溢出。

## 截图与安装包

原始日志与截图均在本地忽略目录 `docs/task-execution/local/popup-polish/`：

- `popup-before-user.png`：用户提供的原始截图，含浏览器外框，非相同测试数据的像素对照。
- `popup-light.png`、`popup-dark.png`：新界面，使用合成页面和本地 mock 服务。
- `popup-short-expanded.png`、`popup-long-name-english.png`：短窗口、展开内容及长名称。
- `popup-running.png`、`popup-cancelled.png`：运行与确认取消。
- 权限/保存错误截图位于 `docs/task-execution/local/translation-method/`，底部提示可见性已验证。

已逐项自查截图与生产 diff；这是实现者自查，不是独立审核。新的 E2E 通过扩展真实消息/存储路径配置合成数据，没有修改生产包来伪造界面。

安装包为独立工作区里的本地预览，旧 0.8.50 正式包保留。未执行远端提交/合并、商店发布、真实付费服务或用户现有浏览器 profile 操作；未运行无关的全仓 E2E。
