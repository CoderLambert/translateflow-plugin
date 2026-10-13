# Oxford 富词条可见内容、导航与安装恢复审核

基线为 `origin/main=cbf9e3b7498a3fa36e768ffcf48146996cd4786c`，准确候选为 `42a40f190af4e6268c5a43fa0e9043242da67cfc`。实现范围集中在本地字体、静态 SVG、同词典导航、Oxford 适配交互和六文件安装恢复；index cache 总预算/LRU 按用户决定暂停。

独立只读审核由 `dev_verifier` 完成。审核发现多 record 卡片中动态 hint 可突破 card-wide 节点/文本预算；候选已在 `afa5c296` 改为按实际 card DOM 聚合计数，并用 5 个边界测试覆盖节点上限、文本上限、兄弟 hint、preview+SVG 和无 card fallback。独立复核确认该 blocker 关闭，未发现其它产品 blocker。审核 Agent 未写生产代码。

安全边界保持：词典 JS 不执行，event handler/不安全 XML 与远程 URL 被拒绝，SVG 通过有限节点重建，字体仅接受验证过的本地 TrueType ArrayBuffer，导航保持同词典/版本/selection generation，历史有界，取消后的旧结果不可回写。安装用 staging 与原子 active 切换；取消、配额、损坏附件和 replace 失败不会替换 healthy active version。

准确候选验收全部 PASS：19 个定向 Node 文件 289 项，`npm run validate`（Node 1475、Vitest 42、严格 TypeScript 与开发包），WXT 生产构建、WXT smoke、Rich MDict security 3 项、lookup cancellation 12 项，以及合并前统一 Chromium E2E 33 项；另有 1 项通用真实文件 E2E 因未设置其环境变量 SKIP。逐项命令、耗时、退出码和日志 hash 见 `acceptance.json`。

同一候选的合法私有 Oxford 六文件脱敏 runner PASS：安装、重启、`arch`/`go`、POS/radio 键盘联动、四种字体、长词条底部、关闭清理均通过，Provider 调用 0、外部词典 HTTP 0。私有路径、文件名、正文和截图未入库；仅保留角色、大小、SHA-256、环境与结果。真实 runner 未覆盖的场景和 clean/test artifact 差异已在 `acceptance.json` 明确标为 NOT_RUN，未用 synthetic 结果冒充真实 Oxford 验收。

主 Agent 对最终 diff 自查：未扩大权限/CSP/外网能力，未执行词典 JS，未把导航绑定为 Oxford 专属控制器，未清空 OPFS 规避迁移或恢复问题。任务合同依赖名已从不存在的旧名称修正为实际完成任务 `rich-multiple-records`，因此合并前仍须按 `LOCAL_WORKFLOW.md` 执行自动 gate，不采用人工替代。
