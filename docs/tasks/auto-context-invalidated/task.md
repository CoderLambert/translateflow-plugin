# 扩展重载后停止旧网页的自动翻译重试

历史单项合同，现已并入 [content-runtime-closeout](../content-runtime-closeout/task.md) 作为同一候选的一部分；当前合入状态以该任务的 `state.json` 和 `acceptance.json` 为准。

原单项记录于 2026-10-16 获得本地实现与验证授权，当时未授权提交、推送或合并。该历史分支名不代表当前候选；当前授权与验收由聚合任务管理。

范围：`src/content/auto.js` 识别失效上下文，停止当前 document 的自动翻译和缓存恢复、清理队列/观察器/定时器，只提示一次刷新；`src/content/runtime.js` 将重载后消失的消息 API 规范化为内部失效错误。保存的站点设置、缓存、权限、词典和 Provider 配置不变。普通错误继续重试，刷新网页后恢复保存的模式。

验收：定向 Node 测试；真实 Chromium/MV3 扩展重载、旧网页停止、新网页恢复；既有自动增量翻译与仅缓存恢复回归；源码检查、类型检查和默认安装包构建。详见 [verification.md](verification.md)。
