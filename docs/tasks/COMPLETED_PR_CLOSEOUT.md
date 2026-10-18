# 已完成 PR 与任务记录整理（2026-10-19）

本次由用户明确授权合并已完成成果，并清理完成任务；不发布扩展、不继续未验收产品模块。

| PR | 合入事实与范围 |
| --- | --- |
| #346 | `1c46d76417bae1c4415cc4c7a39be73aa471b28b`；移除内置词典，原 gate 与完整 tree 核对通过。 |
| #347 | `e7fdfa5ce5d69a289785679147988c4ba62f1d37`；本地并发10/CI2、专项串行、零重试与证据隔离。同步 head `77a4a90f7d426d57c5bb27d495cf3e98b249ae3b` 的 tree 与 main 合入提交相同。 |
| #343 | `7cf5f4b596292e7843f3427ec8a14eca3d851184`；仅归档 V1/V2 历史设计，明确不是当前执行合同，不启动 #342 或后续模块。 |
| #325 | 本次 README 与完成记录归档：保留当前四协议连接、可选本地模型与用户词典行为，修正 DB4 缓存说明。最终提交及 squash 合入事实以该 PR 记录为准。 |

#347 集成候选 `749af4e6`：完整 validate PASS（1793 Node、62 Vitest、严格类型/静态/构建）；一次完整 E2E 为207 PASS、2 FAIL、5 SKIP、18未运行。修复只改两个测试的异步等待：Reading 实际 append 和浮层 clamp。`77a4a90f` 定向8 PASS，补跑专项17 PASS/1 SKIP；去重有效226 PASS/6 SKIP。原失败与旧候选绑定保留，不改写成新候选全量执行。新候选双目录 smoke、构建、check和本地gate均PASS。六项SKIP需要真实词典/归档或大型MDD输入，不代表发布认证。

校准的旧状态包括：#330 rich-local-fonts、#331 chatgpt-native-host-distribution、#332 api-key-provider-connections / selection-ai-result-saving / sync-current-worktree。仅更新真实mergeHead、PR和交付事实；原candidateHead、命令、限制与历史失败保持原样。#332 的阶段性同步完成不等于 browser-basic-translation 的真实模型/离线/质量合同完成；Native Host 公开分发仍缺真实商店ID、签名和干净系统安装验收。

保留未完成范围：#342 免费机器翻译当前head未验收；#191/#229等更宽Epic、真实词典完整认证、索引缓存预算、用户原安装资源恢复及原工作区未提交任务继续按原状态保留。没有删除其代码或用状态整理替代人工验收。

远端分支清理只接受head仍匹配已合并PR、且merge提交为main祖先的分支。本地原head保留在 `refs/archive/completed-prs/`；已完成worktree归档保留所有文件（含忽略文件），不以强制删除丢失用户资料。原始日志、输入与包指纹、路径映射和实际清理结果仅在本地忽略的 `docs/task-execution/local/completed-pr-closeout/`。本次没有触发Actions、合并#342或发布商店版本。
