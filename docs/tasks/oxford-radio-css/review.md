# Rich radio 与 CSS 独立审核

独立只读审核者 dev_verifier，model/effort UNKNOWN；候选 `9c7b2aa67ea8809a05aac53717a40564ae405734`，基线 `a778a24f762c97933dd339c7a50bc39d99bd1610`。PASS，无剩余 blocker。完整 diff、取消/资源清理、安全/预算与 task acceptance 已核对。

真实阻断的两项修复成立：nav/section 被动包装及第五状态 class 保留；资源按 kind/canonical path/validated presentation 的实际 descriptor 去重，所有引用仍计入节点，跨 Shadow 分别累计，1024 上限及 Blob/媒体预算不升。radio/label 只在各正文 Shadow 内闭合关联，非法 group 明示纯文本；有限 AST CSS 不扩大 CSP、权限、JS 或外部 URL。

准确候选八命令及日志 SHA256 全核对 PASS：定向 Node 120、完整 Node 1340 / Vitest 40、安全 3、取消 5、Chromium E2E 17/17。实际包 120 files / 2,432,985 bytes；local-task fingerprint `183ee7a3e89a8b3e37e8e1cfb83afbe490d27f1c7f9a0567e62c2eee07371dce`，E2E inventory `6f8384252f9a0728e393794032e4073f80b13148b841f6a0d3fe3d1b13acec3e`，独立重算匹配。

主 Agent 在 Chrome for Testing 153.0.8010.12 运行真实浏览器，审核者核对报告与产物：同一六文件来源中的五支持文件，全新 profile、无诊断预热，install PASS；arch 3 / go 4 全状态、键盘、焦点、footer、无溢出及浏览器重启后复验 PASS，Provider=0/external HTTP=0。脱敏摘要 SHA256 `2161cb4b4a7864fd4f3416f0252a1cb0891b1b89c1ed88081f15a622744d7087`。tail 仅验证正文末尾存在和无内部 max-height，不代表最终长词条全面验收。

六文件全选 JS 未关联预检仍 FAIL/install NOT_RUN；字体/SVG、entry/history、Oxford 专属交互和失败恢复仍待后续，不关闭 #271–#274。旧候选失败记录保留，不改写为当前 PASS。主 Agent 自查核对 Shadow 内控件关联、累计预算、fallback 和取消清理；此段自查不标独立审核。
