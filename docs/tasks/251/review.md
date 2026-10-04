# 251 主 Agent 自查

候选 `53041c66b1caddb3049bc6754c7c563e36ebc9a3`，基线已正常合入 `origin/main=a4dab127c95f4f1d3b37375fc5a7b1b5241419f9`。PASS。

Popup 已完整迁入 `src/popup/` React client/hook/App，固定 `popup.html` 路径只保留 root。页面翻译/taskId/poll/cancel、显示隐藏、移除译文、缓存恢复/清除、Preset、外观、自动翻译、Quick Control、学习中心和设置入口继续复用既有 Background/Content 协议。权限申请只在可信 button handler 调用的 client 操作中发生；初始 effect 只读状态，卸载会失效 generation、timer 与 active task 引用。

Options 固定 `options.html` / `options_page` 不变；通用、划词、外观、YouTube、站点/自动行为、Provider、缓存、开发者/关于及 UI locale 由受控 React 状态拥有。旧 `options.js`、`popup.js`、`popup-appearance.js`、Popup preset 和 UI-locale DOM controller 已删除，不存在双写。通用配置读取失败时，Glossary/词典兼容岛仍独立挂载和可恢复。

#252 边界由 `LegacyIslands` 单一 adapter 保持：模板只含 Glossary/词典 DOM，controller 在 React commit 后同步绑定 listener，再异步 refresh；StrictMode 双 mount 只启动一个 owner，pagehide/unmount dispose listener/worker。词典格式、OPFS、网络 recipe、permission、取消与 sanitizer 未重写。

安全/架构自查：source-boundaries 仅向 Popup/Options/Learning Center 精确开放 React，Options workers 明确排除；生产审计允许 React 只进入这三个扩展页闭包，Background/Content/MAIN/Worker 仍拒绝。Manifest 权限、host、CSP、extension ID、Provider/cache/Reading schema 未变。React best-practices 检查影响了实现：异步瞬时状态/generation 使用 refs，独立读取并行启动，受控字段不靠 effect 派生，global listener/legacy controllers 有对称 cleanup。

正式证据：`npm run validate` PASS（1066 Node、22 Vitest、strict typecheck、默认 WXT）；显式 WXT 111 files / 1,746,459 bytes，platform code 1,220,126 ≤ 1,576,595，artifact fingerprint `3c74b4427c06f09d974ae7d78d07e2af16f11aa505644d93a7ebed6f2da6123b`；WXT smoke PASS；Chromium 153.0.8010.12 聚焦矩阵 24/24 PASS，覆盖 UI/dark/reduced-motion/locale/Commands/Reading/词典安装安全与 Rich 取消。

历史失败保留：首轮 UI locale 5 项因旧 DOM ID/initial hidden 合同缺失 FAIL，修复后 5/5 PASS；词典首轮 3 项因 lazy adapter listener 绑定竞态 FAIL，改为同步单 owner 后 3/3 PASS。其它浏览器、真实 permission prompt UI、完整 UI 双语、#252 词典 React 和发布未验证。
