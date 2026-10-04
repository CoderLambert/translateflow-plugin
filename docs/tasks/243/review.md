# 243 主 Agent 自查

候选 `0d34d357777ad378cd94a5ec090a8a902b27cd83`，基线 `origin/main=13041666b253ecf9aa86b3ff5edfa677dde01c05`。PASS。

Content 只通过窄 `selection.assistant-stream` Port 接收真实 delta；合法 `started`、有序 partial、Stop 确认、interrupted、retry 与 complete 均有显式状态。选择变化、关闭和导航会取消并隔离旧 Port；只有完整 turn 通过既有 Reading operation/ACK 保存，partial、取消和失败会丢弃 operation。

学习中心请求只携带 record/revision/source/target-turn 与 follow-up 问题。后台使用固定原生页面身份校验，在只读事务中重读 record、站点策略、revision、source 与已完成 turn，再派生有限历史、parent/thread/branch；根 regenerate 创建新 turn/branch。artifact 先经过既有 DTO 规范化再计算摘要，IndexedDB 提交完成后才返回 saved ACK；调用方正文或图 ID 不能授权写入。

React/交互自查：流式序号与 partial 使用 ref，Port 在 effect cleanup 关闭；Escape/IME Ctrl/Cmd+Enter、Stop/retry、窄屏 textarea、暗色与 reduced-motion 沿用现有结构和 token。无新增权限、Manifest、DB schema、Provider、公共 Reading DTO 或通用消息总线。为守住固定平台代码预算，`ai-detail`、`popover`、`rich-details` 与 Reading/Quick Control 一同进入现有确定性 classic projection；旧注册/新字节和当前注册两条升级测试均 PASS。

正式证据：`npm run validate` PASS（1066 Node、16 Vitest、strict typecheck、默认 WXT）；显式 WXT 155 files / 1,815,834 bytes，artifact fingerprint `fb72c3b24a925d755848f962822988bc68c2c13e3983ea7fe379e91bf0fa2132`；Chromium 153.0.8010.12 聚焦 E2E 1/1 PASS，覆盖 Content partial/Stop/no-save/retry/save ACK 与学习中心 repository-grounded follow-up 提交。其它浏览器、隐身模式和商店发布未验证。
