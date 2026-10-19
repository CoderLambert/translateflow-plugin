# 免费在线机器翻译：MT01 / MT02

授权：用户于 2026-10-16 明确要求基于最新代码直接开发已审核的免费在线方案。
基线：main@961a3757f3cad93921031b038e52e621c8c840b7。

## 交付

微软 Edge 网页翻译和腾讯交互翻译的完整网页、划词入口；无需 Key。
保留 legacy 默认，独立选择免费文字翻译；AI 详解/追问、字幕、词典仍走原有路径。
复用任务、取消、配置快照、缓存、安全富文本重建和 Reading translation artifact。
失败不切换其它供应商、AI 或本地模型，不自动下载模型，不新增服务端。

## 最新基线与缓存架构（2026-10-19）

当前唯一生产缓存协议是已合入 PR #345 的 DB4（`entries` / `epochs`）+ 单一记录 envelope v1。此免费 MT 模块**仅调用既有 cache facade/业务 identity**，保持 `src/background/cache/storage-indexeddb.js` 唯一缓存 IDB owner。不改变物理 DB、记录解析或旧记录清理流程；M0 只引入 `machine-translation` 引擎身份、固定服务/语言方向/输入协议/保护结构的独立缓存指纹。

本任务基于最新 main（包含 #345/#346/#348/#350），在独立整合分支完成冲突处理后才更新原 Draft PR #342。最初 `main@961a3757` 和 DB3 方案只是历史基线，严禁将旧 `cache-db.js`、DB3 升级 fixture 或内置词典引用带回新实现。

## 兼容约束

- 不改写 AI 凭据、Provider 连接/defaultService；机器翻译是用户显式同意的独立配置，没有权限或语言不支持时失败，不能回落到收费 AI。
- 站点原有显式 AI 优先级及用户词典、Reading、字幕、Chrome 本地模型、快捷悬浮球位置必须保持。不得恢复 #346 删除的内置词典。
- 免费 MT 不外发内部控制 marker、code/kbd/pre 等受保护 DOM 字面及链接 URL。Page 走已有 rich/protectedIds；Selection 显式拒绝无法安全确认的受保护选区。
- DB4 有效 config/request identity 按 provider、真实输入、format/保护、source/target 和策略版本隔离；cacheOnly 0 Provider 请求，取消/页面变化旧结果不可回写。
- Provider HTTP 仅固定微软/腾讯非付费网页接口，15s 超时、512KiB 响应限制、限流冷却、不携带 API Key/Cookie/重定向。
- 本轮不新建翻译 DOM/Provider/缓存框架，不添加 Google 或额外模型下载逻辑。真实腾讯可用性需要当前用户网络验证；Mock PASS 不可冒充。
## 范围

shared 配置与身份，background 路由/快照/MT adapter，Content 结构元信息传递，
Options/Popup/Quick Control 的最小入口与真实服务状态，以及定向测试与使用说明。
只重新实现已核对的 HTTP 协议，不复制 FluentRead 框架或源文件。
Google、B站及自动跨供应商调度为后续独立任务，不显示未实现的服务。

## 验收

以 state.json 中实际命令和 acceptance 记录为准。必须验证：旧配置、Reading、用户词典与凭据保留、**沿用已合并 #345 的 DB4 升级结果，不再次清空或迁移现有 DB4 缓存；验证新 MT 身份可写入/读取且 cacheOnly 不联网**、
免费模式不受未配置/失效 AI 影响、词典优先、取消与切换、富文本、业务错误、
限流、记录来源与本地回看。真实供应商联网测试与 mock E2E 分开报告。

本环境普通 Git/DNS 不可用，使用临时分支工作流导出公开源码和锁定构建依赖；
不含凭据，临时工作流在最终功能差异中删除，不改变项目日常手动验证策略。
