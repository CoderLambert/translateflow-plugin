# 划词浮窗半挂载恢复与候选回归修复

用户截图的 `Cannot read properties of null (reading 'removeEventListener')` 属于扩展更新后旧脚本继续运行的一类错误。0.8.64 已在 `src/content/ui/primitives.js`（失效 `getURL` 不再抛错）和 `src/content/selection/popover.js`（`panel?.removeEventListener`）修掉该崩溃，但半挂载状态仍有两个缺口：一是 `ensureUi()` 认为"root 已连接"就等于可直接复用，挂载中途抛错会留下无法自愈的浮层；二是本候选（`98218db2`）自身有两个与本修复无关的回归失败，会阻碍"可下载最新版本"的交付。

范围：

1. `src/content/selection/popover.js`：用 `mounted` 记录挂载是否完成，`ensureUi()` 发现"root 已连接但未完成挂载"时先走 `hide()` 清理再重建；`hide()` 复位该标志。不改变健康路径的创建、定位、关闭行为。
2. `tests/content-ui-reload.test.mjs`：新增"浮层已挂载后中途失败可回滚且下次重建"的真实源码回归（修复前失败）。
3. `src/content/reading-record.js`：用锁定的 esbuild 0.28.2 重新生成经典投影，消除 `reading-content-classic` 的 stale 失败（生成结果确定性一致，仅压缩标识符重命名）。
4. `tests/quick-control-position-controller.test.mjs`：补 `quickControlElements` 让真实 Quick Control 控制器加载（此前断言落在"升级后提示刷新"的占位实现上），并新增该占位路径的显式回归。

不做：不改变 Provider、缓存、权限或消息契约；不引入第二套清理机制；不清空用户数据；不把"刷新旧页面"作为代码修复的替代。

验收：受影响单测与全量 Node 测试通过；`npm run check` 通过；构建产物包含修复且真实失效上下文场景不再产生该错误记录。
