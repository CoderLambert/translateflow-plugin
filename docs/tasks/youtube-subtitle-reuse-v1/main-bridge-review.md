# MAIN bridge 固定闭包的聚焦安全审核

范围：基线 bf37935f04ef6271ef8d3b5780142ac8d65c3600 之后的同视频轨道身份修复。审核由 dev_specialist 只读执行，主 Agent 串行修复；不是整个分支独立审核，也不替代真实 YouTube 验收。仅因 scripts/source-boundaries.mjs:18-24 对此例外明确要求独立审核而执行，没有安排验收后的第二轮全分支模型审核。

初次审核指出并复现两项 P2：有语言但无 kind 的 human URL 借用同语言 ASR 身份；URL 解析异常阻断网页原 fetch。主 Agent 分别新增失败回归并修复，见 bridge-review-red.log 与 bridge-review-green.log（本地忽略目录）。

复核结论：P0=0 / P1=0 / P2=0，可以静态登记以下已审核固定摘要：

- src/content/subtitles/youtube-main-bridge.js SHA-256: e3f2fbd694211778b329bd3469b96f3a515fbd70d1864b454e387cf8cbefeafe
- tests/youtube-bridge.test.mjs SHA-256: 2ff19913675c1c8b876de6e8480ed553f62fddcb366d99a27500f72f2732b492

主 Agent 实际执行 12/12 bridge 回归通过；独立复核复用该准确文件及日志，未伪造重新执行。复核工具确认摘要与 diff 检查；审核输出未保留测试进程退出码，主 Agent 后续定向验收会另记退出状态。

保留原 fetch Promise/XHR 方法与 wrapper 清理、视频/generation、2MiB 校验、纯观测和权限边界；没有主动获取字幕、重放签名 URL 或新增后台能力。无 lang 的旧兼容路径仍受 video/generation/trackRevision 约束。真实站点、浏览器及构建不属于本次独立安全审核结论。

角色配置为具名 dev_specialist；可观察模型/effort 元数据 UNKNOWN。实际会话 unrestricted / approval never，未配置只读沙箱；本审核按授权全程未写文件。后续若修改上述 MAIN 字节，当前审核绑定失效，不能自动更新 hash。
