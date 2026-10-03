# [Platform][PF-01][P0] WXT 兼容构建、入口与本地资源桥接（不改产品行为）

历史引用：[#246](https://github.com/CoderLambert/translateflow-plugin/issues/246)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

## 执行卡
Parent #191；硬依赖 #245；规划待启动，不自动加 agent-ready。难度 L3。主写 platform-build 高推理；独立 reviewer 审查 Manifest、加载上下文与构建副作用。主协调者独占 package/lock、wxt.config、入口配置和构建脚本。

## 目标
从现有唯一源码得到可以实际加载的 WXT Chrome MV3 产物，同时保留旧构建作为短期对照。不是建立第二份插件或全仓 TS/React 重写。

## 必须实现
1. 按 #245 实验通过的版本引入 WXT、Node/npm 约束、package-lock 与 prepare 步骤；Vite 使用 WXT 兼容组合，禁止强行升级其内部 major。开发 `dev`、临时 `build:extension:wxt` 的命令在本 PR 实际定义，生产默认 `build:extension` 暂不切换。
2. 建立 background/popup/options 的 WXT 入口，保留原 popup.html/options.html 可访问路径。背景入口复用 `initializeBackground()`，listener 同步注册；检查它的传递依赖在 WXT Node 构建环境无 chrome/window 副作用。不以运行时动态 import、延迟事件注册、eval 或 fake chrome 全局掩盖初始化问题。
3. Content、YouTube MAIN-world、现有 Worker/隔离展示资源先使用精确的 legacy asset bridge：从唯一源路径复制到同路径，保持既有加载顺序与 CSP。新 UI 资源由 WXT 正常编译，不再维护源码拷贝。桥接清单必须可审计且有移除任务 PF-05，禁止将整个 src/仓库/node_modules 当 public 目录。
4. `auto-sites.js` 继续作为唯一动态注册 owner。保留手动 activeTab 注入、站点授权、三个已有自动意图的 union；WXT 不自动生成全站静态 content_scripts。之后使用 WXT runtime-registration 时也不增加第二个注册器。
5. 冻结/实现小型源→运行时资源映射，供 runtime 与测试共同读取需要的产物路径。Worker 相对模块依赖、getURL、MDD/词典 package assets、MAIN-world 三脚本顺序都必须解析；不为缺文件扩大 web_accessible_resources。
6. JS/CSS target 显式遵循 #245，Manifest 主版本/permissions/commands/后台类型等结构化差异有断言。开发期 HMR/localhost/WXT 辅助权限或连接不能泄漏到生产构建。
7. 保留已审核内置词典生成流程，不在正常构建中隐式联网下载；dev 可缺资源但有诚实提示，release 模式必须要求既有认证的资源。输出统计区分代码与词典字节，不把 source-lock/原始语料带入安装包。
8. 精确修订 AGENTS/CONTRIBUTING/ARCHITECTURE 对已批准 WXT 入口和 UI 编译的约束：未迁移 Content 仍保持当前 classic 边界；Provider、本地词典、存储与权限规则不放宽。PF-02 后续加可执行新检查；#233 的 ReadingRecord IDB 例外仍由其 owner 负责。

## 验收
- [ ] 干净安装依赖后，旧构建与 WXT 构建都能生成且输出目录互不覆盖。
- [ ] 生产 WXT 包可启动后台、Popup、Options、查词与正文翻译；附实际 smoke，未跑则不称可用。
- [ ] Manifest 只有已记录的允许差异；无新增静态全站注入/required permission。
- [ ] 所有 Worker/MAIN/词典路径可达，调用既有模块，不包含重复产品实现。
- [ ] 生产无 dev server、远程脚本、私有字节和未登记资产；失败构建不破坏旧包或用户数据。

## 验证与边界
运行当前 validate、实际新增 WXT build、Manifest/asset 检查和有限真实 Chromium smoke。完整双产物 E2E及旧用户升级由 PF-03 完成；不得用旧 harness 测试绿灯代替 WXT 验证。本任务不宣称完成平台迁移、不切默认发行、不提交商店。
允许一个聚焦 PR；如果拆两个 commit/PR，第一步只增加 opt-in 工具链，第二步产物才算任务完成。零业务 schema/Provider/词典解析更改。

## 官方依据
https://wxt.dev/guide/essentials/entrypoints.html
https://wxt.dev/guide/essentials/assets.html
https://wxt.dev/guide/resources/migrate.html
