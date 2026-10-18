# 恢复富文本词典命中后的 AI 标签与调用流程

历史单项合同，现已并入 [content-runtime-closeout](../content-runtime-closeout/task.md) 作为同一候选的一部分；当前合入状态以该任务的 `state.json` 和 `acceptance.json` 为准。

原单项记录于 2026-10-16 获得本地实现、定向验证及本地交付授权，当时未授权提交、推送、合并或发布。当前授权与验收由聚合任务管理。

- 基线：fetch 后的 `origin/main`，`c19b79dcbee3dd03d80c906ea857bae679e72ee8`。
- 历史实现分支：`fix/rich-dictionary-ai-actions-20261016`；该分支后来不再作为当前候选。
- 目标：优先富文本词典查询命中后，按 `explanationAllowed` 保留“理解 / 分析 / 用法”标签，显式点击才调用 AI。
- 实现：`controller.js` 传递现有 `explainSnapshot` 回调；`dictionary-first.js` 将可选 `onExplain` 交给初始 `showEmpty`。命中后保留已渲染节点，不重建浮层。`resolve.js` 修正只有导入 MDX、可选结构化词典缺失时，单词查询错误导致 `explanationAllowed` 被错误关闭的问题；保持 unsupported 和未知短语的既有限制。
- 边界：不改消息结构、存储、权限、Provider 配置、词典数据或 sanitizer；复用既有流式、取消、重试和划词身份校验。
- 验收：定向 Node 测试、类型检查、源码检查、WXT 构建，以及合成 MDX/mock Provider 浏览器流程；证据见 [verification.md](verification.md)。
- 非目标：先前截图中的正文空白、保存失效提示，未证实同源，不能据本修复宣称解决。

用户随后授权再次检查并修复直接相关问题，同时明确当前没有随包词典，只有两个可选的默认推荐安装项。复查范围增加：零安装应为正常空来源；已安装结构化词典不能被不存在的旧 Core/Technical 阻断；结构化异常仍先尝试 MDX；AI 切换与词典会话分别保留正确的请求身份；未配置 AI 必须退出 loading 并可恢复。当前验收与复现证据见 [audit.md](audit.md)。
