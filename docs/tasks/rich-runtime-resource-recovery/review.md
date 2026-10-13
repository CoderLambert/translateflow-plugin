# 验收后自查

生产候选：`769207ed5ef1e313fdd6c91d2f08f0e5036f9030`。测试时序修正：`9c943fdd5c6ef66fa14b55a650619566b8b4bcfb`，仅修改新 E2E 等待 resize 完成的方式，没有修改生产或构建输入。执行者为主 Agent；此记录不是独立审核。

检查资源读取、取消、对象 URL 释放、版本绑定、CSS slot 降级和音频重试。CSS 新增 flex 属性有界校验；背景只接受纯颜色；响应式规则使用 viewer 命名容器；相同规则只在同一层保留最后位置，只有相邻且声明完全相同的规则合并选择器，保留预算。没有放宽脚本、外网、CSP 或权限。

大窗口沿用当前 Selection 和历史，不重新查询；手动收起在当前 selection 保持，新 selection 重置。关闭清理 observer 和动画帧。真实 Oxford 样式在原有输出规则预算内保留，copy 词头、build 近义词以及 POS 背景恢复；360px 时上下排列。底部操作可达。

生产候选 validate PASS（1513 Node、42 Vitest）、WXT build/smoke PASS、安全 3 项与取消 12 项 PASS。Chromium 批次 13 PASS、1 个 resize 即时断言失败；测试修正后只重跑受影响场景，1 PASS，复用完全相同包指纹。另跑 check 和 diff --check PASS。保留原始 FAIL，不改写为整批 exact-head PASS。

真实私有 Oxford copy/build：桌面与窄屏 PASS，build 近义词约 660px；两词 UK/US 音频均 readyState=4、无错误、local blob；Provider=0、external HTTP=0。仅脱敏结果入库，未公开原文或截图。这是聚焦回归，不是完整 #274 验收。

已复用经完整性核验的生成内置词典资源构建，修复当前交付包遗漏内置资源的问题。已将相同指纹包更新到用户提供的原加载目录，备份旧包，不接触浏览器存储。原浏览器需要用户重新加载扩展并刷新页面，其运行结果尚未验证。未发现当前已证明问题的代码 blocker；保留 draft，不声称合并门禁通过。LRU 等低优先级工作未展开。
