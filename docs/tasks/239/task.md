# 239 — Reading 再访 marker、本页历史列表与 SPA 恢复

Parent：任务 229。硬依赖：238。历史引用：`#239`；以本地合同/证据为准。

## 用户结果

- 对已明确开启 `readingMemorySites` 且仍有有效站点访问的普通页面，再访时自动读取当前页最多 200 个最小摘要，在唯一可信 Range 旁显示低干扰 marker，并提供键盘可用的“本页历史”列表。
- 列表始终可呈现 resolved / ambiguous / missing / not-loaded / unsupported，marker 只为 resolved；点击 marker 聚焦列表项，点击列表项滚动到原文，查看记录打开准确学习中心 deep link。
- DOM 节点替换与 SPA 前进/后退后重新注册真实 document/page 身份并有界恢复；关闭意图、站点排除、权限撤销、断线或导航立即清理 UI/Range/listener。

## 边界

- Content 只调用 `get-site-markers`、`get-page-summary` 等当前页最小读取；不得列举其它页、读取详情、写记录、调用词典或 Provider。
- 批量 resolver 共享一次页面投影、root/digest cache 与 250ms/25k nodes/1M UTF-16 总预算；每页最多两次 100 项读取、最多 200 markers。禁止逐条 250ms 扫描、fuzzy 或 first-match。
- UI 只在 Shadow layer，marker 不包装正文、不拦截链接/拖选；滚动/resize 更新位置，Escape/close/route/disconnect 清理资源。
- 不修改 Manifest、Reading DB/cache/Provider；不实现 AI 助手或 240 综合验收。

## 验收

- Node/DOM 覆盖批量唯一/重复/预算、无选区 page proof、generated classic 单源映射。
- 实际 WXT Chromium：真实保存并开启 marker → 新 tab 再访 marker+列表 → DOM replacement 恢复 → SPA 离开清理/返回恢复；Provider calls 0。
- 合入前运行 `npm run validate`、`npm run build:extension:wxt`、`npm run test:e2e -- e2e/reading-page-markers.spec.mjs`。
