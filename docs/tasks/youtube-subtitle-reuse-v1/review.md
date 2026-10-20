# 字幕可靠性切片的合入前自查

主体：主 Agent；本记录是自查，不是新增独立模型审核。候选为 `a64f77215d3f7703105f82ffa8406689d422d895`，版本 0.8.44，范围以 task.md 的“当前交付与同步授权”为准。

- 核对实际提交与调用链：沿用 Provider、coordinator、DB4 和配置身份；请求在配置/缓存 await 之前登记取消资格，后续阶段检查；已开始的持久化提交不承诺回滚。
- 当前及预翻译共用既有 pipeline；视频/轨道/配置/seek/模式撤销保持隔离。定时 cue 按当前身份和媒体时钟展示；DOM 仅保留当前仍包含的完整原文短语。
- 原生控制栏入口在齿轮直接父容器绑定，覆盖真实新版嵌套结构和重建；观察器及文档事件随 unmount 清理，Escape 返回焦点。真实页面已验证 0.8.43 同源码包，0.8.44 候选有正式 MV3 回归。
- MAIN 精确源码仍为 `e3f2fbd694211778b329bd3469b96f3a515fbd70d1864b454e387cf8cbefeafe`，复用已有专项独立审核，不扩大 MAIN/权限边界，不接入上游 GPL 代码。
- 正式 `validate`、显式 WXT 构建、四文件 27 项 Chromium 回归均 PASS，退出码 0，时长/日志摘要由 acceptance.json 绑定。dist 与显式 WXT 包逐文件 inventory 相同。
- 额外通用 smoke 为 FAIL：`scripts/smoke-wxt-extension.mjs:66` 没有为 mock Provider 设置 `translationPreferences.textMethod=ai`，落入默认 free-MT 同意检查而返回 `MT_CONSENT`。该 fixture 与 origin/main 完全一致；任务规定的字幕与 Chrome-local MV3 路径已经通过。将其作为既有 fixture 问题保留，不改默认方式/同意或放宽断言，不把这次失败记作 PASS；第二目录通用 smoke 未执行。后续 AI 接入兼容任务会补此 fixture 的明确方式选择。

自查结论：授权切片没有发现新的合入阻塞；允许按本地 gate 与远端实际保护合并。完整字幕升级、全场景真实播放/模型、翻译质量认证和商店发布仍未完成，不能由本次合并或 mock 结果代替。
