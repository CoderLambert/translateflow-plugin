# 最新 main 集成自查

主体：主 Agent 自查，不是独立模型审核。候选：`c8b5b59b91cfaa51f2ab261df7670f3fa8d5f1c2`。

## 集成范围与分支去重

- PR #363 已按准确 head squash 合入 `7a2c9ed1f367a22cf3ddda9426d67067732b7669`；合入 tree 与本地元数据验证 tree 完全一致。状态 blocked 如实表示历史证据未归档，没有改造成 completed。
- 本候选包含 PR #371 公开/ChatGPT 开发版分离、8920ca2 的旧预算提示移除、b9ea931/2e7c394 的原文标记辅助模块与测试。
- Ollama、YouTube 和完成记录已在 main；核对后的 Ollama/完成记录分支最终 tree 与初始 main 完全相同，不重复回合。近期其它分支中不存在未合入的新增源码文件（上述辅助模块除外）；历史已合并/被后续改动替代的整条分支未回灌。
- 当前旧主工作区及其未跟踪文件、旧安装包未覆盖。

## 已修复的验收发现

1. 新增 TSX 使用 `globalThis.chrome` 不在本仓严格类型声明中；改用已有的 `typeof chrome` 守卫，未扩大声明或关闭类型检查。
2. 升级时历史注册脚本列表没有 `youtubeCaptionDom`，导致 YouTube source/controller 不注册，进一步让 Content 入口抛错。只在该旧列表过渡期禁用缺失的 DOM 字幕 fallback，继续 TextTrack/timedtext 并保留原生字幕；刷新后恢复完整模块图。保留不可变旧注册 fixture 和原测试断言。
3. Anthropic 浏览器流程仍要求公开版显示 ChatGPT 登录区，改为根据真实 manifest 校验公开说明或开发版入口；翻译请求次数、凭据隔离、持久化和清除测试均保留。
4. 首次 smoke 缺 `.wxt/reports/asset-map.json`，补跑仓库明确要求的 `build:extension:wxt` 前置，不伪造映射或降低审计。

## 边界核对

- 公开/开发判定取自实际 manifest 精确 version_name；shared 只接收参数，不读取 chrome。公开包 Provider 路由和 ChatGPT action 路由均先拒绝订阅调用。
- 已保存订阅配置保留，公开版提示开发版入口；无自动切换其它付费 Provider、权限扩展、缓存格式变化或数据清理。
- 开发版由同一 WXT 输入生成，独立输出目录；raw asset 范围不变，旧体积预算移除不放宽资源/源码/权限审计。
- 原文辅助合同未接入 Provider 或缓存运行链路，不宣称其修复了 AI 翻译失败。
- 新 GitHub 构建入口改为仅 workflow_dispatch，遵守现有仓库手动验证约定。

最终验证结果见 acceptance.json 与 validation-report.md；首轮失败保留在 Git 忽略的本地证据。真实账号 OAuth/套餐、真实付费 Provider、真实用户网页、商店发布与用户现有浏览器安装身份未验证。本任务先交付最新测试包，可靠性审核继续绑定该版本，不把旧版合成复现当作用户真实根因。
