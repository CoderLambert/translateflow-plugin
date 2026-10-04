# 252 主 Agent 自查

候选 `70ad25d89ffc859a1404cb0d062649d8d10872b0`，基线已正常合入 `origin/main=fc387587fe447d804ab031eb39a9882066b14918`。PASS。

Glossary 的 global/site 范围、Origin、源/目标术语、大小写、启停、编辑与删除已由受控 React 状态拥有；`GlossarySection` 通过 typed client 复用既有后台消息和缓存 identity 合同。读取、写入和错误状态都在组件中可见，站点范围仍要求有效 Origin，不在组件内复制存储或 Provider 逻辑。

词典库的内置健康、官方/精选来源、安装生命周期、Rich 首选/展开/排序、MDD 资源、更新/修复/卸载和权限请求已迁到 `DictionarySection` / `DictionaryViews`。本地 MDX/MDD/StarDict/TFLex 的选择、预检、确认、进度、取消、重试由 `LocalDictionaryImport` 驱动；typed clients 继续调用原 controller、Worker、OPFS、quarantine 与 sanitizer 状态机。初始 effect 只读，`chrome.permissions.request()`、文件选择和安装提交仍只从用户动作到达。

旧 `LegacyIslands` 与 adapter 已删除，`options.html` 只保留固定 React root；不存在 React 与旧 DOM controller 双写。组件卸载会移除 dictionary-state listener，并 dispose controller、Worker 与 operation owner；Selection 取消回归确认旧 Rich 查询不会覆盖新选择。生产 React 代码不使用 `innerHTML`，不执行词典脚本或请求词典内远程资源。

架构边界未变化：React 仍只在 Popup/Options/Learning Center，Background/Content/MAIN/Worker 不引入 React；manifest 权限、Provider/cache/Reading schema、词典格式和远程来源未变。旧的无 DOM 所有权的词典 presentation/controller helper 仍作为复用实现与测试目标保留，不再负责 Options runtime mount。

正式证据：`npm run validate` PASS（1066 Node、25 Vitest、strict typecheck、默认 WXT）；显式 WXT 111 files / 1,731,973 bytes，platform code 1,211,910 ≤ 1,576,595，artifact fingerprint `baf77f12c442f5ca2be9572144a02e2dddf4baae17d09ce09476aa2ac19915f9`；WXT smoke PASS；Chromium 153.0.8010.12 聚焦矩阵 24/24 PASS。

历史失败保留：实现阶段首轮 Node 测试有 2 个旧静态断言仍指向 legacy owner，改为断言 React owner 后相关测试通过；这不改写首次失败。其它浏览器、真实权限提示 UI、私有目标词典和发布认证未验证。
