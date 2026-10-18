# AI 结果同步保存到学习中心和词汇本

## 用户结果

- Selection 的“理解 / 分析 / 用法”仅在完整生成后可保存；阅读记录开启时自动保存到学习中心，关闭时提供明确的手动保存入口。
- 保存失败保留当前回答并允许重试；重试复用同一 operation、turnId 与 artifactId，不重新调用 Provider，也不重复生成 Reading artifact。
- 单词或短语的完整 AI 结果可由用户明确加入词汇本，并作为独立的“AI 学习笔记”展示，不混入本地词典事实。
- 学习中心记录与词汇本独立删除。Reading 引用失效时保留 AI 笔记，并把完整回答入口显示为不可用。

## 范围与边界

- 复用现有 `reading.append-assistant`、Reading 授权和记录数据结构，不新增第二套 Reading 存储。
- 每个 AI 标签页维护独立保存状态；字典结果、其它 AI 标签和旧请求不得覆盖当前标签的保存反馈。
- `partial`、`stopped`、`failed` 或协议不完整的结果不进入 Reading 或词汇本持久化层。
- 词汇本 schema 升级为 v2：词条增加有界 `aiNotes`，v1 数据无损迁移并补充空数组；同一词条的 `understand`、`analyze`、`usage` 各保留一条，重复保存更新该条。
- AI 笔记正文最多 4000 字符并记录 `truncated`；保留 provider、model、promptVersion、providerConfigFingerprint、turnId 和可选 Reading 引用。不得保存 API Key、完整网页上下文、页面正文、词典 HTML 或完整 Provider 请求。
- 允许 AI-only 词条；仅单词或短语显示“加入词汇本”，句子和段落只进入学习中心。
- 不扩大权限，不新增 Provider 请求，不修改已完成 Provider 任务的验收记录。

## 验收

- Node/Vitest 覆盖 v1→v2 迁移、AI-only 词条、词典与 AI 笔记合并、同类型更新、4000 字符截断、失效 Reading 引用显示，以及三标签独立状态与完整结果门槛。
- Chromium E2E 覆盖完整 AI 结果自动保存、记录关闭后的手动保存、失败重试不重复调用 Provider、加入词汇本、扩展重启后两处仍可查看。
- 执行严格类型检查、受影响静态/Node/Vitest 检查、WXT 构建和 selection/learning-center/vocabulary 相关 E2E。
- 最终更新实际安装目录 `.output/chrome-mv3/`；真实 Provider、商店发布和远端同步不在本任务授权范围。
