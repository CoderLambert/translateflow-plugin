# Release A 主 Agent 自查与 NO-GO

候选 `215759f8a050448287140efccd1f1f6918fb5141`，main 基线 `b606cfd556792d9764d0b15461b7a142fcd99575`（#235 / PR #285）。主 Agent 自查，不标为独立终审。仅本地验收/最小修复，#236 未推送、PR、合并或发布。

## 结果

当前候选 `check`、严格 TS、11 项学习中心 Vitest、实际 WXT 构建 PASS；完整 `npm run test:e2e` **148 PASS / 1 FAIL / 6 SKIPPED**。实际包 240 文件、38,634,174 B，其中既有词典 36,830,492 B；Manifest 无差异，React 只在学习中心。日志、耗时、精确包指纹、原始证据 hash 见 acceptance.json。

完整 validate 在候选 `8a972fc7546f39201e83606eb9e54738981c4018` PASS（1034 Node、15 Vitest、TS、WXT），耗时 58.634 s。其后真实 Escape 测试发现焦点在 hash 导航/订阅重连期间恢复过早。只改 App.tsx/useLibrary.ts：列表暴露已完成读取状态，待连接、列表与详情请求稳定后一次恢复原记录/列表入口焦点。修复后原失败的真实键盘用例 PASS，完整 E2E 也 PASS；Node/底层合同输入未变化，旧完整验收保持原 head/log，不伪称当前 head 重新跑过完整 validate。当前 check/type/Vitest/build/E2E 全部重新绑定；没有修改后台、权限、数据库、消息 schema、缓存、Provider 或词典内容。

## 产品证据

- 真实 Selection → LC 信任点击开启 → 返回有效卡显式保存，以及新查询自动保存，创建 4 条真实记录：hit/no-hit/翻译/cache/完整 Explain。只有 2 次明确 mock Provider 操作，历史 0 次。完整 profile 重启后不可变快照/问答/source 保持一致；移除测试词典、Provider 配置并断网仍可读。
- 合成 canonical corpus 1,439 条，实际持久化 67031498 B，UI 导出 67092027 B / 256 chunks；单个完整消息最大 342508 B（≤1MiB）。全部下载行、来源引用、Unicode/转义、序列和字节都核对，未用此 seed 替代真实创建故事。
- 实际 worker 停机和页面退出没有残缺下载；10,000 条容量状态经真实 UI 删除恢复为 9,999，授权仍 enabled。恶意回答 script/img 按文本显示、0 外部请求；Escape焦点、双语不改历史、composition Enter、防溢出 CSS200%/暗色/reduced-motion 实际浏览器通过，截图已查看。
- 原生 DOM 10 样本：89 chars / 4 nodes，sync 中位 0.350 ms、范围 0.100–5.400 ms；runtime deadline 8 ms，观测样本均在预算内。1.1M 字符巨节点 sync 0.600 ms、612字符合法上下文/无精确位置，动态小节点恢复 resolved。机器 AMD Ryzen5 7530U / 12逻辑CPU / Linux x64，非通用性能认证。

## 唯一未满足项

**NO-GO / physical extension Origin quota NOT VERIFIED。** Chrome `153.0.8010.12` 的 overrideActive=true，报告 quota 448205 B，实际 usage 945332 B；512KiB 随机不可压缩 native IDB 事务仍 completed=true，没有 QuotaExceededError。已关原 Reading 页面并停止 worker，再设置 quota、重新打开连接；这不是仅压缩重复字符串没超过物理额度的假失败。旧产品 read/export/delete 均可用，但不能推导发生真实拒写后的恢复。

该断言保持 FAIL，不 skip/过滤/提高额度来宣称通过。localhost Native IDB quota PASS 和注入 QuotaExceededError 的真实 UI not-saved/retry PASS 分别保留标签，不能充当扩展 Origin 物理拒写。没有填满宿主磁盘、扩大权限、清空用户数据、改生产预算或用假的错误签发 A_PASS。

6 SKIPPED 为旧/新包专项注入/升级 3 项和真实词典专用输入/one-click 3 项；未变化的既有资源从235复用，不重新下载/编译/认证。Chrome102/其它浏览器/实际桌面IME/真实模型及文件保存结局未验证。

任务状态 blocked，未记录 READING_LOOP_A_PASS。当前系统缺乏可观察的扩展 Origin quota 原生拒写，需可复现的环境机制或明确验收裁定后继续；其它 PASS 与准确 head/包/日志保留。主 Agent 自查不替代外部必需/人工验收。
