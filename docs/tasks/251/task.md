# 251 — Popup 与通用 Settings React 迁移

Parent：任务 191。硬依赖：236、249。本任务迁移 Popup 全部界面和 Options 的通用设置；Glossary 与词典库业务 UI 保留兼容岛，由任务 252 迁移。固定运行路径仍为 `popup.html`、`options.html`，不改变 `options_page` 语义。

## 用户结果

- Popup 的页面翻译、取消、显示/隐藏、移除译文、缓存恢复/清除、Preset、阅读外观、自动翻译、Quick Control、学习中心和设置入口在 React UI 中保持完整 loading/error/success/恢复状态。
- Options 的通用翻译、划词深度、外观、YouTube、站点 Profile、自动行为列表、Provider、缓存和开发者/关于迁入 React；保存/测试/清理/权限失败仍诚实反馈。
- en/zh_CN 使用现有 `uiLocale` 基础，不改变 targetLanguage/Prompt/cache/artifact；完整旧 UI 双语收口属于 253，不在本任务伪称完成。
- Glossary 与 dictionary-packs 继续使用现有 controller/worker/storage 路径和 DOM ID 兼容岛；React 不复制词典业务、文件导入、Worker 或权限逻辑。

## 安全与架构边界

1. React 只进入 Popup/Options/学习中心扩展页，不进入 Content/MAIN/Worker/background；更新 source-boundaries 和产物闭包审计的精确 allowlist。
2. `chrome.permissions.request()` 只能在真实点击/提交事件同步链中触发；初始 effect 只读状态，不能自动申请、扩大 host/CSP 或把 caller boolean 当授权。
3. 抽取 typed client/hooks 时复用现有 Background/Content message、Effective Config、taskId/cancel、站点 permission union 和 Reading fixed-open；不实现第二套 Provider/cache/task/Reading 服务。
4. 保持 Popup 关闭/卸载时 timer/listener/异步结果清理；Options storage change、hash navigation、焦点、IME、Escape、暗色、窄屏、reduced-motion 与错误恢复适用。
5. 迁移后删除被替代的 DOM controller 路径；兼容岛必须有单一 owner 和明确卸载，不允许 React 与旧脚本同时写同一控件。

## #251 / #252 分界

- #251：Popup；Options shell/nav；general、selection、appearance、youtube、sites、auto-sites、provider、cache、developer/about；UI locale 控制接线。
- #252：glossary；bundled/downloaded/installed dictionary lists；MDX/MDD/StarDict/TFLex 选择、预检、导入、偏好、更新、卸载及其 workers/controllers。
- #251 只为 #252 保留必要容器、样式与生命周期 adapter，不改词典格式、来源、权限、OPFS、取消或安全 sanitizer。

## 完成标准

- `npm run validate`、`npm run build:extension:wxt`、`npm run test:wxt:smoke` PASS，产物审计证明 React 只进入 learning-center/Popup/Options 闭包。
- React/Vitest 覆盖 Popup 任务/权限/失败恢复、Options 读取/保存/Provider test/站点/缓存、StrictMode cleanup 与词典兼容岛不被重建。
- Chromium 至少覆盖 `ui-redesign.spec.mjs`、`settings-ia.spec.mjs`、`dark-mode.spec.mjs`、`ui-locale.spec.mjs`、`commands.spec.mjs`、`reading-loop-release-a.spec.mjs` 及词典安装/取消代表场景；实际权限拒绝/授予路径不因迁移变宽。
- 更新 UI/架构文档并记录 #252 未迁移范围；不发布商店，不宣称 Edge/Firefox/Safari 或完整 UI 双语。
