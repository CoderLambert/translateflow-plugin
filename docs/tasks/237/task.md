# 237 — Reading 站点标记权限、注册与安全 handoff

Parent：本地任务 229（Reading Loop）。硬依赖：236 已合入。历史引用：`#237`；本地合同与证据为当前事实来源。

## 用户结果

- 用户可在学习中心对有安全回访地址的记录发起“安全回到原页面”；后台只打开经持久记录再次核对的精确 HTTP(S) 地址，并把一次性 handoff 绑定到实际新建 tab 与目标文档。
- 用户可单独开启或关闭某个站点的 Reading 标记意图。该意图与记录总开关、站点排除、自动翻译、缓存恢复和 Quick Control 相互独立；站点权限被拒绝或撤销时保留意图并显示可恢复的 `permission-required`。
- 目标 Content 只获得当前页最小 `PageSummaryItem`。本任务不实现选文定位、绘制高亮或本页历史列表；这些属于 238/239。

## 范围与边界

1. 在现有 Reading protocol v2 中启用 `create-handoff` / `consume-handoff`，并增加仅用于站点标记意图的窄 `get-site-markers` / `set-site-markers` 合同。协议投影仍由 `scripts/reading-contract-classic.mjs` 从共享合同生成。
2. `create-handoff` 仅允许精确受信任、非隐身的学习中心调用。后台从 Reading repository 原子读取记录、revision、page/site policy generations 与 `safeReturnUrl`；无安全地址/能力返回 `unsupported`，无有效站点权限返回 `permission-required`。
3. 后台创建目标 tab 后，handoff 只保存在 service worker 内存，TTL 不超过 60 秒，不写 URL/token，不放入网页地址。目标 Content 必须以真实 sender/tab/document/page 身份注册并一次性消费；redirect、额外导航、删除、清空、暂停、站点排除、权限撤销、超时、重复消费或 worker 重启全部失效。
4. `readingMemorySites` 只保存显式站点意图，保留包含有效端口的 canonical origin。学习中心真实点击可直接调用 `chrome.permissions.request`；后台只能 `contains`，不能伪造用户手势。关闭 Reading 标记不得撤销或清除其它功能仍需要的权限/状态。
5. 不新增 `tabs` / `webNavigation` / optional host 等 Manifest 权限，不修改 Provider、翻译缓存、词典、Reading DB schema/version，不执行网络请求或隐式 Provider 调用。

## 验收

- Node 合同/服务测试覆盖：scope、精确 record revision、safe URL/page/site 一致、真实 tab/document 绑定、一次性并发消费、redirect/navigation/tab remove、权限撤销、记录/策略代际变化、60 秒边界、worker-local 重启失效、带端口站点意图与其它 auto-site 状态隔离。
- React/TypeScript 覆盖 loading、ready、permission-required、unsupported、disabled/changed/error 退路，以及 en/zh_CN 同键；不把打开 tab 描述为已经定位。
- 实际 WXT Chromium 流程：真实记录 → 学习中心 → 安全打开原页 → 目标 Content 消费最小摘要；回访和站点意图不新增 Provider 调用，生产 Manifest 权限不扩大。
- 合入前执行 `npm run validate`、`npm run build:extension:wxt` 和聚焦 `npm run test:e2e -- e2e/reading-handoff.spec.mjs`，绑定准确候选与构建 fingerprint。

## 明确不做

- 238 的 quote/position 唯一匹配、滚动与历史卡；239 的自动 marker 绘制、本页列表和 SPA 恢复。
- 模糊定位、URL 携带 record/token/正文、自动申请权限、重新查询 Provider、扩大 Manifest 权限、发布或商店操作。
