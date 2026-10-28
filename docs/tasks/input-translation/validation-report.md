# 本地交付：输入翻译与品牌图标（0.8.55）

基线 `43405db082ad13eb234e64ef1bead9cdadce8c25`，分支 `feat/unified-reading-polish`。用户已授权实现，并在开发中要求加入提供的图标资源、停止重复自动测试、完成后直接交付人工试用。本轮完成本地提交和安装包，不推送或合入。

## 交付内容

- Popup 顶部独立「输入翻译」入口，可从受保护页面打开；重复点击聚焦现有小窗。提供可自行绑定的 Chrome command。
- 原生 TypeScript 小窗使用既有设计 token，支持目标语言、已有 AI 服务选择、输入/粘贴、可选翻译要求、复制、单条调整、重新翻译、停止与原地重试。新文字不带无关历史；修改仅携带指定原文/译文与要求。Enter 换行，Ctrl/Cmd+Enter 提交，IME 组合期间不提交。
- 复用有效配置解析、严格译文校验和既有 request coordinator/Provider 生命周期；完整结果校验通过后显示。新 Port 只接收固定受信扩展页，取消、断开或关闭后不回写旧结果。无持久翻译缓存、Reading 或词典写入。
- 草稿和最近 20 条结果保留在 trusted session storage；关闭后可恢复，未完成项标记中断，不自动重发；清空需确认。配置读取失败可重试，原文超限不截断发送。
- 用户图标包的 16/32/48/64/128px PNG 原样放入 `assets/icons/`，接入 Manifest 工具栏/管理页图标、扩展页 favicon、Popup/Options/输入小窗/学习中心品牌位、网页 Quick Control、划词入口和 YouTube 按钮。
- 打包继续使用精确资源映射。网页只额外暴露 `assets/icons/icon-64.png`，没有新增权限、远程资源或整个图标目录暴露。

## 已执行与证据边界

原始日志位于 Git 忽略目录 `docs/task-execution/local/input-translation/`。

在用户要求停止重复测试之前：

- `node --test tests/input-translation.test.mjs tests/commands.test.mjs tests/wxt-assets.test.mjs tests/i18n.test.mjs tests/i18n-locales.test.mjs`：31 PASS（`node-final.log`）。窗口修复后后台专项 9 PASS（`window-fix-node.log`）。
- `npm run test:unit`：15 文件、91 PASS（`unit.log`）。
- `npm run typecheck`：PASS（`types-final.log`）。
- Chromium 首轮 7 场景：5 PASS / 2 FAIL（`browser.log`）。一个是真实重复开窗问题：无广泛 tabs 权限时 URL 查询无法发现已有扩展页，改为精确扩展 context 查询，并提供老版本 session 窗口句柄回退；另一个是 fixture 迁移生成两个服务，与测试预期不一致，改用明确单连接 fixture。
- 修复后输入小窗三个完整场景 PASS（`browser-retest.log`）：受保护页/单实例、翻译/调整隔离、剪贴板实际复制、会话恢复/清空、失败重试/停止/关闭、服务选择、超限、IME、窄屏明暗主题。主 Agent 复核了当时的空态、结果和暗色窄屏截图。这些截图在品牌图标接入之前生成。
- 早期静态检查发现 CSS 入口依赖和 router 行数边界，已调整；后续源码检查通过，但 i18n 检查因新增 command 的 locale 文件未生成而失败，随后按现有生成器更新，相关 i18n 单测通过。没有将失败日志覆盖为 PASS。

按用户最新要求，**图标整合后未再执行自动测试、类型检查或浏览器验收**；由用户试用最终图标版。最终执行 `npm run commit:prepare`，0.8.55 编译及构建内置 Manifest/资产审核 PASS（`build-icons.log`），准确暂存 tree 为 `70542b58a09fe3742042880802785f6594a7d77c`；其后只增加本报告及任务状态/索引，不改变构建输入。

主 Agent 对照代码和任务自查：入口不依赖页面注入，模式和 Provider 选择不改全局配置；模型文字以文本节点显示；session 与长期历史分离；图标源和打包路径一致。这是主 Agent 自查，不是独立审核。

## 人工试用

重新加载 `dist/extension/`，刷新已打开的网页后查看新图标。点击 Popup「输入翻译」，输入一段文字，试用复制、继续调整及关闭重开。真实模型效果、最终图标在用户常用网页的展示和旧版 Chrome 回退尚待人工验证；本次不声称全量验收或正式发布完成。
